import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { jwt } from '@elysiajs/jwt'
import { db } from './db'
import { users, pages, resources } from './db/schema'
import { eq, and, inArray, isNotNull, lt } from 'drizzle-orm'
import {
  CloudinaryConfigurationError,
  ImageUploadError,
  ImageValidationError,
  uploadImage,
  uploadResource,
} from './utils/cloudinary'
import { fetchOpenGraphData } from './utils/opengraph'

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

type UserProfileUpdateBody = {
  name?: unknown
  picture?: unknown
  username?: unknown
}

const ADJECTIVES = ['duck', 'woo', 'back', 'cool', 'fast', 'smart', 'brave', 'wild', 'epic', 'super', 'neon', 'dark', 'light', 'cyber', 'retro', 'ultra'];
const NOUNS = ['se', 'king', 'combo', 'star', 'wolf', 'bear', 'hawk', 'fox', 'lion', 'tiger', 'dragon', 'ninja', 'knight', 'wizard', 'hero'];

const generateRandomUsername = () => {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}_${noun}${num.toString().padStart(2, '0')}`;
}

const RESOURCE_TYPES = ['link', 'image', 'text', 'pdf', 'file'] as const
type ResourceType = (typeof RESOURCE_TYPES)[number]

class ResourceValidationError extends Error {}

const isResourceType = (value: unknown): value is ResourceType =>
  typeof value === 'string' && RESOURCE_TYPES.includes(value as ResourceType)

const randomResourceCoordinate = () => 100 + Math.floor(Math.random() * 200)

const normalizeResourceCoordinate = (value: unknown, fallback: number) => {
  if (value === undefined || value === null) return fallback

  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) {
    throw new ResourceValidationError('Resource position is invalid')
  }

  const coordinate = Math.round(numericValue)
  if (coordinate < -2147483648 || coordinate > 2147483647) {
    throw new ResourceValidationError('Resource position is out of range')
  }

  return coordinate
}

const getRequiredString = (value: unknown, fieldName: string) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ResourceValidationError(`${fieldName} is required`)
  }

  return value.trim()
}

const getOptionalString = (value: unknown) => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new ResourceValidationError('Resource title must be text')
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const XOOMSHARE_TTL_HOURS = 3
const XOOMSHARE_TTL_MS = XOOMSHARE_TTL_HOURS * 60 * 60 * 1000
const XOOMSHARE_CLEANUP_INTERVAL_MS = 60 * 1000
const RESERVED_PATH_CODES = new Set([
  'api',
  'auth',
  'dashboard',
  'link',
  'login',
  'public',
  'register',
  'xoomshare',
])

type XoomshareCreateBody = {
  pathCode?: unknown
}

const generatePathCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return code
}

const normalizePathCode = (value: unknown) => {
  if (value === undefined || value === null || value === '') return generatePathCode()
  if (typeof value !== 'string') {
    throw new ResourceValidationError('Secret page code must be text')
  }

  const pathCode = value.trim()
  if (pathCode.length < 3 || pathCode.length > 48) {
    throw new ResourceValidationError('Secret page code must be between 3 and 48 characters')
  }

  if (!/^[A-Za-z0-9_-]+$/.test(pathCode)) {
    throw new ResourceValidationError('Use letters, numbers, hyphens, or underscores only')
  }

  if (RESERVED_PATH_CODES.has(pathCode.toLowerCase()) || pathCode.startsWith('@')) {
    throw new ResourceValidationError('That secret page code is reserved')
  }

  return pathCode
}

const getEffectiveXoomshareExpiresAt = (page: typeof pages.$inferSelect) => {
  if (!page.sessionId && !page.expiresAt) return null

  const ttlExpiry = new Date(page.createdAt.getTime() + XOOMSHARE_TTL_MS)
  if (!page.expiresAt) return ttlExpiry

  return page.expiresAt.getTime() <= ttlExpiry.getTime() ? page.expiresAt : ttlExpiry
}

const formatPage = (page: typeof pages.$inferSelect) => {
  const { sessionId: _sessionId, ...safePage } = page
  const effectiveExpiresAt = getEffectiveXoomshareExpiresAt(page)
  return {
    ...safePage,
    created_at: page.createdAt.toISOString(),
    expires_at: effectiveExpiresAt ? effectiveExpiresAt.toISOString() : null,
  }
}

const formatResource = (resource: typeof resources.$inferSelect) => ({
  ...resource,
  created_at: resource.createdAt.toISOString(),
})

const isExpired = (expiresAt: Date | null) => {
  return !!expiresAt && expiresAt.getTime() <= Date.now()
}

const isPageExpired = (page: typeof pages.$inferSelect) => {
  return isExpired(getEffectiveXoomshareExpiresAt(page))
}

const cleanupExpiredXoomshareRooms = async () => {
  try {
    const deletedPages = await db.delete(pages)
      .where(and(isNotNull(pages.expiresAt), lt(pages.expiresAt, new Date())))
      .returning({ id: pages.id })
    const expiredByTtlPages = await db.delete(pages)
      .where(and(isNotNull(pages.sessionId), lt(pages.createdAt, new Date(Date.now() - XOOMSHARE_TTL_MS))))
      .returning({ id: pages.id })

    const deletedCount = deletedPages.length + expiredByTtlPages.length
    if (deletedCount > 0) {
      console.log(`Deleted ${deletedCount} expired Xoomshare page(s)`)
    }
  } catch (error) {
    console.error('Expired Xoomshare cleanup failed:', error)
  }
}

void cleanupExpiredXoomshareRooms()
setInterval(() => {
  void cleanupExpiredXoomshareRooms()
}, XOOMSHARE_CLEANUP_INTERVAL_MS)

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
  .ws('/ws', {
    message(ws, message: any) {
      let msg = message;
      if (typeof message === 'string') {
        try { msg = JSON.parse(message); } catch {}
      }
      if (typeof msg === 'object' && msg !== null && msg.type === 'subscribe' && msg.pageId != null) {
        ws.subscribe(`page_${msg.pageId}`)
      }
    }
  })
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
        return redirect(`${CLIENT_ORIGIN}/login?error=token_exchange_failed`)
      }

      const tokenData = (await tokenRes.json()) as GoogleTokenResponse

      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })

      if (!userInfoRes.ok) {
        return redirect(`${CLIENT_ORIGIN}/login?error=userinfo_failed`)
      }

      const userInfo = (await userInfoRes.json()) as GoogleUserInfo

      // Upsert user into database
      const existingUser = await db.select().from(users).where(eq(users.id, userInfo.id)).limit(1)
      if (existingUser.length === 0) {
        let uniqueUsername = generateRandomUsername()
        // Try up to 5 times to ensure uniqueness (very unlikely to clash)
        for (let i = 0; i < 5; i++) {
          const clash = await db.select().from(users).where(eq(users.username, uniqueUsername)).limit(1)
          if (clash.length === 0) break
          uniqueUsername = generateRandomUsername()
        }
        await db.insert(users).values({
          id: userInfo.id,
          email: userInfo.email,
          name: userInfo.name,
          picture: userInfo.picture,
          username: uniqueUsername,
        })
      }

      const token = await jwt.sign({
        sub: userInfo.id,
        email: userInfo.email,
        iat: true,
      })

      auth_token?.set({
        value: token,
        httpOnly: true,
        secure: false, // set true in production
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      })

      return redirect(`${CLIENT_ORIGIN}/dashboard`)
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
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
      )

      if (!verifyRes.ok) {
        return { success: false, error: 'Invalid token' }
      }

      const payload = (await verifyRes.json()) as GoogleTokenPayload

      if (payload.aud !== GOOGLE_CLIENT_ID) {
        return { success: false, error: 'Token audience mismatch' }
      }

      // Upsert user into database
      const existingUser = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1)
      if (existingUser.length === 0) {
        let uniqueUsername = generateRandomUsername()
        for (let i = 0; i < 5; i++) {
          const clash = await db.select().from(users).where(eq(users.username, uniqueUsername)).limit(1)
          if (clash.length === 0) break
          uniqueUsername = generateRandomUsername()
        }
        await db.insert(users).values({
          id: payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          username: uniqueUsername,
        })
      }

      const token = await jwt.sign({
        sub: payload.sub,
        email: payload.email,
        iat: true,
      })

      auth_token?.set({
        value: token,
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      })

      const finalUser = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1)

      return {
        success: true,
        user: finalUser[0],
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
      
      const user = await db.select().from(users).where(eq(users.id, payload.sub as string)).limit(1)
      if (user.length === 0) {
         return { authenticated: false }
      }

      return {
        authenticated: true,
        user: user[0],
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

  // ── Auth: Check username availability ──
  .get('/users/check-username', async ({ query, jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { available: false, error: 'unauthorized' }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { available: false, error: 'invalid token' }

      const { username } = query as { username?: string }
      if (!username || typeof username !== 'string') {
        return { available: false, error: 'username query parameter is required' }
      }

      if (username.trim().length < 3 || username.trim().length > 20) {
        return { available: false, error: 'must be between 3 and 20 characters' }
      }

      const cleanUsername = username.trim().toLowerCase()
      if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
        return { available: false, error: 'lowercase letters, numbers, underscores only' }
      }

      const clash = await db.select().from(users).where(eq(users.username, cleanUsername)).limit(1)
      if (clash.length > 0 && clash[0]!.id !== payload.sub) {
        return { available: false, error: 'already taken' }
      }

      return { available: true }
    } catch {
      return { available: false, error: 'server error' }
    }
  })

  // ── Auth: Update current user profile ──
  .patch('/users/me', async ({ body, jwt, cookie: { auth_token }, set }) => {
    const token = auth_token?.value as string | undefined
    if (!token) {
      set.status = 401
      return { success: false, error: 'unauthorized' }
    }

    try {
      const payload = await jwt.verify(token)
      if (!payload) {
        set.status = 401
        return { success: false, error: 'invalid token' }
      }

      if (!body || typeof body !== 'object') {
        set.status = 400
        return { success: false, error: 'Request body is required' }
      }

      const { name, picture, username } = body as UserProfileUpdateBody
      
      const updateData: Partial<typeof users.$inferInsert> = {}
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          set.status = 400
          return { success: false, error: 'Display name is required' }
        }

        updateData.name = name.trim()
      }

      if (username !== undefined) {
        if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 20) {
          set.status = 400
          return { success: false, error: 'Username must be between 3 and 20 characters' }
        }
        
        const cleanUsername = username.trim().toLowerCase()
        if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
          set.status = 400
          return { success: false, error: 'Username can only contain lowercase letters, numbers, and underscores' }
        }

        // Check uniqueness
        const clash = await db.select().from(users).where(eq(users.username, cleanUsername)).limit(1)
        if (clash.length > 0 && clash[0]!.id !== payload.sub) {
          set.status = 400
          return { success: false, error: 'Username is already taken' }
        }

        updateData.username = cleanUsername
      }

      if (picture !== undefined && typeof picture !== 'string') {
        set.status = 400
        return { success: false, error: 'Profile image must be a string' }
      }

      if (picture && picture.startsWith('data:image')) {
        updateData.picture = await uploadImage(picture)
      }

      if (Object.keys(updateData).length > 0) {
        const updatedUser = await db.update(users)
          .set(updateData)
          .where(eq(users.id, payload.sub as string))
          .returning()

        if (updatedUser.length === 0) {
          set.status = 404
          return { success: false, error: 'User not found' }
        }
          
        return { success: true, user: updatedUser[0] }
      }

      set.status = 400
      return { success: false, error: 'No data to update' }
    } catch (e: unknown) {
      console.error(e)

      if (e instanceof ImageValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }

      if (e instanceof CloudinaryConfigurationError) {
        set.status = 500
        return { success: false, error: e.message }
      }

      if (e instanceof ImageUploadError) {
        set.status = 502
        return { success: false, error: e.message }
      }

      set.status = 500
      return { success: false, error: e instanceof Error ? e.message : 'server error' }
    }
  })

  // ── PATCH /users/me/visibility — Toggle private/public space ──
  .patch('/users/me/visibility', async ({ body, jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { success: false, error: 'unauthorized' }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { success: false, error: 'invalid token' }

      const { visibility } = body as { visibility: string }
      if (!visibility || !['private', 'public'].includes(visibility)) {
        return { success: false, error: 'visibility must be "private" or "public"' }
      }

      const updatedUser = await db.update(users)
        .set({ visibility: visibility as 'private' | 'public' })
        .where(eq(users.id, payload.sub as string))
        .returning()

      if (updatedUser.length === 0) {
        return { success: false, error: 'User not found' }
      }

      return { success: true, visibility: updatedUser[0]!.visibility }
    } catch {
      return { success: false, error: 'server error' }
    }
  })

  // ══════════════════════════════════════════════
  // ── Xoomshare API (anonymous rooms) ──
  // ══════════════════════════════════════════════

  // ── POST /xoomshare — Create an anonymous room ──
  .post('/xoomshare', async ({ body, cookie: { xoomshare_session }, set }) => {
    try {
      let pathCode = normalizePathCode((body as XoomshareCreateBody | undefined)?.pathCode)

      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await db.select().from(pages).where(eq(pages.pathCode, pathCode)).limit(1)
        if (existing.length === 0) break
        if ((body as XoomshareCreateBody | undefined)?.pathCode) {
          set.status = 409
          return { success: false, error: 'That secret page code is already in use' }
        }
        pathCode = generatePathCode()
      }

      const sessionId = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + XOOMSHARE_TTL_HOURS * 60 * 60 * 1000)
      const newPage = await db.insert(pages).values({
        userId: null,
        color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 85%)`,
        name: `Xoomshare ${pathCode}`,
        visibility: 'public',
        pathCode,
        sessionId,
        expiresAt,
      }).returning()

      if (newPage.length === 0) {
        set.status = 500
        return { success: false, error: 'Unable to create Xoomshare page' }
      }

      xoomshare_session?.set({
        value: sessionId,
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: XOOMSHARE_TTL_HOURS * 60 * 60,
        path: '/',
      })

      set.status = 201
      return {
        success: true,
        room: {
          ...formatPage(newPage[0]!),
          isOwner: true,
        },
      }
    } catch (e: unknown) {
      console.error('Create Xoomshare room failed:', e)

      if (e instanceof ResourceValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }

      set.status = 500
      return { success: false, error: 'Unable to create Xoomshare page' }
    }
  })

  // ── GET /xoomshare/:pathCode — Fetch an anonymous room ──
  .get('/xoomshare/:pathCode', async ({ params, cookie: { xoomshare_session }, set }) => {
    try {
      // Find the main room entry via pathCode
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      const sessionId = room[0]!.sessionId;
      const isOwner = xoomshare_session?.value === sessionId;
      const callerSession = xoomshare_session?.value || null;

      // Fetch all pages sharing this sessionId (multi-page support)
      let allPages = [];
      if (sessionId) {
        allPages = await db.select().from(pages).where(eq(pages.sessionId, sessionId));
      } else {
        // Fallback for very old rooms without sessionId (unlikely but safe)
        allPages = [room[0]!];
      }

      const pageIds = allPages.map(p => p.id);
      
      // Fetch all resources across all pages in the room
      let pageResources: typeof resources.$inferSelect[] = [];
      if (pageIds.length > 0) {
         pageResources = await db.select().from(resources).where(inArray(resources.pageId, pageIds));
      }

      return {
        success: true,
        room: {
          ...formatPage(room[0]!),
          isOwner,
          allowGuestResources: room[0]!.allowGuestResources,
        },
        pages: allPages.map(p => formatPage(p)),
        resources: pageResources.map(r => ({
          ...formatResource(r),
          isOwner: isOwner || (!!callerSession && r.sessionId === callerSession),
        })),
      }
    } catch (e) {
      console.error('Fetch Xoomshare room failed:', e)
      set.status = 500
      return { success: false, error: 'Unable to load Xoomshare page' }
    }
  })

  // ── POST /xoomshare/:pathCode/pages — Add a new page to an anonymous room ──
  .post('/xoomshare/:pathCode/pages', async ({ params, body, cookie: { xoomshare_session }, set }) => {
    try {
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare room not found or expired' }
      }

      if (!xoomshare_session?.value || xoomshare_session.value !== room[0]!.sessionId) {
        set.status = 403
        return { success: false, error: 'Only the creator can add pages' }
      }

      // Check page limit (e.g., max 10 pages)
      const existingPages = await db.select().from(pages).where(eq(pages.sessionId, room[0]!.sessionId!))
      if (existingPages.length >= 10) {
        set.status = 400
        return { success: false, error: 'Maximum of 10 pages allowed per Xoomshare room' }
      }

      const { name } = (body || {}) as { name?: string }
      const newPageName = name || `Page ${existingPages.length + 1}`
      const vibrantColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 85%)`

      const newPage = await db.insert(pages).values({
        userId: null,
        color: vibrantColor,
        name: newPageName,
        visibility: 'public',
        pathCode: null, // Only the root page has the pathCode
        sessionId: room[0]!.sessionId,
        expiresAt: room[0]!.expiresAt,
      }).returning()

      if (app.server) {
        app.server.publish(`page_${room[0]!.id}`, JSON.stringify({ type: 'page_added', pageId: newPage[0]!.id }))
      }

      set.status = 201
      return { success: true, page: formatPage(newPage[0]!) }
    } catch (e) {
      console.error('Create Xoomshare page failed:', e)
      set.status = 500
      return { success: false, error: 'Unable to create page' }
    }
  })

  // ── PATCH /xoomshare/:pathCode/pages/:id — Rename a page in an anonymous room ──
  .patch('/xoomshare/:pathCode/pages/:id', async ({ params, body, cookie: { xoomshare_session }, set }) => {
    try {
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare room not found or expired' }
      }

      if (!xoomshare_session?.value || xoomshare_session.value !== room[0]!.sessionId) {
        set.status = 403
        return { success: false, error: 'Only the creator can rename pages' }
      }

      const { name } = body as { name: string }
      if (!name || name.trim() === '') {
        set.status = 400
        return { success: false, error: 'Name is required' }
      }

      const pageToUpdate = await db.select().from(pages).where(
        and(eq(pages.id, params.id), eq(pages.sessionId, room[0]!.sessionId!))
      ).limit(1)

      if (pageToUpdate.length === 0) {
        set.status = 404
        return { success: false, error: 'Page not found in this room' }
      }

      const updatedPage = await db.update(pages)
        .set({ name: name.trim() })
        .where(eq(pages.id, params.id))
        .returning()

      if (app.server) {
        app.server.publish(`page_${room[0]!.id}`, JSON.stringify({ type: 'page_updated', pageId: params.id }))
      }

      return { success: true, page: formatPage(updatedPage[0]!) }
    } catch (e) {
      console.error('Rename Xoomshare page failed:', e)
      set.status = 500
      return { success: false, error: 'Unable to rename page' }
    }
  })

  // ── DELETE /xoomshare/:pathCode/pages/:id — Delete a page in an anonymous room ──
  .delete('/xoomshare/:pathCode/pages/:id', async ({ params, cookie: { xoomshare_session }, set }) => {
    try {
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare room not found or expired' }
      }

      if (!xoomshare_session?.value || xoomshare_session.value !== room[0]!.sessionId) {
        set.status = 403
        return { success: false, error: 'Only the creator can delete pages' }
      }

      // Check if it's the last page
      const existingPages = await db.select().from(pages).where(eq(pages.sessionId, room[0]!.sessionId!))
      if (existingPages.length <= 1) {
        set.status = 400
        return { success: false, error: 'Cannot delete the only page in the room' }
      }

      const pageToDelete = existingPages.find(p => p.id === params.id)
      if (!pageToDelete) {
        set.status = 404
        return { success: false, error: 'Page not found in this room' }
      }
      
      // If deleting the root page (which holds the pathCode), move the pathCode to another page
      if (pageToDelete.pathCode) {
        const nextRoot = existingPages.find(p => p.id !== params.id)
        if (nextRoot) {
          await db.update(pages).set({ pathCode: pageToDelete.pathCode }).where(eq(pages.id, nextRoot.id))
        }
      }

      await db.delete(pages).where(eq(pages.id, params.id))

      if (app.server) {
        app.server.publish(`page_${room[0]!.id}`, JSON.stringify({ type: 'page_deleted', pageId: params.id }))
      }

      return { success: true }
    } catch (e) {
      console.error('Delete Xoomshare page failed:', e)
      set.status = 500
      return { success: false, error: 'Unable to delete page' }
    }
  })


  // ── PATCH /xoomshare/:pathCode/settings — Toggle room settings (creator only) ──
  .patch('/xoomshare/:pathCode/settings', async ({ params, body, cookie: { xoomshare_session }, set }) => {
    try {
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      if (!xoomshare_session?.value || xoomshare_session.value !== room[0]!.sessionId) {
        set.status = 403
        return { success: false, error: 'Only the creator can change settings' }
      }

      const { allowGuestResources } = body as { allowGuestResources?: boolean }
      if (typeof allowGuestResources !== 'boolean') {
        set.status = 400
        return { success: false, error: 'allowGuestResources must be a boolean' }
      }

      // Update all pages in the room
      const sessionId = room[0]!.sessionId!
      await db.update(pages).set({ allowGuestResources }).where(eq(pages.sessionId, sessionId))

      if (app.server) {
        app.server.publish(`page_${room[0]!.id}`, JSON.stringify({ type: 'settings_updated' }))
      }

      return { success: true, allowGuestResources }
    } catch (e) {
      console.error('Update Xoomshare settings failed:', e)
      set.status = 500
      return { success: false, error: 'Unable to update settings' }
    }
  })

  // ── DELETE /xoomshare/:pathCode — Destroy an entire anonymous room (creator only) ──
  .delete('/xoomshare/:pathCode', async ({ params, cookie: { xoomshare_session }, set }) => {
    try {
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      if (!xoomshare_session?.value || xoomshare_session.value !== room[0]!.sessionId) {
        set.status = 403
        return { success: false, error: 'Only the creator can destroy the session' }
      }

      const sessionId = room[0]!.sessionId!

      if (app.server) {
        app.server.publish(`page_${room[0]!.id}`, JSON.stringify({ type: 'room_destroyed' }))
      }

      await db.delete(pages).where(eq(pages.sessionId, sessionId))

      return { success: true }
    } catch (e) {
      console.error('Destroy Xoomshare session failed:', e)
      set.status = 500
      return { success: false, error: 'Unable to destroy session' }
    }
  })

  // ── POST /xoomshare/:pathCode/resources — Add a resource to an anonymous room ──
  .post('/xoomshare/:pathCode/resources', async ({ params, body, cookie: { xoomshare_session }, set }) => {
    try {
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      const isRoomOwner = xoomshare_session?.value && xoomshare_session.value === room[0]!.sessionId
      if (!isRoomOwner && !room[0]!.allowGuestResources) {
        set.status = 403
        return { success: false, error: 'Only the device that created this Xoomshare page can add resources' }
      }

      const requestBody = body as { type?: unknown; content?: unknown; title?: unknown; x?: unknown; y?: unknown; pageId?: unknown }
      const { type, content, title, x, y, pageId } = requestBody

      if (!isResourceType(type)) {
        throw new ResourceValidationError('Resource type is not supported')
      }

      const requestContent = getRequiredString(content, 'Resource content')
      const requestTitle = getOptionalString(title)
      const resourceX = normalizeResourceCoordinate(x, randomResourceCoordinate())
      const resourceY = normalizeResourceCoordinate(y, randomResourceCoordinate())
      const requestedPageId = typeof pageId === 'string' && pageId.trim().length > 0 ? pageId.trim() : room[0]!.id

      let targetPage = room[0]!
      if (requestedPageId !== room[0]!.id) {
        if (!room[0]!.sessionId) {
          set.status = 404
          return { success: false, error: 'Target page not found in this room' }
        }

        const pageInRoom = await db.select().from(pages).where(
          and(eq(pages.id, requestedPageId), eq(pages.sessionId, room[0]!.sessionId))
        ).limit(1)

        if (pageInRoom.length === 0) {
          set.status = 404
          return { success: false, error: 'Target page not found in this room' }
        }

        targetPage = pageInRoom[0]!
      }

      let finalContent = requestContent
      let finalTitle = requestTitle
      let finalDescription = null
      let finalThumbnailUrl = null

      if (type === 'image' || type === 'pdf' || type === 'file') {
        if (requestContent.startsWith('data:')) {
          finalContent = await uploadResource(requestContent, type)
        }
      } else if (type === 'link') {
        const parsedUrl = new URL(requestContent)
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          throw new ResourceValidationError('Only http and https links are supported')
        }

        const ogData = await fetchOpenGraphData(requestContent)
        if (ogData.title) finalTitle = ogData.title
        finalDescription = ogData.description
        finalThumbnailUrl = ogData.thumbnailUrl
      }

      const newResource = await db.insert(resources).values({
        pageId: targetPage.id,
        type,
        content: finalContent,
        title: finalTitle,
        description: finalDescription,
        thumbnailUrl: finalThumbnailUrl,
        x: resourceX,
        y: resourceY,
        sessionId: (xoomshare_session?.value as string) || null,
      }).returning()

      if (app.server) {
        app.server.publish(`page_${room[0]!.id}`, JSON.stringify({ type: 'resource_updated' }))
      }

      set.status = 201
      return { success: true, resource: formatResource(newResource[0]!) }
    } catch (e: unknown) {
      console.error('Create Xoomshare resource failed:', e)

      if (e instanceof ResourceValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }

      if (e instanceof TypeError) {
        set.status = 400
        return { success: false, error: 'Link URL is invalid.' }
      }

      if (e instanceof ImageValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }

      if (e instanceof CloudinaryConfigurationError) {
        set.status = 500
        return { success: false, error: 'Uploads are not configured correctly.' }
      }

      if (e instanceof ImageUploadError) {
        set.status = 502
        return { success: false, error: 'Upload failed. Please try again.' }
      }

      set.status = 500
      return { success: false, error: 'Unable to save this resource right now. Please try again.' }
    }
  })

  // ── PATCH /xoomshare/:pathCode/resources/:id/position — Move an anonymous resource ──
  .patch('/xoomshare/:pathCode/resources/:id/position', async ({ params, body, cookie: { xoomshare_session }, set }) => {
    try {
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      const isRoomOwner = xoomshare_session?.value && xoomshare_session.value === room[0]!.sessionId
      // We'll check resource-level ownership below after fetching the resource

      const { x, y } = body as { x?: unknown; y?: unknown }
      const resourceX = normalizeResourceCoordinate(x, 100)
      const resourceY = normalizeResourceCoordinate(y, 100)
      const roomPages = room[0]!.sessionId
        ? await db.select({ id: pages.id }).from(pages).where(eq(pages.sessionId, room[0]!.sessionId))
        : [{ id: room[0]!.id }]
      const roomPageIds = roomPages.map((page) => page.id)

      // Fetch resource first to check ownership
      const [existingResource] = await db.select().from(resources)
        .where(and(eq(resources.id, params.id), inArray(resources.pageId, roomPageIds)))
        .limit(1)

      if (!existingResource) {
        set.status = 404
        return { success: false, error: 'Resource not found' }
      }

      const isResourceOwner = !!xoomshare_session?.value && existingResource.sessionId === xoomshare_session.value
      if (!isRoomOwner && !isResourceOwner) {
        set.status = 403
        return { success: false, error: 'You can only move your own resources' }
      }

      const [updatedResource] = await db.update(resources)
        .set({ x: resourceX, y: resourceY })
        .where(eq(resources.id, params.id))
        .returning()

      if (app.server) {
        app.server.publish(`page_${room[0]!.id}`, JSON.stringify({ type: 'resource_updated' }))
      }

      return { success: true, resource: formatResource(updatedResource!) }
    } catch (e: unknown) {
      console.error('Update Xoomshare resource position failed:', e)

      if (e instanceof ResourceValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }

      set.status = 500
      return { success: false, error: 'Unable to move this resource right now.' }
    }
  })

  // ── DELETE /xoomshare/:pathCode/resources/:id — Delete an anonymous resource ──
  .delete('/xoomshare/:pathCode/resources/:id', async ({ params, cookie: { xoomshare_session }, set }) => {
    try {
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      const isRoomOwner = xoomshare_session?.value && xoomshare_session.value === room[0]!.sessionId

      const roomPages = room[0]!.sessionId
        ? await db.select({ id: pages.id }).from(pages).where(eq(pages.sessionId, room[0]!.sessionId))
        : [{ id: room[0]!.id }]
      const roomPageIds = roomPages.map((page) => page.id)

      // Fetch resource to check ownership
      const [existingResource] = await db.select().from(resources)
        .where(and(eq(resources.id, params.id), inArray(resources.pageId, roomPageIds)))
        .limit(1)

      if (!existingResource) {
        set.status = 404
        return { success: false, error: 'Resource not found' }
      }

      const isResourceOwner = !!xoomshare_session?.value && existingResource.sessionId === xoomshare_session.value
      if (!isRoomOwner && !isResourceOwner) {
        set.status = 403
        return { success: false, error: 'You can only delete your own resources' }
      }

      await db.delete(resources).where(eq(resources.id, params.id))

      if (app.server) {
        app.server.publish(`page_${room[0]!.id}`, JSON.stringify({ type: 'resource_updated' }))
      }

      return { success: true }
    } catch (e) {
      console.error('Delete Xoomshare resource failed:', e)
      set.status = 500
      return { success: false, error: 'Unable to delete this resource right now.' }
    }
  })

  // ══════════════════════════════════════════════
  // ── Pages API ──
  // ══════════════════════════════════════════════

  // ── GET /pages — List user's pages ──
  .get('/pages', async ({ query, jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { pages: [] }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { pages: [] }

      const { visibility } = query as { visibility?: string }
      let userPages;

      if (visibility === 'public' || visibility === 'private') {
        userPages = await db.select().from(pages).where(
          and(
            eq(pages.userId, payload.sub as string),
            eq(pages.visibility, visibility)
          )
        )
      } else {
        userPages = await db.select().from(pages).where(eq(pages.userId, payload.sub as string))
      }
      
      return { pages: userPages.map(p => ({ ...p, created_at: p.createdAt.toISOString() })) }
    } catch {
      return { pages: [] }
    }
  })

  // ── POST /pages — Create a new page ──
  .post('/pages', async ({ body, jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { success: false, error: 'unauthorized' }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { success: false, error: 'invalid token' }

      const { color, name, visibility = 'private' } = body as { color: string; name: string; visibility?: string }

      if (!color || !name) {
        return { success: false, error: 'color and name are required' }
      }

      if (visibility !== 'public' && visibility !== 'private') {
        return { success: false, error: 'visibility must be public or private' }
      }

      // Check for duplicates on the same day within the same workspace
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      
      const existingPages = await db.select().from(pages).where(
        and(
          eq(pages.userId, payload.sub as string),
          eq(pages.name, name),
          eq(pages.visibility, visibility as 'public' | 'private')
        )
      )
      
      const duplicate = existingPages.find(p => p.createdAt >= todayStart)
      if (duplicate) {
        return { success: false, error: 'A page with this name already exists in this workspace today' }
      }

      const newPage = await db.insert(pages).values({
        userId: payload.sub as string,
        color,
        name,
        visibility: visibility as 'private' | 'public',
      }).returning()

      if (newPage.length === 0) {
        return { success: false, error: 'Failed to create page' }
      }

      return { success: true, page: { ...newPage[0]!, created_at: newPage[0]!.createdAt.toISOString() } }
    } catch (e) {
      console.error(e)
      return { success: false, error: 'server error' }
    }
  })

  // ── PATCH /pages/:id — Update a page name ──
  .patch('/pages/:id', async ({ params, body, jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { success: false, error: 'unauthorized' }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { success: false, error: 'invalid token' }

      const { id } = params
      const { name } = body as { name: string }

      if (!name) {
        return { success: false, error: 'name is required' }
      }

      const pageToUpdate = await db.select().from(pages).where(and(eq(pages.id, id), eq(pages.userId, payload.sub as string))).limit(1)
      if (pageToUpdate.length === 0) {
        return { success: false, error: 'page not found' }
      }

      const targetDate = pageToUpdate[0]!.createdAt
      const startOfDay = new Date(targetDate)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(targetDate)
      endOfDay.setHours(23, 59, 59, 999)

      const existingPages = await db.select().from(pages).where(
        and(
          eq(pages.userId, payload.sub as string),
          eq(pages.name, name)
        )
      )

      const duplicate = existingPages.find(p => p.id !== id && p.createdAt >= startOfDay && p.createdAt <= endOfDay)
      if (duplicate) {
        return { success: false, error: 'A page with this name already exists on this day' }
      }

      const updatedPage = await db.update(pages)
        .set({ name })
        .where(and(eq(pages.id, id), eq(pages.userId, payload.sub as string)))
        .returning()

      if (updatedPage.length === 0) {
        return { success: false, error: 'page not found' }
      }

      return { success: true, page: { ...updatedPage[0]!, created_at: updatedPage[0]!.createdAt.toISOString() } }
    } catch {
      return { success: false, error: 'server error' }
    }
  })

  // ── DELETE /pages/:id — Delete a page ──
  .delete('/pages/:id', async ({ params, jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { success: false, error: 'unauthorized' }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { success: false, error: 'invalid token' }

      const { id } = params

      await db.delete(pages)
        .where(and(eq(pages.id, id), eq(pages.userId, payload.sub as string)))

      return { success: true }
    } catch {
      return { success: false, error: 'server error' }
    }
  })
  // ══════════════════════════════════════════════
  // ── Resources API ──
  // ══════════════════════════════════════════════

  // ── GET /pages/:id/resources — List resources for a page ──
  .get('/pages/:id/resources', async ({ params, jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { resources: [] }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { resources: [] }

      const { id } = params

      // Verify page ownership
      const page = await db.select().from(pages).where(and(eq(pages.id, id), eq(pages.userId, payload.sub as string))).limit(1)
      if (page.length === 0) return { resources: [] }

      const pageResources = await db.select().from(resources).where(eq(resources.pageId, id))
      return { resources: pageResources.map(r => ({ ...r, created_at: r.createdAt.toISOString() })) }
    } catch {
      return { resources: [] }
    }
  })

  // ── POST /pages/:id/resources — Create a new resource ──
  .post('/pages/:id/resources', async ({ params, body, jwt, cookie: { auth_token }, set }) => {
    const token = auth_token?.value as string | undefined
    if (!token) {
      set.status = 401
      return { success: false, error: 'Please sign in again to save resources.' }
    }

    try {
      const payload = await jwt.verify(token)
      if (!payload) {
        set.status = 401
        return { success: false, error: 'Please sign in again to save resources.' }
      }

      const { id } = params
      const requestBody = body as { type?: unknown; content?: unknown; title?: unknown; x?: unknown; y?: unknown }
      const { type, content, title, x, y } = requestBody

      if (!isResourceType(type)) {
        throw new ResourceValidationError('Resource type is not supported')
      }

      const finalType = type
      const requestContent = getRequiredString(content, 'Resource content')
      const requestTitle = getOptionalString(title)
      const resourceX = normalizeResourceCoordinate(x, randomResourceCoordinate())
      const resourceY = normalizeResourceCoordinate(y, randomResourceCoordinate())

      // Verify page ownership
      const page = await db.select().from(pages).where(and(eq(pages.id, id), eq(pages.userId, payload.sub as string))).limit(1)
      if (page.length === 0) {
        set.status = 404
        return { success: false, error: 'Canvas not found.' }
      }

      let finalContent = requestContent
      let finalTitle = requestTitle
      let finalDescription = null
      let finalThumbnailUrl = null

      if (finalType === 'image' || finalType === 'pdf' || finalType === 'file') {
        if (requestContent.startsWith('data:')) {
          finalContent = await uploadResource(requestContent, finalType)
        }
      } else if (finalType === 'link') {
        const parsedUrl = new URL(requestContent)
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          throw new ResourceValidationError('Only http and https links are supported')
        }

        const ogData = await fetchOpenGraphData(requestContent)
        if (ogData.title) finalTitle = ogData.title
        finalDescription = ogData.description
        finalThumbnailUrl = ogData.thumbnailUrl
      }

      const newResource = await db.insert(resources).values({
        pageId: id,
        type: finalType,
        content: finalContent,
        title: finalTitle,
        description: finalDescription,
        thumbnailUrl: finalThumbnailUrl,
        x: resourceX,
        y: resourceY,
      }).returning()

      if (app.server) {
        app.server.publish(`page_${id}`, JSON.stringify({ type: 'resource_updated' }))
      }

      set.status = 201
      return { success: true, resource: { ...newResource[0]!, created_at: newResource[0]!.createdAt.toISOString() } }
    } catch (e: unknown) {
      console.error('Create resource failed:', e)

      if (e instanceof ResourceValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }

      if (e instanceof TypeError) {
        set.status = 400
        return { success: false, error: 'Link URL is invalid.' }
      }

      if (e instanceof ImageValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }

      if (e instanceof CloudinaryConfigurationError) {
        set.status = 500
        return { success: false, error: 'Uploads are not configured correctly.' }
      }

      if (e instanceof ImageUploadError) {
        set.status = 502
        return { success: false, error: 'Upload failed. Please try again.' }
      }

      set.status = 500
      return { success: false, error: 'Unable to save this resource right now. Please try again.' }
    }
  })
  // ── GET /resources/:id — Fetch a single resource ──
  .get('/resources/:id', async ({ params }) => {
    try {
      const [resource] = await db.select().from(resources).where(eq(resources.id, params.id)).limit(1)
      if (!resource) return { success: false, error: 'not found' }
      return { success: true, resource }
    } catch (e) {
      console.error(e)
      return { success: false, error: 'server error' }
    }
  })

  // ── PATCH /resources/:id/position — Update resource coordinates ──
  .patch('/resources/:id/position', async ({ params, body, jwt, cookie: { auth_token }, set }) => {
    const token = auth_token?.value as string | undefined;
    if (!token) {
      set.status = 401
      return { success: false, error: 'Please sign in again to move resources.' }
    }

    try {
      const session = await jwt.verify(token);
      if (!session || !session.sub) {
        set.status = 401
        return { success: false, error: 'Please sign in again to move resources.' }
      }

      const { x, y } = body as { x?: unknown; y?: unknown };
      const resourceX = normalizeResourceCoordinate(x, 100)
      const resourceY = normalizeResourceCoordinate(y, 100)
      
      // Check if user owns the page this resource belongs to
      const [resource] = await db
        .select({ pageId: resources.pageId })
        .from(resources)
        .where(eq(resources.id, params.id));
        
      if (!resource) {
        set.status = 404
        return { success: false, error: 'Resource not found.' }
      }
      
      const [page] = await db
        .select({ userId: pages.userId })
        .from(pages)
        .where(eq(pages.id, resource.pageId));
        
      if (!page || page.userId !== session.sub) {
        set.status = 403
        return { success: false, error: 'You do not have access to this resource.' }
      }

      const [updatedResource] = await db
        .update(resources)
        .set({ x: resourceX, y: resourceY })
        .where(eq(resources.id, params.id))
        .returning();

      if (app.server) {
        app.server.publish(`page_${resource.pageId}`, JSON.stringify({ type: 'resource_updated' }))
      }

      return { success: true, resource: updatedResource };
    } catch (e: unknown) {
      console.error('Update resource position failed:', e)

      if (e instanceof ResourceValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }

      set.status = 500
      return { success: false, error: 'Unable to move this resource right now.' }
    }
  })

  // ── DELETE /resources/:id — Delete a resource ──
  .delete('/resources/:id', async ({ params, jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { success: false, error: 'unauthorized' }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { success: false, error: 'invalid token' }

      const { id } = params

      // We need to verify the user owns the page this resource belongs to.
      // Drizzle join for deletion ownership verification:
      const resourceToDelete = await db.select({ resourceId: resources.id, pageId: resources.pageId })
        .from(resources)
        .innerJoin(pages, eq(resources.pageId, pages.id))
        .where(and(eq(resources.id, id), eq(pages.userId, payload.sub as string)))
        .limit(1)

      if (resourceToDelete.length === 0) {
        return { success: false, error: 'resource not found' }
      }

      await db.delete(resources).where(eq(resources.id, id))

      if (app.server) {
        app.server.publish(`page_${resourceToDelete[0]!.pageId}`, JSON.stringify({ type: 'resource_updated' }))
      }

      return { success: true }
    } catch (e) {
      console.error(e)
      return { success: false, error: 'server error' }
    }
  })
  // ══════════════════════════════════════════════
  // ── Public Access API ──
  // ══════════════════════════════════════════════

  // ── GET /public/users/:username — Get public profile and public pages ──
  .get('/public/users/:username', async ({ params }) => {
    try {
      const { username } = params

      // Find user
      const userList = await db.select().from(users).where(eq(users.username, username)).limit(1)
      if (userList.length === 0) {
        return { success: false, error: 'User not found' }
      }
      const user = userList[0]!

      // Find public pages
      const userPages = await db.select().from(pages).where(
        and(
          eq(pages.userId, user.id),
          eq(pages.visibility, 'public')
        )
      )

      return {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          picture: user.picture,
        },
        pages: userPages,
      }
    } catch (e) {
      console.error(e)
      return { success: false, error: 'server error' }
    }
  })

  // ── GET /public/pages/:pageId/resources — Get resources for a public page ──
  .get('/public/pages/:pageId/resources', async ({ params }) => {
    try {
      const { pageId } = params

      // Verify the page exists and is public
      const pageList = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1)
      if (pageList.length === 0) {
        return { success: false, error: 'Page not found' }
      }
      const page = pageList[0]!

      if (page.visibility !== 'public') {
        return { success: false, error: 'Access denied' }
      }

      const pageResources = await db.select().from(resources).where(eq(resources.pageId, pageId))
      return { success: true, resources: pageResources }
    } catch (e) {
      console.error(e)
      return { success: false, error: 'server error' }
    }
  })


  .listen(Number(process.env.PORT) || 5000)

console.log(
  `🚀 Saveswitch API running at http://${app.server?.hostname}:${app.server?.port}`
)
