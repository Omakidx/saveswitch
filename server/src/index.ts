import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { jwt } from '@elysiajs/jwt'

// ── Types for Google API responses ──
interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
  scope: string
  id_token?: string
  refresh_token?: string
}

interface GoogleUserInfo {
  id: string
  email: string
  name: string
  picture: string
  verified_email?: boolean
}

interface GoogleTokenPayload {
  iss: string
  azp: string
  aud: string
  sub: string
  email: string
  email_verified: string
  name: string
  picture: string
  given_name?: string
  family_name?: string
  iat: string
  exp: string
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/auth/google/callback'
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

let userVisibility: 'private' | 'public' = 'public'

const mockPages: Array<{
  id: string
  color: string
  name: string
  created_at: string
  visibility: 'private' | 'public'
}> = []

const app = new Elysia()
  .use(
    cors({
      origin: CLIENT_ORIGIN,
      credentials: true,
    })
  )
  .use(
    jwt({
      name: 'jwt',
      secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    })
  )
  .get('/', () => ({
    name: 'Saveswitch API',
    version: '1.0.0',
    status: 'running',
  }))
  .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // ── Google OAuth: Redirect to consent screen ──
  .get('/auth/google', ({ redirect }) => {
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',
    })
    return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  })

  // ── Google OAuth: Callback ──
  .get('/auth/google/callback', async ({ query, jwt, cookie: { auth_token }, redirect }) => {
    const { code } = query

    if (!code) {
      return redirect(`${CLIENT_ORIGIN}/login?error=no_code`)
    }

    try {
      // Exchange authorization code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code as string,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      })

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text()
        console.error('Token exchange failed:', errBody)
        return redirect(`${CLIENT_ORIGIN}/login?error=token_exchange_failed`)
      }

      const tokenData = (await tokenRes.json()) as GoogleTokenResponse

      // Get user info from Google
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })

      if (!userInfoRes.ok) {
        return redirect(`${CLIENT_ORIGIN}/login?error=userinfo_failed`)
      }

      const userInfo = (await userInfoRes.json()) as GoogleUserInfo

      // Create a JWT with the user info
      const token = await jwt.sign({
        sub: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        iat: true,
      })

      // Set auth cookie
      auth_token?.set({
        value: token,
        httpOnly: true,
        secure: false, // set true in production
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      })

      // Redirect to dashboard
      return redirect(`${CLIENT_ORIGIN}/dashboard?auth=success`)

    } catch (err) {
      console.error('OAuth callback error:', err)
      return redirect(`${CLIENT_ORIGIN}/login?error=callback_failed`)
    }
  })

  // ── Google One Tap: Verify credential token ──
  .post('/auth/google/one-tap', async ({ body, jwt, cookie: { auth_token } }) => {
    const { credential } = body as { credential: string }

    if (!credential) {
      return { success: false, error: 'No credential provided' }
    }

    try {
      // Verify the ID token with Google
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
      )

      if (!verifyRes.ok) {
        return { success: false, error: 'Invalid token' }
      }

      const payload = (await verifyRes.json()) as GoogleTokenPayload

      // Verify the audience matches our client ID
      if (payload.aud !== GOOGLE_CLIENT_ID) {
        return { success: false, error: 'Token audience mismatch' }
      }

      // Create JWT
      const token = await jwt.sign({
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        iat: true,
      })

      // Set auth cookie
      auth_token?.set({
        value: token,
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      })

      return {
        success: true,
        user: {
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
        },
      }
    } catch (err) {
      console.error('One Tap verification error:', err)
      return { success: false, error: 'Verification failed' }
    }
  })

  // ── Auth: Get current user ──
  .get('/auth/me', async ({ jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) {
      return { authenticated: false }
    }

    try {
      const payload = await jwt.verify(token)
      if (!payload) {
        return { authenticated: false }
      }
      return {
        authenticated: true,
        user: {
          id: payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
        },
      }
    } catch {
      return { authenticated: false }
    }
  })

  // ── Auth: Logout ──
  .post('/auth/logout', ({ cookie: { auth_token } }) => {
    auth_token?.set({
      value: '',
      maxAge: 0,
      path: '/',
    })
    return { success: true }
  })

  // ══════════════════════════════════════════════
  // ── Mock Data (temporary until Neon Postgres) ──
  // ══════════════════════════════════════════════

  // ── GET /pages — List user's pages ──
  .get('/pages', async ({ jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) {
      return { pages: mockPages }
    }

    try {
      const payload = await jwt.verify(token)
      if (!payload) {
        return { pages: mockPages }
      }
      // In production, filter by user_id from payload.sub
      return { pages: mockPages }
    } catch {
      return { pages: mockPages }
    }
  })

  // ── POST /pages — Create a new page ──
  .post('/pages', async ({ body, jwt, cookie: { auth_token } }) => {
    const { color, name } = body as { color: string; name: string }

    if (!color || !name) {
      return { success: false, error: 'color and name are required' }
    }

    const created_at = new Date().toISOString()
    const dateStr = created_at.split('T')[0] as string
    const duplicate = mockPages.find(p => p.name === name && p.created_at.startsWith(dateStr))
    if (duplicate) {
      return { success: false, error: 'A page with this name already exists today' }
    }

    const newPage = {
      id: crypto.randomUUID(),
      color,
      name,
      created_at,
      visibility: 'private' as const,
    }

    mockPages.push(newPage)
    return { success: true, page: newPage }
  })

  // ── PATCH /pages/:id — Update a page name ──
  .patch('/pages/:id', async ({ params, body }) => {
    const { id } = params
    const { name } = body as { name: string }

    if (!name) {
      return { success: false, error: 'name is required' }
    }

    const page = mockPages.find((p) => p.id === id)
    if (!page) {
      return { success: false, error: 'page not found' }
    }

    const dateStr = page.created_at.split('T')[0] as string
    const duplicate = mockPages.find(p => p.id !== id && p.name === name && p.created_at.startsWith(dateStr))
    if (duplicate) {
      return { success: false, error: 'A page with this name already exists on this day' }
    }

    page.name = name
    return { success: true, page }
  })

  // ── DELETE /pages/:id — Delete a page ──
  .delete('/pages/:id', async ({ params }) => {
    const { id } = params

    const index = mockPages.findIndex((p) => p.id === id)
    if (index === -1) {
      return { success: false, error: 'page not found' }
    }

    mockPages.splice(index, 1)
    return { success: true }
  })

  // ── PATCH /users/me/visibility — Toggle private/public space ──
  .patch('/users/me/visibility', async ({ body, jwt, cookie: { auth_token } }) => {
    const { visibility } = body as { visibility: string }

    if (!visibility || !['private', 'public'].includes(visibility)) {
      return { success: false, error: 'visibility must be "private" or "public"' }
    }

    // In production, update the user's visibility in the database
    userVisibility = visibility as 'private' | 'public'
    return { success: true, visibility: userVisibility }
  })

  .listen(Number(process.env.PORT) || 5000)

console.log(
  `🚀 Saveswitch API running at http://${app.server?.hostname}:${app.server?.port}`
)
