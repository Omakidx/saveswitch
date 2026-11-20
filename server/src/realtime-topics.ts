import { getEffectiveXoomshareExpiresAt, type XoomsharePageTiming } from './xoomshare-expiry'

type SubscribablePage = XoomsharePageTiming & {
  id: string
  userId: string | null
  visibility: 'public' | 'private'
}

/** Xoomshare rooms are keyed by room session so root promotion never orphans subscribers. */
export const xoomshareRoomTopic = (sessionId: string) => `xoomshare_room_${sessionId}`

/** Signed-in workspace pages publish on their own page id (see the /pages/:id/resources routes). */
export const publicPageTopic = (pageId: string) => `page_${pageId}`

/**
 * Decides which topic (if any) an anonymous WebSocket may join.
 * - Xoomshare pages: only while the room root has not expired.
 * - Signed-in users' pages: only when the page is public.
 * Private workspace pages are never subscribable.
 */
export const resolveSubscriptionTopic = ({
  page,
  roomRoot,
  ttlMs,
  now = Date.now(),
}: {
  page: SubscribablePage | undefined
  roomRoot: XoomsharePageTiming | undefined
  ttlMs: number
  now?: number
}) => {
  if (!page) return null
  if (page.sessionId) {
    if (!roomRoot) return null
    const expiresAt = getEffectiveXoomshareExpiresAt(roomRoot, ttlMs)
    if (expiresAt && expiresAt.getTime() <= now) return null
    return xoomshareRoomTopic(page.sessionId)
  }
  if (page.userId && page.visibility === 'public') return publicPageTopic(page.id)
  return null
}
