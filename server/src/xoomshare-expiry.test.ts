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

import { getEffectiveXoomshareExpiresAt } from './xoomshare-expiry'

describe('getEffectiveXoomshareExpiresAt', () => {
  const ttl = 3 * 60 * 60 * 1000
  const createdAt = new Date('2026-01-01T00:00:00Z')

  test('caps a stored expiry at createdAt + ttl and ignores non-room pages without expiry', () => {
    const far = new Date(createdAt.getTime() + 10 * ttl)
    expect(getEffectiveXoomshareExpiresAt({ sessionId: 's', expiresAt: far, createdAt }, ttl)?.getTime()).toBe(createdAt.getTime() + ttl)
    const soon = new Date(createdAt.getTime() + 1000)
    expect(getEffectiveXoomshareExpiresAt({ sessionId: 's', expiresAt: soon, createdAt }, ttl)).toBe(soon)
    expect(getEffectiveXoomshareExpiresAt({ sessionId: null, expiresAt: null, createdAt }, ttl)).toBeNull()
  })
})
