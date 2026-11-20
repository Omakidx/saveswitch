import { describe, expect, test } from 'bun:test'
import { publicPageTopic, resolveSubscriptionTopic, xoomshareRoomTopic } from './realtime-topics'

const TTL = 3 * 60 * 60 * 1000
const NOW = Date.parse('2026-01-01T12:00:00Z')
const fresh = new Date(NOW - 60_000)

const roomPage = { id: 'p1', userId: null, visibility: 'public' as const, sessionId: 'sess', expiresAt: new Date(NOW + 60_000), createdAt: fresh }

describe('resolveSubscriptionTopic', () => {
  test('Xoomshare pages (root or not) join one session-keyed topic while the room is live', () => {
    const root = { sessionId: 'sess', expiresAt: new Date(NOW + 60_000), createdAt: fresh }
    expect(resolveSubscriptionTopic({ page: roomPage, roomRoot: root, ttlMs: TTL, now: NOW })).toBe(xoomshareRoomTopic('sess'))
    expect(resolveSubscriptionTopic({ page: { ...roomPage, id: 'p2' }, roomRoot: root, ttlMs: TTL, now: NOW })).toBe(xoomshareRoomTopic('sess'))
  })

  test('expired or rootless Xoomshare rooms are not subscribable', () => {
    const expired = { sessionId: 'sess', expiresAt: new Date(NOW - 1), createdAt: fresh }
    expect(resolveSubscriptionTopic({ page: roomPage, roomRoot: expired, ttlMs: TTL, now: NOW })).toBeNull()
    const old = { sessionId: 'sess', expiresAt: new Date(NOW + 10 * TTL), createdAt: new Date(NOW - TTL - 1) }
    expect(resolveSubscriptionTopic({ page: roomPage, roomRoot: old, ttlMs: TTL, now: NOW })).toBeNull()
    expect(resolveSubscriptionTopic({ page: roomPage, roomRoot: undefined, ttlMs: TTL, now: NOW })).toBeNull()
  })

  test('public profile pages are subscribable but private workspace pages and unknown ids are not', () => {
    const userPage = { id: 'u1', userId: 'google-1', visibility: 'public' as const, sessionId: null, expiresAt: null, createdAt: fresh }
    expect(resolveSubscriptionTopic({ page: userPage, roomRoot: undefined, ttlMs: TTL, now: NOW })).toBe(publicPageTopic('u1'))
    expect(resolveSubscriptionTopic({ page: { ...userPage, visibility: 'private' }, roomRoot: undefined, ttlMs: TTL, now: NOW })).toBeNull()
    expect(resolveSubscriptionTopic({ page: undefined, roomRoot: undefined, ttlMs: TTL, now: NOW })).toBeNull()
  })
})
