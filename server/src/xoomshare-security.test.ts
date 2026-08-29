import { describe, expect, test } from 'bun:test'
import { generateXoomsharePathCode, normalizeXoomsharePathCode, XoomsharePathCodeError } from './xoomshare-auth'
import { canReserveXoomshareQuota, FixedWindowRateLimiter, getXoomshareResourceStorageBytes, isWithinUtf8ByteLimit, isXoomsharePageId, SocketQueryBudget, truncateUtf8, utf8ByteLength, XOOMSHARE_MAX_PAGE_NAME_BYTES, XOOMSHARE_MAX_RESOURCE_BYTES, XOOMSHARE_MAX_RESOURCES, XOOMSHARE_MAX_TITLE_BYTES } from './xoomshare-security'
import { getResourceDataUrlByteLength } from './utils/cloudinary'

describe('Xoomshare release security controls', () => {
  test('rate limiting rejects after the configured fixed-window boundary', () => {
    const limiter = new FixedWindowRateLimiter()
    expect(limiter.consume('create:127.0.0.1', 2, 1_000, 0).allowed).toBe(true)
    expect(limiter.consume('create:127.0.0.1', 2, 1_000, 1).allowed).toBe(true)
    expect(limiter.consume('create:127.0.0.1', 2, 1_000, 2)).toEqual({ allowed: false, retryAfterSeconds: 1 })
    expect(limiter.consume('create:127.0.0.1', 2, 1_000, 1_000).allowed).toBe(true)
  })

  test('generated codes are URL-safe and carry 128 bits of entropy', () => {
    const generated = generateXoomsharePathCode()
    expect(generated).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(generateXoomsharePathCode()).not.toBe(generated)
  })

  test('custom codes are constrained to safe, non-reserved 12–48 character values', () => {
    const reserved = new Set(['reserved-room'])
    expect(normalizeXoomsharePathCode({ value: 'team-reference_2026', reservedPathCodes: reserved })).toBe('team-reference_2026')
    expect(() => normalizeXoomsharePathCode({ value: 'short', reservedPathCodes: reserved })).toThrow(XoomsharePathCodeError)
    expect(() => normalizeXoomsharePathCode({ value: 'reserved-room', reservedPathCodes: reserved })).toThrow(XoomsharePathCodeError)
  })

  test('quota rejects the 61st resource and aggregate payload overflow', () => {
    expect(canReserveXoomshareQuota({ resourceCount: XOOMSHARE_MAX_RESOURCES - 1, resourceBytes: 0, incomingBytes: 1 })).toBe(true)
    expect(canReserveXoomshareQuota({ resourceCount: XOOMSHARE_MAX_RESOURCES, resourceBytes: 0, incomingBytes: 1 })).toBe(false)
    expect(canReserveXoomshareQuota({ resourceCount: 1, resourceBytes: XOOMSHARE_MAX_RESOURCE_BYTES - 1, incomingBytes: 2 })).toBe(false)
  })

  test('calculates decoded binary and UTF-8 text payload bytes', () => {
    expect(getResourceDataUrlByteLength('data:application/pdf;base64,AQID')).toBe(3)
    expect(utf8ByteLength('€')).toBe(3)
  })

  test('accounts for every persisted variable-length resource field', () => {
    expect(getXoomshareResourceStorageBytes({
      contentBytes: 3,
      title: '€',
      description: 'ok',
      thumbnailUrl: 'url',
    })).toBe(11)
  })

  test('enforces UTF-8 title/page-name byte caps and safely truncates server metadata', () => {
    expect(isWithinUtf8ByteLimit('€'.repeat(170), XOOMSHARE_MAX_TITLE_BYTES)).toBe(true)
    expect(isWithinUtf8ByteLimit('€'.repeat(171), XOOMSHARE_MAX_TITLE_BYTES)).toBe(false)
    expect(isWithinUtf8ByteLimit('€'.repeat(86), XOOMSHARE_MAX_PAGE_NAME_BYTES)).toBe(false)
    const truncated = truncateUtf8(`a${'€'.repeat(4)}`, 10)
    expect(truncated).toBe('a€€€')
    expect(utf8ByteLength(truncated)).toBeLessThanOrEqual(10)
  })

  test('accepts only UUID page identifiers for WebSocket subscriptions', () => {
    expect(isXoomsharePageId('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isXoomsharePageId('page_anything')).toBe(false)
  })

  test('bounds WebSocket subscribe lookups per socket before another database query', () => {
    const budget = new SocketQueryBudget()
    const socket = {}
    expect(budget.consume(socket, 2, 1_000, 0)).toBe(true)
    expect(budget.consume(socket, 2, 1_000, 1)).toBe(true)
    expect(budget.consume(socket, 2, 1_000, 2)).toBe(false)
    expect(budget.consume(socket, 2, 1_000, 1_000)).toBe(true)
  })
})
