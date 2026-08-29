const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const DEFAULT_CLIENT_ORIGIN = 'http://localhost:5173'
const DEFAULT_GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback'
const DEFAULT_JWT_SECRET = 'dev-secret-change-me'

export type RuntimeConfig = {
  clientOrigin: string
  googleClientId: string
  googleClientSecret: string
  googleRedirectUri: string
  jwtSecret: string
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
    isLocalDevelopmentOrigin: LOCAL_ORIGIN.test(clientOrigin),
    isProduction,
  }

  if (!isProduction) return config

  const required = ['JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'CLIENT_ORIGIN']
  for (const key of required) requireProductionValue(env, key)

  if (config.jwtSecret === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET must not use the development fallback in production')
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
