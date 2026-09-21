import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertLedgerPrefix, MigrationContractError, parseAndValidateManifest, prepareMigrations } from '../lib';

const hash = (value: string) => value.repeat(64).slice(0, 64);

describe('manifest contract', () => {
  test('rejects migration gaps and duplicate versions', () => {
    expect(() => parseAndValidateManifest({
      format: 1,
      migrations: [
        { version: '0000', name: 'baseline', path: 'a.sql', sha256: hash('a') },
        { version: '0002', name: 'skipped', path: 'b.sql', sha256: hash('b') },
      ],
    })).toThrow(MigrationContractError);
  });

  test('rejects duplicate migration names', () => {
    expect(() => parseAndValidateManifest({
      format: 1,
      migrations: [
        { version: '0000', name: 'duplicate', path: 'a.sql', sha256: hash('a') },
        { version: '0001', name: 'duplicate', path: 'b.sql', sha256: hash('b') },
      ],
    })).toThrow(MigrationContractError);
  });

  test('accepts only a matching applied prefix', () => {
    const migrations = parseAndValidateManifest({
      format: 1,
      migrations: [
        { version: '0000', name: 'baseline', path: 'a.sql', sha256: hash('a') },
        { version: '0001', name: 'followup', path: 'b.sql', sha256: hash('b') },
      ],
    }).migrations;
    expect(() => assertLedgerPrefix(migrations, [{ version: '0001', name: 'followup', sha256: hash('b') }])).toThrow(MigrationContractError);
    expect(() => assertLedgerPrefix(migrations, [{ version: '0000', name: 'baseline', sha256: hash('0') }])).toThrow(MigrationContractError);
    expect(() => assertLedgerPrefix(migrations, [{ version: '0000', name: 'renamed', sha256: hash('a') }])).toThrow(MigrationContractError);
    expect(() => assertLedgerPrefix(migrations, [{ version: '0000', name: 'baseline', sha256: hash('a') }])).not.toThrow();
  });

  test('fails checksum verification before a database client is needed', async () => {
    const temporaryDirectory = path.join('/tmp', `saveswitch-db-migrate-${randomUUID()}`);
    const temporaryPath = path.join(temporaryDirectory, 'manifest.json');
    await mkdir(temporaryDirectory, { recursive: true });
    try {
      await Bun.write(path.join(temporaryDirectory, '0000.sql'), 'select 1;\n');
      await Bun.write(temporaryPath, JSON.stringify({
        format: 1,
        migrations: [{ version: '0000', name: 'baseline', path: '0000.sql', sha256: '0'.repeat(64) }],
      }));
      await expect(prepareMigrations(temporaryPath)).rejects.toThrow(MigrationContractError);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
