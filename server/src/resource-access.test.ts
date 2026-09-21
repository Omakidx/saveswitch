import { describe, expect, test } from 'bun:test'
import { canReadResource } from './resource-access'

const base = {
  resourcePageId: 'page', pageUserId: 'owner', pageVisibility: 'private' as const,
  userVisibility: 'private' as const, pageSessionId: null, rootSessionId: null,
  rootPathCode: null, rootExpired: true,
}

describe('canReadResource', () => {
  test('allows only the owner for a normal private page', () => {
    expect(canReadResource({ resource: base, authenticatedUserId: 'owner', xoomsharePathCode: null })).toBe(true)
    expect(canReadResource({ resource: base, authenticatedUserId: 'other', xoomsharePathCode: null })).toBe(false)
  })
  test('requires both normal page and user to be public', () => {
    expect(canReadResource({ resource: { ...base, pageVisibility: 'public', userVisibility: 'public' }, authenticatedUserId: null, xoomsharePathCode: null })).toBe(true)
    expect(canReadResource({ resource: { ...base, pageVisibility: 'public' }, authenticatedUserId: null, xoomsharePathCode: null })).toBe(false)
    expect(canReadResource({ resource: { ...base, pageVisibility: 'public', userVisibility: 'public', pageSessionId: 'room' }, authenticatedUserId: null, xoomsharePathCode: null })).toBe(false)
  })
  test('requires a matching live Xoomshare root', () => {
    const room = { ...base, pageUserId: null, pageSessionId: 'room', rootSessionId: 'room', rootPathCode: 'valid_room_code', rootExpired: false }
    expect(canReadResource({ resource: room, authenticatedUserId: null, xoomsharePathCode: 'valid_room_code' })).toBe(true)
    expect(canReadResource({ resource: room, authenticatedUserId: null, xoomsharePathCode: 'wrong_room_code' })).toBe(false)
    expect(canReadResource({ resource: { ...room, rootExpired: true }, authenticatedUserId: null, xoomsharePathCode: 'valid_room_code' })).toBe(false)
  })
})
