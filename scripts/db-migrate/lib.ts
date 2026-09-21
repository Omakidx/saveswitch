import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export type ManifestEntry = {
  version: string;
  name: string;
  path: string;
  sha256: string;
};

export type MigrationManifest = {
  format: number;
  migrations: ManifestEntry[];
};

export type PreparedMigration = ManifestEntry & {
  absolutePath: string;
  sql: string;
};

export type LedgerRow = {
  version: string;
  name: string;
  sha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^\d{4}$/;

export class MigrationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationContractError';
  }
}

export const parseAndValidateManifest = (input: unknown): MigrationManifest => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MigrationContractError('manifest must be an object');
  }

  const manifest = input as Partial<MigrationManifest>;
  if (manifest.format !== 1 || !Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
    throw new MigrationContractError('manifest must use format 1 and list at least one migration');
  }

  const versions = new Set<string>();
  const names = new Set<string>();
  const paths = new Set<string>();
  const hashes = new Set<string>();

  const migrations = manifest.migrations.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new MigrationContractError(`migration ${index} must be an object`);
    }

    const candidate = entry as Partial<ManifestEntry>;
    if (!candidate.version || !VERSION.test(candidate.version)) {
      throw new MigrationContractError(`migration ${index} has an invalid version`);
    }
    if (!candidate.name || !/^[a-z0-9-]+$/.test(candidate.name)) {
      throw new MigrationContractError(`migration ${candidate.version} has an invalid name`);
    }
    if (!candidate.path || typeof candidate.path !== 'string' || path.isAbsolute(candidate.path)) {
      throw new MigrationContractError(`migration ${candidate.version} has an invalid path`);
    }
    if (!candidate.sha256 || !SHA256.test(candidate.sha256)) {
      throw new MigrationContractError(`migration ${candidate.version} has an invalid SHA-256`);
    }
    if (versions.has(candidate.version) || names.has(candidate.name) || paths.has(candidate.path) || hashes.has(candidate.sha256)) {
      throw new MigrationContractError(`migration ${candidate.version} duplicates a version, name, path, or SHA-256`);
    }

    const expectedVersion = index.toString().padStart(4, '0');
    if (candidate.version !== expectedVersion) {
      throw new MigrationContractError(`migration versions must be contiguous from 0000; expected ${expectedVersion}`);
    }

    versions.add(candidate.version);
    names.add(candidate.name);
    paths.add(candidate.path);
    hashes.add(candidate.sha256);
    return candidate as ManifestEntry;
  });

  return { format: 1, migrations };
};

/** Loads and hashes every approved artifact before a database client is constructed. */
export const prepareMigrations = async (manifestPath: string): Promise<PreparedMigration[]> => {
  const manifestAbsolutePath = await realpath(manifestPath);
  const manifestDirectory = path.dirname(manifestAbsolutePath);
  const repositoryRoot = path.resolve(manifestDirectory, '../..');
  const manifest = parseAndValidateManifest(JSON.parse(await Bun.file(manifestAbsolutePath).text()));

  const insideRepository = (candidate: string) => candidate === repositoryRoot
    || candidate.startsWith(repositoryRoot === path.parse(repositoryRoot).root ? repositoryRoot : `${repositoryRoot}${path.sep}`);

  return Promise.all(manifest.migrations.map(async (entry) => {
    const requestedPath = path.resolve(manifestDirectory, entry.path);
    if (!insideRepository(requestedPath)) {
      throw new MigrationContractError(`migration ${entry.version} resolves outside the repository`);
    }

    const absolutePath = await realpath(requestedPath);
    if (absolutePath !== requestedPath || !insideRepository(absolutePath)) {
      throw new MigrationContractError(`migration ${entry.version} must be a non-symlink repository file`);
    }

    const details = await stat(absolutePath);
    if (!details.isFile()) {
      throw new MigrationContractError(`migration ${entry.version} is not a regular file`);
    }

    const sql = await Bun.file(absolutePath).text();
    const digest = createHash('sha256').update(sql).digest('hex');
    if (digest !== entry.sha256) {
      throw new MigrationContractError(`checksum mismatch for unapplied artifact ${entry.version}`);
    }

    return { ...entry, absolutePath, sql };
  }));
};

/** Ledger rows must be exactly a checksum-matching prefix of the immutable manifest. */
export const assertLedgerPrefix = (migrations: readonly ManifestEntry[], ledgerRows: readonly LedgerRow[]) => {
  if (ledgerRows.length > migrations.length) {
    throw new MigrationContractError('ledger contains more migrations than the manifest');
  }

  for (let index = 0; index < ledgerRows.length; index += 1) {
    const ledger = ledgerRows[index];
    const expected = migrations[index];
    if (ledger.version !== expected.version) {
      throw new MigrationContractError(`ledger is not a manifest prefix at position ${index}`);
    }
    if (ledger.name !== expected.name) {
      throw new MigrationContractError(`name drift for applied migration ${ledger.version}`);
    }
    if (ledger.sha256 !== expected.sha256) {
      throw new MigrationContractError(`checksum drift for applied migration ${ledger.version}`);
    }
  }
};

/** psql meta-commands are intentionally unsupported by the database driver. */
export const executableSql = (sql: string) => {
  const unsupportedMetaCommand = /^\s*\\(?!set\s+ON_ERROR_STOP\b)/mi;
  if (unsupportedMetaCommand.test(sql)) {
    throw new MigrationContractError('migration contains an unsupported psql meta-command');
  }
  return sql.replace(/^\s*\\set\s+ON_ERROR_STOP\s+\S+\s*$/gmi, '');
};
