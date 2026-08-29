import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle-dev',
  dialect: 'postgresql',
  driver: 'pglite',
  dbCredentials: {
    // Keep schema pushes pointed at the same repo-root PGlite database opened
    // by src/db/index.ts (not a second server-local development database).
    url: '../.saveswitch-dev-db',
  },
});
