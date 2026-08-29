import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { decodeJwt } from 'jose'
import { AUTH_TOKEN_MAX_AGE_SECONDS, createAuthTokenClaims } from './auth-token'

describe('auth token claims', () => {
  test('the installed JWT plugin issues a seven-day cryptographic expiration', async () => {
    const app = new Elysia()
      .use(jwt({ name: 'tokenJwt', secret: 'test-secret-only' }))
      .get('/', ({ tokenJwt }) => tokenJwt.sign(createAuthTokenClaims({ sub: 'user-id', email: 'user@example.com' })))

    const response = await app.handle(new Request('http://localhost/'))
    const payload = decodeJwt(await response.text())
    const now = Math.floor(Date.now() / 1000)

    expect(payload.iat).toBeNumber()
    expect(payload.exp).toBeNumber()
    expect(payload.exp! - payload.iat!).toBe(AUTH_TOKEN_MAX_AGE_SECONDS)
    expect(payload.exp!).toBeGreaterThan(now + AUTH_TOKEN_MAX_AGE_SECONDS - 5)
  })
})
