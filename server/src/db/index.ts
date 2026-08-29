import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const useEmbeddedDevelopmentDatabase =
  process.env.NODE_ENV === 'development' &&
  process.env.SAVESWITCH_DEV_MODE === 'true';

const developmentDatabasePath = new URL('../../.saveswitch-dev-db/', import.meta.url).pathname;

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

  const sql = postgres(process.env.DATABASE_URL, {
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : 'require',
  });
  return drizzlePostgres(sql, { schema });
};

export const db = createDatabase() as ReturnType<typeof drizzlePostgres<typeof schema>>;
