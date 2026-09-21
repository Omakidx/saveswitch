import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLedgerPrefix, executableSql, prepareMigrations, type LedgerRow } from './lib';
import { parseDatabaseUrl } from '../../server/src/db/database-url';

const requireFromServer = createRequire(new URL('../../server/package.json', import.meta.url));
const postgresModule = requireFromServer('postgres') as typeof import('postgres') & { default?: typeof import('postgres').default };
const postgres = postgresModule.default ?? postgresModule as unknown as typeof import('postgres').default;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(scriptDirectory, 'manifest.json');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required; its value is never printed by this runner');
}

const migrations = await prepareMigrations(manifestPath);
const parsedDatabaseUrl = parseDatabaseUrl(databaseUrl);
const isLoopbackDatabase = ['localhost', '127.0.0.1', '::1'].includes(parsedDatabaseUrl.hostname);
const databaseSslCa = process.env.DATABASE_SSL_CA?.trim();
if (!isLoopbackDatabase && !databaseSslCa) {
  throw new Error('DATABASE_SSL_CA is required for authenticated PostgreSQL TLS');
}
let sql: ReturnType<typeof postgres>;
try {
  sql = postgres(parsedDatabaseUrl.toString(), {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 1,
    onnotice: false,
    ssl: isLoopbackDatabase ? false : { ca: databaseSslCa!, rejectUnauthorized: true },
    connection: { statement_timeout: 60_000 },
  });
} catch {
  throw new Error('DATABASE_URL is invalid');
}

const configureTransaction = async (tx: typeof sql) => {
  await tx.unsafe("set local lock_timeout = '15s'");
  await tx.unsafe("set local statement_timeout = '60s'");
  await tx.unsafe("set local idle_in_transaction_session_timeout = '60s'");
  // Bootstrap grants this membership to the short-lived migrator. Ownership is
  // required for public DDL, but the login role itself carries no DDL grant.
  await tx.unsafe('set local role saveswitch_owner');
  await tx.unsafe("select pg_advisory_xact_lock(hashtextextended(current_database() || ':saveswitch-schema-migrations', 0))");
};

const initializeLedger = async (tx: typeof sql) => {
  await tx.unsafe('create schema if not exists saveswitch_meta authorization saveswitch_owner');
  await tx.unsafe('revoke all on schema saveswitch_meta from public');
  await tx.unsafe(`
    create table if not exists saveswitch_meta.schema_migrations (
      version text primary key check (version ~ '^[0-9]{4}$'),
      name text not null unique check (name <> ''),
      sha256 char(64) not null,
      applied_at timestamptz not null default now(),
      applied_by text not null default session_user,
      constraint schema_migrations_sha256_check check (sha256 ~ '^[a-f0-9]{64}$')
    )
  `);
  await tx.unsafe('revoke all on saveswitch_meta.schema_migrations from public');
};

const readLedger = async (tx: typeof sql) => tx<LedgerRow[]>`
  select version, name, sha256
  from saveswitch_meta.schema_migrations
  order by version asc
`;

try {
  // Initialize the private ledger independently so every migration and its
  // row can then commit as one resumable transaction.
  await sql.begin(async (tx) => {
    await configureTransaction(tx);
    await initializeLedger(tx);
    assertLedgerPrefix(migrations, await readLedger(tx));
  });

  while (true) {
    const applied = await sql.begin(async (tx) => {
      await configureTransaction(tx);
      await initializeLedger(tx);

      // Re-read after taking the advisory lock. Another runner may have
      // advanced the ledger between two of our transactions.
      const ledgerRows = await readLedger(tx);
      assertLedgerPrefix(migrations, ledgerRows);

      if (ledgerRows.length === 0) {
        const [{ relation_count }] = await tx<{ relation_count: number }[]>`
          select count(*)::integer as relation_count
          from pg_catalog.pg_tables
          where schemaname = 'public'
        `;
        if (relation_count !== 0) {
          throw new Error('refusing baseline on a non-empty public schema without a trusted migration ledger');
        }
      }

      const migration = migrations[ledgerRows.length];
      if (!migration) return null;
      await tx.unsafe(executableSql(migration.sql));
      await tx`
        insert into saveswitch_meta.schema_migrations (version, name, sha256)
        values (${migration.version}, ${migration.name}, ${migration.sha256})
      `;
      return migration;
    });

    if (!applied) break;
    console.log(`applied migration ${applied.version} (${applied.name})`);
  }
  console.log(`migration ledger is current through ${migrations.at(-1)?.version}`);
} finally {
  await sql.end({ timeout: 5 });
}
