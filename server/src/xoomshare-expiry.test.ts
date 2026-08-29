import { describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/postgres-js'
import { pages } from './db/schema'
import { getExpiredXoomshareRoomCondition } from './xoomshare-expiry'

describe('Xoomshare expiry cleanup query', () => {
  test('encodes timestamp parameters for postgres-js', () => {
    const now = new Date('2026-08-29T21:57:36.573Z')
    const query = drizzle.mock()
      .select()
      .from(pages)
      .where(getExpiredXoomshareRoomCondition(now, 3 * 60 * 60 * 1000))
      .toSQL()

    expect(query.params).toEqual([
      '2026-08-29T21:57:36.573Z',
      '2026-08-29T18:57:36.573Z',
    ])
    expect(query.params.every((parameter) => typeof parameter === 'string')).toBe(true)
    expect(query.sql).toContain('"expires_at" < $1')
    expect(query.sql).toContain('"created_at" < $2')
  })
})
