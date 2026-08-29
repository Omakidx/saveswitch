import { describe, expect, test } from 'bun:test'
import { resolveRuntimeConfig } from './runtime-config'

const productionEnv = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-production-only-secret',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'https://api.example.com/auth/google/callback',
  CLIENT_ORIGIN: 'https://app.example.com',
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
  })

  test('rejects missing or unsafe production configuration', () => {
    expect(() => resolveRuntimeConfig({ ...productionEnv, JWT_SECRET: undefined })).toThrow('JWT_SECRET')
    expect(() => resolveRuntimeConfig({ ...productionEnv, CLIENT_ORIGIN: 'http://localhost:5173' })).toThrow('CLIENT_ORIGIN')
    expect(() => resolveRuntimeConfig({ ...productionEnv, GOOGLE_REDIRECT_URI: 'https://api.example.com/other' })).toThrow('GOOGLE_REDIRECT_URI')
  })
})
