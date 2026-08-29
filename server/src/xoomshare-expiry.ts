import { and, isNotNull, lt, or } from 'drizzle-orm'
import { pages } from './db/schema'

/**
 * Keep timestamp values attached to their Drizzle columns so the postgres-js
 * driver receives encoded timestamp strings rather than raw Date instances.
 */
export const getExpiredXoomshareRoomCondition = (
  now: Date,
  ttlMs: number,
) => and(
  isNotNull(pages.pathCode),
  isNotNull(pages.sessionId),
  or(
    lt(pages.expiresAt, now),
    lt(pages.createdAt, new Date(now.getTime() - ttlMs)),
  ),
)
