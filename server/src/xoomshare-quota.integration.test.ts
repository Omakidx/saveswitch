import { PGlite } from '@electric-sql/pglite'
import { describe, expect, test } from 'bun:test'
import { XOOMSHARE_MAX_RESOURCES } from './xoomshare-security'

describe('Xoomshare quota SQL invariant', () => {
  test('concurrent conditional reservations cannot exceed the room count limit', async () => {
    const database = new PGlite()
    try {
      await database.exec(`
        CREATE TABLE room_counter (
          id text PRIMARY KEY,
          resource_count integer NOT NULL CHECK (resource_count >= 0),
          resource_bytes integer NOT NULL CHECK (resource_bytes >= 0)
        );
        INSERT INTO room_counter VALUES ('room', 0, 0);
      `)

      const attempts = await Promise.all(
        Array.from({ length: XOOMSHARE_MAX_RESOURCES + 12 }, () => database.query(
          `UPDATE room_counter
           SET resource_count = resource_count + 1,
               resource_bytes = resource_bytes + 1
           WHERE id = 'room' AND resource_count < ${XOOMSHARE_MAX_RESOURCES}
           RETURNING resource_count`,
        )),
      )
      const committed = attempts.reduce((count, result) => count + result.rows.length, 0)
      const total = await database.query<{ resource_count: number; resource_bytes: number }>(
        `SELECT resource_count, resource_bytes FROM room_counter WHERE id = 'room'`,
      )

      expect(committed).toBe(XOOMSHARE_MAX_RESOURCES)
      expect(total.rows[0]).toEqual({
        resource_count: XOOMSHARE_MAX_RESOURCES,
        resource_bytes: XOOMSHARE_MAX_RESOURCES,
      })
    } finally {
      await database.close()
    }
  })
})
