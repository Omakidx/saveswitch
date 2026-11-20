import { and, isNotNull, lt, or } from 'drizzle-orm'
import { pages } from './db/schema'

/** Lifetime of a Xoomshare room, shared by the API sweep and the cleanup cron. */
export const XOOMSHARE_TTL_HOURS = 3
export const XOOMSHARE_TTL_MS = XOOMSHARE_TTL_HOURS * 60 * 60 * 1000

export type XoomsharePageTiming = {
  sessionId: string | null
  expiresAt: Date | null
  createdAt: Date
}

/** A room never outlives `createdAt + ttl`, even if a larger expiresAt was stored. */
export const getEffectiveXoomshareExpiresAt = (page: XoomsharePageTiming, ttlMs: number) => {
  if (!page.sessionId && !page.expiresAt) return null

  const ttlExpiry = new Date(page.createdAt.getTime() + ttlMs)
  if (!page.expiresAt) return ttlExpiry

  return page.expiresAt.getTime() <= ttlExpiry.getTime() ? page.expiresAt : ttlExpiry
}

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
