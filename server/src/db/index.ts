import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { parseDatabaseUrl } from './database-url';

const useEmbeddedDevelopmentDatabase =
  process.env.NODE_ENV === 'development' &&
  process.env.SAVESWITCH_DEV_MODE === 'true';

const developmentDatabasePath = new URL('../../.saveswitch-dev-db/', import.meta.url).pathname;

const isProduction = process.env.NODE_ENV === 'production';
let postgresClient: ReturnType<typeof postgres> | null = null;

const getProductionSsl = (databaseHostname: string) => {
  if (!isProduction) {
    return ['localhost', '127.0.0.1', '::1'].includes(databaseHostname) ? false : 'require';
  }
  const ca = process.env.DATABASE_SSL_CA?.trim();
  if (!ca) {
    throw new Error('DATABASE_SSL_CA is required for authenticated PostgreSQL TLS in production');
  }
  // postgres-js passes this directly to Node TLS.  `rejectUnauthorized` keeps
  // the RDS hostname and CA chain authenticated rather than merely encrypted.
  return { ca, rejectUnauthorized: true };
};

const createDatabase = () => {
  if (useEmbeddedDevelopmentDatabase) {
    return drizzlePglite({
      connection: { dataDir: developmentDatabasePath },
      schema,
    });
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when SAVESWITCH_DEV_MODE is not enabled.');
  }

  const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL)
  let sql: ReturnType<typeof postgres>
  try {
    sql = postgres(databaseUrl.toString(), {
      ssl: getProductionSsl(databaseUrl.hostname),
      max: 10,
      connect_timeout: 5,
      // The readiness helper returns within 1.5 seconds and attempts query
      // cancellation; this server-side bound prevents an abandoned query from
      // running indefinitely if cancellation races with connection startup.
      connection: { statement_timeout: 5_000 },
    });
  } catch {
    throw new Error('DATABASE_URL is invalid')
  }
  postgresClient = sql;
  return drizzlePostgres(sql, { schema });
};

export const db = createDatabase() as ReturnType<typeof drizzlePostgres<typeof schema>>;

/** Available only for maintenance commands that require a reserved PG session. */
export const getPostgresMaintenanceClient = () => postgresClient;
