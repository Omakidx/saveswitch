import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { parseDatabaseUrl } from './database-url'

describe('parseDatabaseUrl', () => {
  test('accepts a PostgreSQL URL and exposes its hostname', () => {
    expect(parseDatabaseUrl('postgres://app:secret@db.example.com:5432/saveswitch').hostname).toBe('db.example.com')
  })

  test('rejects malformed or incomplete URLs without reflecting the input', () => {
    const marker = 'DO_NOT_LOG_THIS_DATABASE_SECRET'
    for (const value of [`not-a-url-${marker}`, `https://app:${marker}@db.example.com/saveswitch`, 'postgres://db.example.com/']) {
      try {
        parseDatabaseUrl(value)
        throw new Error('expected rejection')
      } catch (error) {
        expect(String(error)).toBe('Error: DATABASE_URL is invalid')
        expect(String(error)).not.toContain(marker)
      }
    }
  })

  test('startup and migration subprocess failures do not print malformed credentials', () => {
    const marker = 'DO_NOT_LOG_THIS_DATABASE_SECRET'
    const serverRoot = path.resolve(import.meta.dir, '../..')
    const commands = [
      [process.execPath, '-e', "await import('./src/db/index.ts')"],
      [process.execPath, '../scripts/db-migrate/run.ts'],
    ]

    for (const cmd of commands) {
      const result = Bun.spawnSync({
        cmd,
        cwd: serverRoot,
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: `not-a-url-${marker}`,
          DATABASE_SSL_CA: 'test-ca',
        },
        stderr: 'pipe',
        stdout: 'pipe',
      })
      const output = `${result.stdout.toString()}\n${result.stderr.toString()}`
      expect(result.exitCode).not.toBe(0)
      expect(output).toContain('DATABASE_URL is invalid')
      expect(output).not.toContain(marker)
    }
  })
})
