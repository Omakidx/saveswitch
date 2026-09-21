import { describe, expect, test } from 'bun:test'
import { resolveRuntimeConfig } from './runtime-config'

const productionEnv = {
  NODE_ENV: 'production',
  JWT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'https://api.example.com/auth/google/callback',
  CLIENT_ORIGIN: 'https://app.example.com',
  DATABASE_URL: 'postgres://user:password@database.example.com:5432/saveswitch',
  DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\ntrusted-ca\n-----END CERTIFICATE-----',
  TRUSTED_PROXY_PEERS: '127.0.0.1,::1,172.30.250.1',
}

describe('resolveRuntimeConfig', () => {
  test('keeps local development defaults available', () => {
    expect(resolveRuntimeConfig({ NODE_ENV: 'development' }).clientOrigin).toBe('http://localhost:5173')
  })

  test('accepts explicit HTTPS production OAuth configuration', () => {
    expect(resolveRuntimeConfig(productionEnv)).toMatchObject({
      clientOrigin: 'https://app.example.com',
      googleRedirectUri: 'https://api.example.com/auth/google/callback',
      isProduction: true,
    })
    expect(resolveRuntimeConfig(productionEnv).trustedProxyPeers).toEqual(new Set([
      '127.0.0.1',
      '::1',
      '172.30.250.1',
    ]))
  })

  test('rejects missing or unsafe production configuration', () => {
    expect(() => resolveRuntimeConfig({ ...productionEnv, JWT_SECRET: undefined })).toThrow('JWT_SECRET')
    expect(() => resolveRuntimeConfig({ ...productionEnv, CLIENT_ORIGIN: 'http://localhost:5173' })).toThrow('CLIENT_ORIGIN')
    expect(() => resolveRuntimeConfig({ ...productionEnv, GOOGLE_REDIRECT_URI: 'https://api.example.com/other' })).toThrow('GOOGLE_REDIRECT_URI')
    expect(() => resolveRuntimeConfig({ ...productionEnv, DATABASE_SSL_CA: undefined })).toThrow('DATABASE_SSL_CA')
    expect(() => resolveRuntimeConfig({ ...productionEnv, TRUSTED_PROXY_PEERS: undefined })).toThrow('TRUSTED_PROXY_PEERS')
    expect(() => resolveRuntimeConfig({ ...productionEnv, TRUSTED_PROXY_PEERS: '127.0.0.1, 172.30.250.1' })).toThrow('TRUSTED_PROXY_PEERS')
    expect(() => resolveRuntimeConfig({ ...productionEnv, TRUSTED_PROXY_PEERS: '127.0.0.1,127.0.0.1' })).toThrow('TRUSTED_PROXY_PEERS')
    expect(() => resolveRuntimeConfig({ ...productionEnv, JWT_SECRET: 'x' })).toThrow('JWT_SECRET')
    expect(() => resolveRuntimeConfig({ ...productionEnv, JWT_SECRET: 'not random enough despite spaces................................' })).toThrow('JWT_SECRET')
  })
})
