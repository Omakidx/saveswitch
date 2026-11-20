import { describe, expect, test } from 'bun:test'
import { resolveClientAddress, resolveTrustedProxyHops } from './client-address'

describe('resolveClientAddress', () => {
  test('ignores X-Forwarded-For unless a trusted proxy hop count is configured', () => {
    expect(resolveClientAddress({ forwardedFor: '6.6.6.6', socketAddress: '10.0.0.1', trustedProxyHops: 0 })).toBe('10.0.0.1')
  })

  test('uses the entry appended by the trusted proxy, not a client-spoofed leftmost value', () => {
    expect(resolveClientAddress({ forwardedFor: '6.6.6.6, 203.0.113.9', socketAddress: '10.0.0.1', trustedProxyHops: 1 })).toBe('203.0.113.9')
    expect(resolveClientAddress({ forwardedFor: '6.6.6.6, 203.0.113.9, 10.1.1.1', socketAddress: '10.0.0.1', trustedProxyHops: 2 })).toBe('203.0.113.9')
  })

  test('falls back to the socket address for missing, short or malformed headers', () => {
    expect(resolveClientAddress({ forwardedFor: null, socketAddress: '10.0.0.1', trustedProxyHops: 1 })).toBe('10.0.0.1')
    expect(resolveClientAddress({ forwardedFor: '1.1.1.1', socketAddress: '10.0.0.1', trustedProxyHops: 2 })).toBe('10.0.0.1')
    expect(resolveClientAddress({ forwardedFor: 'not an ip!', socketAddress: '10.0.0.1', trustedProxyHops: 1 })).toBe('10.0.0.1')
    expect(resolveClientAddress({ forwardedFor: null, socketAddress: undefined, trustedProxyHops: 0 })).toBe('unknown')
  })
})

describe('resolveTrustedProxyHops', () => {
  test('defaults to 0, trusts one hop on Railway, and honours an explicit override', () => {
    expect(resolveTrustedProxyHops({})).toBe(0)
    expect(resolveTrustedProxyHops({ RAILWAY_ENVIRONMENT: 'production' })).toBe(1)
    expect(resolveTrustedProxyHops({ RAILWAY_ENVIRONMENT: 'production', TRUSTED_PROXY_HOPS: '0' })).toBe(0)
    expect(resolveTrustedProxyHops({ TRUSTED_PROXY_HOPS: '2' })).toBe(2)
    expect(resolveTrustedProxyHops({ TRUSTED_PROXY_HOPS: 'abc' })).toBe(0)
  })
})
