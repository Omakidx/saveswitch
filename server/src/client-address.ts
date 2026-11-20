/**
 * Resolves the address used for rate limiting.
 *
 * Behind a reverse proxy (Railway, Heroku, ...) the socket peer is the proxy, so
 * every visitor would share one rate-limit bucket. When `trustedProxyHops` > 0
 * the Nth entry from the RIGHT of X-Forwarded-For is used: that entry was
 * appended by our own trusted proxy, whereas entries further left are
 * client-controlled and spoofable. With no usable header we fall back to the
 * socket address, which is never worse than not trusting the header.
 */
export const resolveClientAddress = ({
  forwardedFor,
  socketAddress,
  trustedProxyHops,
}: {
  forwardedFor: string | null
  socketAddress: string | null | undefined
  trustedProxyHops: number
}) => {
  const fallback = socketAddress || 'unknown'
  if (!forwardedFor || !Number.isInteger(trustedProxyHops) || trustedProxyHops <= 0) return fallback

  const hops = forwardedFor.split(',').map((part) => part.trim()).filter(Boolean)
  const candidate = hops[hops.length - trustedProxyHops]
  if (!candidate || candidate.length > 64 || !/^[0-9a-f:.]+$/i.test(candidate)) return fallback
  return candidate.toLowerCase()
}

export const resolveTrustedProxyHops = (env: Record<string, string | undefined> = process.env) => {
  const configured = env.TRUSTED_PROXY_HOPS?.trim()
  if (configured !== undefined && configured !== '') {
    const parsed = Number(configured)
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed : 0
  }
  // Railway terminates TLS at its edge proxy and appends the client address.
  return env.RAILWAY_ENVIRONMENT ? 1 : 0
}
