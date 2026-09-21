import { describe, expect, test } from 'bun:test'
import { resolveTrustedRequestAddress, withTrustedRequestAddress } from './trusted-request-address'

describe('Cloudflare Tunnel request address boundary', () => {
  test('trusts a canonical IPv4 or IPv6 address from the default loopback peers', () => {
    expect(resolveTrustedRequestAddress({
      peerAddress: '127.0.0.1',
      cfConnectingIp: '203.0.113.9',
    })).toEqual({ ok: true, address: '203.0.113.9' })
    expect(resolveTrustedRequestAddress({
      peerAddress: '::1',
      cfConnectingIp: '2001:db8::9',
    })).toEqual({ ok: true, address: '2001:db8::9' })
    expect(resolveTrustedRequestAddress({
      peerAddress: '::ffff:127.0.0.1',
      cfConnectingIp: '198.51.100.7',
    })).toEqual({ ok: true, address: '198.51.100.7' })
    expect(resolveTrustedRequestAddress({
      peerAddress: '::FFFF:127.0.0.1',
      cfConnectingIp: '2001:DB8::7',
    })).toEqual({ ok: true, address: '2001:DB8::7' })
  })

  test('rejects a spoofed Cloudflare address from a non-loopback peer', () => {
    expect(resolveTrustedRequestAddress({
      peerAddress: '198.51.100.20',
      cfConnectingIp: '203.0.113.9',
    })).toEqual({ ok: false })
    expect(resolveTrustedRequestAddress({
      peerAddress: '::ffff:198.51.100.20',
      cfConnectingIp: '2001:db8::9',
    })).toEqual({ ok: false })
  })

  test('accepts a header only from an explicitly configured Docker gateway peer', () => {
    const trustedProxyPeers = new Set(['172.30.250.1'])
    expect(resolveTrustedRequestAddress({
      peerAddress: '172.30.250.1',
      cfConnectingIp: '203.0.113.9',
      trustedProxyPeers,
    })).toEqual({ ok: true, address: '203.0.113.9' })
    expect(resolveTrustedRequestAddress({
      peerAddress: '172.30.250.2',
      cfConnectingIp: '203.0.113.9',
      trustedProxyPeers,
    })).toEqual({ ok: false })
  })

  test('does not invoke the rate-limit operation for spoofed or malformed headers', () => {
    let invocations = 0
    const consume = () => {
      invocations += 1
      return { allowed: true }
    }

    expect(withTrustedRequestAddress({
      peerAddress: '198.51.100.20',
      cfConnectingIp: '203.0.113.9',
    }, consume)).toEqual({ ok: false })
    expect(withTrustedRequestAddress({
      peerAddress: '127.0.0.1',
      cfConnectingIp: 'fe80::1%lo',
    }, consume)).toEqual({ ok: false })
    expect(invocations).toBe(0)

    expect(withTrustedRequestAddress({
      peerAddress: '127.0.0.1',
      cfConnectingIp: '203.0.113.9',
    }, consume)).toEqual({ ok: true, value: { allowed: true } })
    expect(invocations).toBe(1)
  })

  test('rejects malformed, padded, list, ambiguous, and zone-qualified header values', () => {
    for (const value of [
      '',
      ' 203.0.113.9',
      '203.0.113.9 ',
      '203.0.113.9\t',
      '203.0.113.9, 198.51.100.7',
      'not-an-ip',
      'fe80::1%lo',
      '[2001:db8::9]',
      '203.0.113.009',
    ]) {
      expect(resolveTrustedRequestAddress({
        peerAddress: '127.0.0.1',
        cfConnectingIp: value,
      })).toEqual({ ok: false })
    }
  })

  test('uses the accepted socket peer when Cloudflare did not supply a header', () => {
    expect(resolveTrustedRequestAddress({
      peerAddress: '198.51.100.20',
      cfConnectingIp: null,
    })).toEqual({ ok: true, address: '198.51.100.20' })
  })
})
