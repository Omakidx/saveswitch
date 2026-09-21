import { isIP } from 'node:net'

export type TrustedRequestAddress =
  | { ok: true; address: string }
  | { ok: false }

export type TrustedAddressOperation<T> =
  | { ok: true; value: T }
  | { ok: false }

export const DEFAULT_TRUSTED_PROXY_PEERS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
])

/**
 * Bun's Node-compatibility `isIP` accepts an IPv6 scope identifier. That is
 * useful for local interfaces but it is not valid syntax for HTTP client-IP
 * headers, and would create a second spelling for the same rate-limit key.
 */
const isValidCloudflareClientAddress = (value: string) => {
  if (!/^[0-9A-Fa-f:.]+$/.test(value)) return false

  const version = isIP(value)
  if (version === 6) return true
  if (version !== 4) return false

  // Keep IPv4 rate-limit keys canonical. `isIP` rejects most ambiguous forms,
  // but this also makes the boundary's accepted syntax explicit.
  return value.split('.').every((octet) => {
    const numeric = Number(octet)
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255 && String(numeric) === octet
  })
}

/**
 * Trust Cloudflare's canonical client address only across the deployment's
 * exact configured proxy-peer boundary. Local development defaults to
 * loopback; production supplies its dedicated Docker bridge gateway. Any
 * other peer supplying the same header is rejected rather than trusted or
 * ignored.
 */
export const resolveTrustedRequestAddress = ({
  peerAddress,
  cfConnectingIp,
  trustedProxyPeers = DEFAULT_TRUSTED_PROXY_PEERS,
}: {
  peerAddress: string | null | undefined
  cfConnectingIp: string | null
  trustedProxyPeers?: ReadonlySet<string>
}): TrustedRequestAddress => {
  const peer = peerAddress?.trim().toLowerCase() || 'unknown'
  const isTrustedProxyPeer = trustedProxyPeers.has(peer)

  if (cfConnectingIp === null) {
    return { ok: true, address: peer }
  }

  if (!isTrustedProxyPeer) return { ok: false }

  // Cloudflare sends exactly one address. Whitespace, comma-separated lists,
  // IPv6 zone identifiers, and non-IP text are invalid at this boundary.
  if (cfConnectingIp !== cfConnectingIp.trim() || !isValidCloudflareClientAddress(cfConnectingIp)) {
    return { ok: false }
  }

  return { ok: true, address: cfConnectingIp }
}

/**
 * Run a side effect only after the peer/header trust boundary is satisfied.
 * Callers use this to ensure spoofed or malformed headers cannot consume a
 * rate-limit entry before the request is rejected.
 */
export const withTrustedRequestAddress = <T>(
  input: Parameters<typeof resolveTrustedRequestAddress>[0],
  operation: (address: string) => T,
): TrustedAddressOperation<T> => {
  const resolved = resolveTrustedRequestAddress(input)
  if (!resolved.ok) return { ok: false }
  return { ok: true, value: operation(resolved.address) }
}
