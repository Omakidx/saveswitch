import { isIP } from 'node:net'
import { DEFAULT_TRUSTED_PROXY_PEERS } from './trusted-request-address'

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const DEFAULT_CLIENT_ORIGIN = 'http://localhost:5173'
const DEFAULT_GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback'
const DEFAULT_JWT_SECRET = 'dev-secret-change-me'
const PRODUCTION_JWT_SECRET = /^[A-Za-z0-9_-]{43,128}$/

export type RuntimeConfig = {
  clientOrigin: string
  googleClientId: string
  googleClientSecret: string
  googleRedirectUri: string
  jwtSecret: string
  /** PEM CA bundle injected at runtime; required only in production. */
  databaseSslCa: string
  /** Exact socket peers allowed to supply Cloudflare's client-IP header. */
  trustedProxyPeers: ReadonlySet<string>
  isLocalDevelopmentOrigin: boolean
  isProduction: boolean
}

const requireProductionValue = (env: Record<string, string | undefined>, key: string) => {
  const value = env[key]?.trim()
  if (!value) throw new Error(`Missing required production environment variable: ${key}`)
  return value
}

const parseAbsoluteUrl = (value: string, key: string) => {
  try {
    return new URL(value)
  } catch {
    throw new Error(`${key} must be an absolute URL`)
  }
}

const parseTrustedProxyPeers = (value: string | undefined, isProduction: boolean) => {
  if (!value?.trim()) {
    if (isProduction) throw new Error('Missing required production environment variable: TRUSTED_PROXY_PEERS')
    return new Set(DEFAULT_TRUSTED_PROXY_PEERS)
  }

  const peers = value.split(',')
  if (peers.length > 8) throw new Error('TRUSTED_PROXY_PEERS accepts at most eight exact IP addresses')

  const normalized = peers.map((peer) => {
    if (peer !== peer.trim() || !peer || peer.includes('%') || isIP(peer) === 0) {
      throw new Error('TRUSTED_PROXY_PEERS must contain canonical, comma-separated IP addresses without whitespace')
    }
    if (isIP(peer) === 4 && !peer.split('.').every((octet) => String(Number(octet)) === octet)) {
      throw new Error('TRUSTED_PROXY_PEERS must contain canonical, comma-separated IP addresses without whitespace')
    }
    return peer.toLowerCase()
  })

  if (new Set(normalized).size !== normalized.length) {
    throw new Error('TRUSTED_PROXY_PEERS must not contain duplicates')
  }
  return new Set(normalized)
}

/**
 * Resolves runtime configuration and rejects insecure fallbacks in production.
 * Development defaults intentionally remain available for local test work.
 */
export const resolveRuntimeConfig = (
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig => {
  const isProduction = env.NODE_ENV === 'production'
  const clientOrigin = (env.CLIENT_ORIGIN || DEFAULT_CLIENT_ORIGIN).trim()
  const googleRedirectUri = (env.GOOGLE_REDIRECT_URI || DEFAULT_GOOGLE_REDIRECT_URI).trim()
  const config: RuntimeConfig = {
    clientOrigin,
    googleClientId: (env.GOOGLE_CLIENT_ID || '').trim(),
    googleClientSecret: (env.GOOGLE_CLIENT_SECRET || '').trim(),
    googleRedirectUri,
    jwtSecret: (env.JWT_SECRET || DEFAULT_JWT_SECRET).trim(),
    databaseSslCa: (env.DATABASE_SSL_CA || '').trim(),
    trustedProxyPeers: parseTrustedProxyPeers(env.TRUSTED_PROXY_PEERS, isProduction),
    isLocalDevelopmentOrigin: LOCAL_ORIGIN.test(clientOrigin),
    isProduction,
  }

  if (!isProduction) return config

  const required = ['JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'CLIENT_ORIGIN', 'DATABASE_URL', 'DATABASE_SSL_CA', 'TRUSTED_PROXY_PEERS']
  for (const key of required) requireProductionValue(env, key)

  if (config.jwtSecret === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET must not use the development fallback in production')
  }
  if (!PRODUCTION_JWT_SECRET.test(config.jwtSecret)) {
    throw new Error('JWT_SECRET must be 43-128 base64url characters generated from at least 32 random bytes')
  }

  const productionOrigin = parseAbsoluteUrl(config.clientOrigin, 'CLIENT_ORIGIN')
  if (productionOrigin.protocol !== 'https:' || productionOrigin.origin !== config.clientOrigin) {
    throw new Error('CLIENT_ORIGIN must be an HTTPS origin without a path in production')
  }

  const redirectUri = parseAbsoluteUrl(config.googleRedirectUri, 'GOOGLE_REDIRECT_URI')
  if (redirectUri.protocol !== 'https:' || redirectUri.pathname !== '/auth/google/callback') {
    throw new Error('GOOGLE_REDIRECT_URI must be an HTTPS /auth/google/callback URL in production')
  }

  return config
}
