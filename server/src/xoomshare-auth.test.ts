import { describe, expect, test } from 'bun:test'
import {
  canCreateXoomshareResource,
  canManageXoomshareResource,
  createXoomshareCookie,
  resolveXoomshareParticipant,
  xoomshareCookieName,
} from './xoomshare-auth'

const ownerA = '11111111-1111-4111-8111-111111111111'
const ownerB = '22222222-2222-4222-8222-222222222222'
const guestA = '33333333-3333-4333-8333-333333333333'
const guestB = '44444444-4444-4444-8444-444444444444'

describe('Xoomshare room-scoped participants', () => {
  test('recognizes a room owner only in that room', () => {
    const cookieHeader = `${xoomshareCookieName('alpha')}=${ownerA}; ${xoomshareCookieName('bravo')}=${ownerB}`
    expect(resolveXoomshareParticipant({ cookieHeader, pathCode: 'alpha', roomSessionId: ownerA }))
      .toMatchObject({ participantId: ownerA, isRoomOwner: true })
    expect(resolveXoomshareParticipant({ cookieHeader, pathCode: 'bravo', roomSessionId: ownerB }))
      .toMatchObject({ participantId: ownerB, isRoomOwner: true })
  })

  test('does not let a room A participant own or manage a resource in room B', () => {
    const participant = resolveXoomshareParticipant({
      cookieHeader: `${xoomshareCookieName('alpha')}=${guestA}`,
      pathCode: 'bravo',
      roomSessionId: ownerB,
    })

    expect(participant).toEqual({ participantId: null, isRoomOwner: false, shouldPromoteLegacyOwner: false })
    expect(canManageXoomshareResource({ isRoomOwner: false, participantId: participant.participantId, resourceParticipantId: guestA })).toBe(false)
  })

  test('allows a guest to manage only resources created with that room participant id', () => {
    expect(canManageXoomshareResource({ isRoomOwner: false, participantId: guestA, resourceParticipantId: guestA })).toBe(true)
    expect(canManageXoomshareResource({ isRoomOwner: false, participantId: guestA, resourceParticipantId: guestB })).toBe(false)
  })

  test('allows the room owner to manage any resource and enforces guest posting settings', () => {
    expect(canManageXoomshareResource({ isRoomOwner: true, participantId: ownerA, resourceParticipantId: guestA })).toBe(true)
    expect(canCreateXoomshareResource({ isRoomOwner: false, allowGuestResources: false })).toBe(false)
    expect(canCreateXoomshareResource({ isRoomOwner: false, allowGuestResources: true })).toBe(true)
    expect(canCreateXoomshareResource({ isRoomOwner: true, allowGuestResources: false })).toBe(true)
  })

  test('promotes only a matching legacy owner cookie, never a legacy guest identity', () => {
    expect(resolveXoomshareParticipant({ cookieHeader: `xoomshare_session=${ownerA}`, pathCode: 'alpha', roomSessionId: ownerA }))
      .toMatchObject({ participantId: ownerA, isRoomOwner: true, shouldPromoteLegacyOwner: true })
    expect(resolveXoomshareParticipant({ cookieHeader: `xoomshare_session=${guestA}`, pathCode: 'alpha', roomSessionId: ownerA }))
      .toEqual({ participantId: null, isRoomOwner: false, shouldPromoteLegacyOwner: false })
  })

  test('serializes secure HttpOnly room cookies', () => {
    expect(createXoomshareCookie({ name: xoomshareCookieName('alpha'), value: guestA, maxAge: 60, secure: true }))
      .toContain('HttpOnly; SameSite=Lax; Secure')
  })

  test('does not authorize an old owner after the same path is recreated', () => {
    const pathCode = 'same-custom-path'
    const oldSession = '11111111-1111-4111-8111-111111111111'
    const newSession = '22222222-2222-4222-8222-222222222222'
    const oldCookie = `${xoomshareCookieName(pathCode)}=${oldSession}`

    expect(resolveXoomshareParticipant({
      cookieHeader: oldCookie,
      pathCode,
      roomSessionId: newSession,
    })).toEqual({ participantId: oldSession, isRoomOwner: false, shouldPromoteLegacyOwner: false })
  })
})
