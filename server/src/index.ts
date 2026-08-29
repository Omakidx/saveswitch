import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { jwt } from '@elysiajs/jwt'
import { db } from './db'
import { assetDeletionQueue, users, pages, resources } from './db/schema'
import { eq, and, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import {
  CloudinaryConfigurationError,
  ImageUploadError,
  ImageValidationError,
  ResourceUploadError,
  ResourceUploadValidationError,
  cleanupUncommittedResourceAsset,
  destroyUploadedResourceAsset,
  getAssetDeletionQueueOutcome,
  getResourceDataUrlByteLength,
  uploadImage,
  uploadResourceAsset,
  type UploadedResourceAsset,
} from './utils/cloudinary'
import { fetchOpenGraphData } from './utils/opengraph'
import { AUTH_TOKEN_MAX_AGE_SECONDS, createAuthTokenClaims } from './auth-token'
import { isUuid } from './request-validation'
import { resolveRuntimeConfig } from './runtime-config'
import {
  canCreateXoomshareResource,
  canManageXoomshareResource,
  createXoomshareCookie,
  generateXoomsharePathCode,
  normalizeXoomsharePathCode,
  resolveXoomshareParticipant,
  XoomsharePathCodeError,
  xoomshareCookieName,
} from './xoomshare-auth'
import {
  FixedWindowRateLimiter,
  getXoomshareResourceStorageBytes,
  isWithinUtf8ByteLimit,
  SocketQueryBudget,
  isXoomsharePageId,
  truncateUtf8,
  utf8ByteLength,
  XOOMSHARE_MAX_DESCRIPTION_BYTES,
  XOOMSHARE_MAX_PAGE_NAME_BYTES,
  XOOMSHARE_MAX_RESOURCE_BYTES,
  XOOMSHARE_MAX_RESOURCES,
  XOOMSHARE_MAX_TITLE_BYTES,
} from './xoomshare-security'

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

const getBoundedXoomshareOptionalString = (value: unknown, fieldName: string, maxBytes: number) => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new ResourceValidationError(`${fieldName} must be text`)
  const trimmedValue = value.trim()
  if (!trimmedValue) return null
  if (!isWithinUtf8ByteLimit(trimmedValue, maxBytes)) {
    throw new ResourceValidationError(`${fieldName} must be ${maxBytes} bytes or fewer`)
  }
  return trimmedValue
}

const getBoundedXoomsharePageName = (value: unknown) =>
  getBoundedXoomshareOptionalString(value, 'Page name', XOOMSHARE_MAX_PAGE_NAME_BYTES)

const runtimeConfig = resolveRuntimeConfig()
const GOOGLE_CLIENT_ID = runtimeConfig.googleClientId
const GOOGLE_CLIENT_SECRET = runtimeConfig.googleClientSecret
const GOOGLE_REDIRECT_URI = runtimeConfig.googleRedirectUri
const CLIENT_ORIGIN = runtimeConfig.clientOrigin
const isLocalDevelopmentOrigin = runtimeConfig.isLocalDevelopmentOrigin
const AUTH_COOKIE_SECURE = runtimeConfig.isProduction
const DEV_MODE =
  process.env.NODE_ENV === 'development' &&
  process.env.SAVESWITCH_DEV_MODE === 'true' &&
  isLocalDevelopmentOrigin
const MAX_REQUEST_BODY_BYTES = 15 * 1024 * 1024
const DEV_USER = {
  id: 'saveswitch-dev-user',
  email: 'dev@saveswitch.local',
  username: 'dev_user',
  name: 'SaveSwitch Dev',
  picture: '',
  visibility: 'public' as const,
}
const XOOMSHARE_TTL_HOURS = 3
const XOOMSHARE_TTL_MS = XOOMSHARE_TTL_HOURS * 60 * 60 * 1000
const XOOMSHARE_CLEANUP_INTERVAL_MS = 60 * 1000
const XOOMSHARE_COOKIE_SECURE = !isLocalDevelopmentOrigin
const MAX_XOOMSHARE_TEXT_LENGTH = 100_000
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

const getEffectiveXoomshareExpiresAt = (page: typeof pages.$inferSelect) => {
  if (!page.sessionId && !page.expiresAt) return null

  const ttlExpiry = new Date(page.createdAt.getTime() + XOOMSHARE_TTL_MS)
  if (!page.expiresAt) return ttlExpiry

  return page.expiresAt.getTime() <= ttlExpiry.getTime() ? page.expiresAt : ttlExpiry
}

const formatPage = (page: typeof pages.$inferSelect) => {
  const {
    sessionId: _sessionId,
    resourceCount: _resourceCount,
    resourceBytes: _resourceBytes,
    ...safePage
  } = page
  const effectiveExpiresAt = getEffectiveXoomshareExpiresAt(page)
  return {
    ...safePage,
    created_at: page.createdAt.toISOString(),
    expires_at: effectiveExpiresAt ? effectiveExpiresAt.toISOString() : null,
  }
}

const formatResource = (resource: typeof resources.$inferSelect) => {
  const {
    sessionId: _sessionId,
    sizeBytes: _sizeBytes,
    providerPublicId: _providerPublicId,
    providerResourceType: _providerResourceType,
    ...safeResource
  } = resource
  return {
    ...safeResource,
    created_at: resource.createdAt.toISOString(),
  }
}

const isExpired = (expiresAt: Date | null) => {
  return !!expiresAt && expiresAt.getTime() <= Date.now()
}

const isPageExpired = (page: typeof pages.$inferSelect) => {
  return isExpired(getEffectiveXoomshareExpiresAt(page))
}

const setXoomshareParticipantCookie = (
  set: any,
  pathCode: string,
  participantId: string,
) => {
  const serializedCookie = createXoomshareCookie({
    name: xoomshareCookieName(pathCode),
    value: participantId,
    maxAge: XOOMSHARE_TTL_HOURS * 60 * 60,
    secure: XOOMSHARE_COOKIE_SECURE,
  })
  const existing = set.headers['set-cookie']
  set.headers['set-cookie'] = existing
    ? (Array.isArray(existing) ? [...existing, serializedCookie] : [existing, serializedCookie])
    : serializedCookie
}

const resolveXoomshareRequestParticipant = ({
  request,
  set,
  room,
}: {
  request: Request
  set: any
  room: typeof pages.$inferSelect
}) => {
  const pathCode = room.pathCode
  if (!pathCode) return { participantId: null, isRoomOwner: false }

  const participant = resolveXoomshareParticipant({
    cookieHeader: request.headers.get('cookie'),
    pathCode,
    roomSessionId: room.sessionId,
  })
  if (participant.shouldPromoteLegacyOwner && participant.participantId) {
    setXoomshareParticipantCookie(set, pathCode, participant.participantId)
  }

  return participant
}

const ensureXoomshareRequestParticipant = ({
  request,
  set,
  room,
}: {
  request: Request
  set: any
  room: typeof pages.$inferSelect
}) => {
  const participant = resolveXoomshareRequestParticipant({ request, set, room })
  if (participant.participantId) return participant

  const pathCode = room.pathCode
  if (!pathCode) return participant

  const participantId = crypto.randomUUID()
  setXoomshareParticipantCookie(set, pathCode, participantId)
  return { participantId, isRoomOwner: false, shouldPromoteLegacyOwner: false }
}

const xoomshareRateLimiter = new FixedWindowRateLimiter()
const XOOMSHARE_RATE_LIMITS = {
  create: { limit: 5, windowMs: 60 * 60 * 1000 },
  failedLookup: { limit: 30, windowMs: 60 * 1000 },
  mutation: { limit: 120, windowMs: 60 * 1000 },
  websocket: { limit: 30, windowMs: 60 * 1000 },
} as const

const getXoomshareRequestAddress = (request: Request) => {
  // requestIP reads Bun's accepted socket address. Do not use X-Forwarded-For
  // or client supplied identifiers here unless a trusted proxy boundary is set.
  return app.server?.requestIP(request)?.address ?? 'unknown'
}

const enforceXoomshareRateLimit = (
  request: Request,
  set: any,
  scope: keyof typeof XOOMSHARE_RATE_LIMITS,
) => {
  const policy = XOOMSHARE_RATE_LIMITS[scope]
  const decision = xoomshareRateLimiter.consume(
    `${scope}:${getXoomshareRequestAddress(request)}`,
    policy.limit,
    policy.windowMs,
  )
  if (decision.allowed) return true

  set.status = 429
  set.headers['retry-after'] = String(decision.retryAfterSeconds)
  return false
}

const getXoomshareResourcePayloadBytes = (type: ResourceType, content: string) => (
  type === 'image' || type === 'pdf' || type === 'file'
    ? getResourceDataUrlByteLength(content)
    : utf8ByteLength(content)
)

class XoomshareMutationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Serializes room mutations across all app instances on the root page row. */
const lockXoomshareRoom = async (
  tx: any,
  pathCode: string,
  expectedRoom?: typeof pages.$inferSelect,
) => {
  const [room] = await tx.update(pages)
    .set({ resourceCount: sql`${pages.resourceCount}` })
    .where(eq(pages.pathCode, pathCode))
    .returning()
  if (room && expectedRoom && (room.id !== expectedRoom.id || room.sessionId !== expectedRoom.sessionId)) {
    throw new XoomshareMutationError(409, 'This Xoomshare room changed. Reload and try again.')
  }
  return room as typeof pages.$inferSelect | undefined
}

const publishXoomshareUpdate = (roomId: string, event: Record<string, unknown>) => {
  try {
    app.server?.publish(`page_${roomId}`, JSON.stringify(event))
  } catch (error) {
    // Do not let a post-commit websocket failure cause a caller to believe
    // that a persisted mutation failed (or trigger quota compensation).
    console.error('Publish Xoomshare update failed:', error)
  }
}

const enqueueRemoteAssetDeletions = async (tx: any, assets: Array<{
  providerPublicId: string | null
  providerResourceType: string | null
}>) => {
  for (const asset of assets) {
    if (!asset.providerPublicId || (asset.providerResourceType !== 'image' && asset.providerResourceType !== 'raw')) continue
    await tx.insert(assetDeletionQueue).values({
      providerPublicId: asset.providerPublicId,
      providerResourceType: asset.providerResourceType,
    }).onConflictDoNothing()
  }
}

const queueFailedUncommittedAssetCleanup = async (asset: UploadedResourceAsset | null) => {
  if (!asset?.publicId) return
  let cleaned = false
  try {
    cleaned = await cleanupUncommittedResourceAsset(asset)
  } catch (error) {
    console.error('Immediate Cloudinary cleanup failed:', error)
  }
  if (cleaned) return
  try {
    await db.insert(assetDeletionQueue).values({
      providerPublicId: asset.publicId,
      providerResourceType: asset.resourceType,
    }).onConflictDoNothing()
  } catch (error) {
    // Preserve the original request error; startup/periodic cleanup cannot help
    // if the database itself is unavailable, so this is explicitly observable.
    console.error('Failed to persist Cloudinary cleanup retry:', error)
  }
}

/** Cloudinary destroy is idempotent; a duplicate worker can safely retry it. */
const drainAssetDeletionQueue = async (limit = 25) => {
  const pending = await db.select().from(assetDeletionQueue).limit(limit)
  for (const item of pending) {
    const removed = await destroyUploadedResourceAsset({
      url: '',
      publicId: item.providerPublicId,
      resourceType: item.providerResourceType,
    })
    const outcome = getAssetDeletionQueueOutcome(removed)
    if (outcome.remove) {
      await db.delete(assetDeletionQueue).where(and(
        eq(assetDeletionQueue.id, item.id),
        eq(assetDeletionQueue.providerPublicId, item.providerPublicId),
      ))
    } else if (outcome.incrementAttempts) {
      await db.update(assetDeletionQueue).set({
        attempts: sql`${assetDeletionQueue.attempts} + 1`,
        lastError: 'Cloudinary destroy failed; retry scheduled',
        updatedAt: new Date(),
      }).where(eq(assetDeletionQueue.id, item.id))
    }
  }
}

const cleanupExpiredXoomshareRooms = async () => {
  try {
    const now = new Date()
    const candidates = await db.select().from(pages).where(and(
      isNotNull(pages.pathCode),
      isNotNull(pages.sessionId),
      sql`(${pages.expiresAt} < ${now} OR ${pages.createdAt} < ${new Date(Date.now() - XOOMSHARE_TTL_MS)})`,
    ))
    let deletedCount = 0
    for (const candidate of candidates) {
      deletedCount += await db.transaction(async (tx) => {
        const [lockedRoot] = await tx.update(pages).set({ resourceCount: sql`${pages.resourceCount}` })
          .where(eq(pages.id, candidate.id)).returning()
        if (!lockedRoot || !isPageExpired(lockedRoot)) return 0
        const roomPages = await tx.select({ id: pages.id }).from(pages).where(eq(pages.sessionId, lockedRoot.sessionId!))
        const pageIds = roomPages.map((page) => page.id)
        const assets = pageIds.length === 0 ? [] : await tx.select({
          providerPublicId: resources.providerPublicId,
          providerResourceType: resources.providerResourceType,
        }).from(resources).where(inArray(resources.pageId, pageIds))
        await enqueueRemoteAssetDeletions(tx, assets)
        const deletedPages = await tx.delete(pages).where(eq(pages.sessionId, lockedRoot.sessionId!)).returning({ id: pages.id })
        return deletedPages.length
      })
    }
    if (deletedCount > 0) {
      console.log(`Deleted ${deletedCount} expired Xoomshare page(s)`)
    }
    await drainAssetDeletionQueue()
  } catch (error) {
    console.error('Expired Xoomshare cleanup failed:', error)
  }
}

void cleanupExpiredXoomshareRooms()
setInterval(() => {
  void cleanupExpiredXoomshareRooms()
}, XOOMSHARE_CLEANUP_INTERVAL_MS)

const xoomshareSocketTopics = new WeakMap<object, string>()
const xoomshareSocketQueryBudget = new SocketQueryBudget()
const isAllowedXoomshareSocketOrigin = (request: Request) => {
  return request.headers.get('origin') === CLIENT_ORIGIN
}

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
      secret: runtimeConfig.jwtSecret,
    })
  )
  .onRequest(({ request, set }) => {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      set.status = 413
      return { success: false, error: 'Request body must be smaller than 15MB' }
    }
  })
  .ws('/ws', {
    beforeHandle({ request, set }) {
      if (!isAllowedXoomshareSocketOrigin(request)) {
        set.status = 403
        return { success: false, error: 'WebSocket origin is not allowed' }
      }
      if (!enforceXoomshareRateLimit(request, set, 'websocket')) {
        return { success: false, error: 'Too many WebSocket connection attempts. Please try again later.' }
      }
    },
    async message(ws, message: any) {
      let msg = message;
      if (typeof message === 'string') {
        try { msg = JSON.parse(message); } catch {}
      }
      if (typeof msg === 'object' && msg !== null && msg.type === 'subscribe') {
        if (!isXoomsharePageId(msg.pageId)) return
        if (!xoomshareSocketQueryBudget.consume(ws as object, 8, 60 * 1000)) {
          ws.close(1008, 'Subscription query limit exceeded')
          return
        }
        const [targetPage] = await db.select({ sessionId: pages.sessionId })
          .from(pages)
          .where(eq(pages.id, msg.pageId))
          .limit(1)
        if (!targetPage?.sessionId) return

        const [room] = await db.select({ expiresAt: pages.expiresAt, createdAt: pages.createdAt, sessionId: pages.sessionId })
          .from(pages)
          .where(and(eq(pages.sessionId, targetPage.sessionId), isNotNull(pages.pathCode)))
          .limit(1)
        if (!room || isPageExpired(room as typeof pages.$inferSelect)) return

        const previousTopic = xoomshareSocketTopics.get(ws as object)
        if (previousTopic && previousTopic !== `page_${msg.pageId}`) {
          ws.unsubscribe(previousTopic)
        }
        ws.subscribe(`page_${msg.pageId}`)
        xoomshareSocketTopics.set(ws as object, `page_${msg.pageId}`)
      }
    }
  })
  .get('/', () => ({
    name: 'Saveswitch API',
    version: '1.0.0',
    status: 'running',
  }))
  .get('/health', () => ({ status: 'ok', devMode: DEV_MODE, timestamp: new Date().toISOString() }))

  // Local-only development session. This route is unavailable outside an
  // explicitly enabled development server on a loopback client origin.
  .post('/auth/dev', async ({ jwt, cookie: { auth_token }, set }) => {
    if (!DEV_MODE) {
      set.status = 404
      return { success: false, error: 'Not found' }
    }

    try {
      await db.insert(users).values(DEV_USER).onConflictDoUpdate({
        target: users.id,
        set: {
          email: DEV_USER.email,
          username: DEV_USER.username,
          name: DEV_USER.name,
          picture: DEV_USER.picture,
          visibility: DEV_USER.visibility,
        },
      })

      const token = await jwt.sign(createAuthTokenClaims({ sub: DEV_USER.id, email: DEV_USER.email }))

      auth_token?.set({
        value: token,
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: AUTH_TOKEN_MAX_AGE_SECONDS,
        path: '/',
      })

      return { success: true, user: DEV_USER }
    } catch (error) {
      console.error('Development sign-in failed:', error)
      set.status = 500
      return { success: false, error: 'Unable to start the development session.' }
    }
  })

  // ── Google OAuth: Redirect to consent screen ──
  .get('/auth/google', ({ redirect, cookie: { oauth_state } }) => {

    const state = crypto.randomUUID()
    oauth_state?.set({
      value: state,
      httpOnly: true,
      secure: AUTH_COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: 10 * 60,
      path: '/auth/google',
    })

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      state,
    })
    return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  })

  // ── Google OAuth: Callback ──
  .get('/auth/google/callback', async ({ query, jwt, cookie: { auth_token, oauth_state }, redirect }) => {
    const { code } = query
    const expectedState = oauth_state?.value as string | undefined
    oauth_state?.set({
      value: '',
      httpOnly: true,
      secure: AUTH_COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: 0,
      path: '/auth/google',
    })
    if (typeof query.state !== 'string' || !expectedState || query.state !== expectedState) {
      return redirect(`${CLIENT_ORIGIN}/login?error=invalid_state`)
    }


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

      const token = await jwt.sign(createAuthTokenClaims({ sub: userInfo.id, email: userInfo.email }))

      auth_token?.set({
        value: token,
        httpOnly: true,
        secure: AUTH_COOKIE_SECURE,
        sameSite: 'lax',
        maxAge: AUTH_TOKEN_MAX_AGE_SECONDS,
        path: '/',
      })

      return redirect(`${CLIENT_ORIGIN}/dashboard`)
    } catch (err) {
      console.error('OAuth callback error:', err)
      return redirect(`${CLIENT_ORIGIN}/login?error=callback_failed`)
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
  .post('/xoomshare', async ({ body, request, set }) => {
    try {
      if (!enforceXoomshareRateLimit(request, set, 'create')) {
        return { success: false, error: 'Too many room creation attempts. Please try again later.' }
      }
      let pathCode = normalizeXoomsharePathCode({
        value: (body as XoomshareCreateBody | undefined)?.pathCode,
        reservedPathCodes: RESERVED_PATH_CODES,
      })

      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await db.select().from(pages).where(eq(pages.pathCode, pathCode)).limit(1)
        if (existing.length === 0) break
        if ((body as XoomshareCreateBody | undefined)?.pathCode) {
          set.status = 409
          return { success: false, error: 'That secret page code is already in use' }
        }
        pathCode = generateXoomsharePathCode()
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

      setXoomshareParticipantCookie(set, pathCode, sessionId)

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

      if (e instanceof ResourceValidationError || e instanceof XoomsharePathCodeError) {
        set.status = 400
        return { success: false, error: e.message }
      }

      set.status = 500
      return { success: false, error: 'Unable to create Xoomshare page' }
    }
  })

  // ── GET /xoomshare/:pathCode — Fetch an anonymous room ──
  .get('/xoomshare/:pathCode', async ({ params, request, set }) => {
    try {
      // Find the main room entry via pathCode
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        if (!enforceXoomshareRateLimit(request, set, 'failedLookup')) {
          return { success: false, error: 'Too many unsuccessful room lookups. Please try again later.' }
        }
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      const currentRoom = room[0]!
      const participant = ensureXoomshareRequestParticipant({ request, set, room: currentRoom })
      const sessionId = currentRoom.sessionId

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
          ...formatPage(currentRoom),
          isOwner: participant.isRoomOwner,
          allowGuestResources: currentRoom.allowGuestResources,
        },
        pages: allPages.map(p => formatPage(p)),
        resources: pageResources.map(r => ({
          ...formatResource(r),
          isOwner: canManageXoomshareResource({
            isRoomOwner: participant.isRoomOwner,
            participantId: participant.participantId,
            resourceParticipantId: r.sessionId,
          }),
        })),
      }
    } catch (e) {
      console.error('Fetch Xoomshare room failed:', e)
      set.status = 500
      return { success: false, error: 'Unable to load Xoomshare page' }
    }
  })

  // ── POST /xoomshare/:pathCode/pages — Add a new page to an anonymous room ──
  .post('/xoomshare/:pathCode/pages', async ({ params, body, request, set }) => {
    try {
      if (!enforceXoomshareRateLimit(request, set, 'mutation')) {
        return { success: false, error: 'Too many Xoomshare changes. Please try again later.' }
      }
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare room not found or expired' }
      }

      const participant = resolveXoomshareRequestParticipant({ request, set, room: room[0]! })
      if (!participant.isRoomOwner) {
        set.status = 403
        return { success: false, error: 'Only the creator can add pages' }
      }

      const { name } = (body || {}) as { name?: unknown }
      const requestedName = getBoundedXoomsharePageName(name)
      const vibrantColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 85%)`
      const created = await db.transaction(async (tx) => {
        const lockedRoom = await lockXoomshareRoom(tx, params.pathCode, room[0]!)
        if (!lockedRoom || isPageExpired(lockedRoom)) {
          throw new XoomshareMutationError(404, 'Xoomshare room not found or expired')
        }
        const existingPages = await tx.select().from(pages).where(eq(pages.sessionId, lockedRoom.sessionId!))
        if (existingPages.length >= 10) {
          throw new XoomshareMutationError(400, 'Maximum of 10 pages allowed per Xoomshare room')
        }
        const newPageName = requestedName || `Page ${existingPages.length + 1}`
        const [newPage] = await tx.insert(pages).values({
          userId: null,
          color: vibrantColor,
          name: newPageName,
          visibility: 'public',
          pathCode: null,
          sessionId: lockedRoom.sessionId,
          expiresAt: lockedRoom.expiresAt,
          allowGuestResources: lockedRoom.allowGuestResources,
        }).returning()
        if (!newPage) throw new Error('Xoomshare page insert failed')
        return { roomId: lockedRoom.id, page: newPage }
      })

      publishXoomshareUpdate(created.roomId, { type: 'page_added', pageId: created.page.id })

      set.status = 201
      return { success: true, page: formatPage(created.page) }
    } catch (e) {
      console.error('Create Xoomshare page failed:', e)
      if (e instanceof XoomshareMutationError) {
        set.status = e.status
        return { success: false, error: e.message }
      }
      if (e instanceof ResourceValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }
      set.status = 500
      return { success: false, error: 'Unable to create page' }
    }
  })

  // ── PATCH /xoomshare/:pathCode/pages/:id — Rename a page in an anonymous room ──
  .patch('/xoomshare/:pathCode/pages/:id', async ({ params, body, request, set }) => {
    try {
      if (!enforceXoomshareRateLimit(request, set, 'mutation')) {
        return { success: false, error: 'Too many Xoomshare changes. Please try again later.' }
      }
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare room not found or expired' }
      }

      const participant = resolveXoomshareRequestParticipant({ request, set, room: room[0]! })
      if (!participant.isRoomOwner) {
        set.status = 403
        return { success: false, error: 'Only the creator can rename pages' }
      }

      const { name } = (body || {}) as { name?: unknown }
      const nextName = getBoundedXoomsharePageName(name)
      if (!nextName) {
        set.status = 400
        return { success: false, error: 'Name is required' }
      }
      if (!isXoomsharePageId(params.id)) {
        set.status = 400
        return { success: false, error: 'Page id is invalid' }
      }

      const updated = await db.transaction(async (tx) => {
        const lockedRoom = await lockXoomshareRoom(tx, params.pathCode, room[0]!)
        if (!lockedRoom || isPageExpired(lockedRoom)) {
          throw new XoomshareMutationError(404, 'Xoomshare room not found or expired')
        }
        const [updatedPage] = await tx.update(pages)
          .set({ name: nextName })
          .where(and(eq(pages.id, params.id), eq(pages.sessionId, lockedRoom.sessionId!)))
          .returning()
        if (!updatedPage) throw new XoomshareMutationError(404, 'Page not found in this room')
        return { roomId: lockedRoom.id, page: updatedPage }
      })

      publishXoomshareUpdate(updated.roomId, { type: 'page_updated', pageId: params.id })

      return { success: true, page: formatPage(updated.page) }
    } catch (e) {
      console.error('Rename Xoomshare page failed:', e)
      if (e instanceof XoomshareMutationError) {
        set.status = e.status
        return { success: false, error: e.message }
      }
      if (e instanceof ResourceValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }
      set.status = 500
      return { success: false, error: 'Unable to rename page' }
    }
  })

  // ── DELETE /xoomshare/:pathCode/pages/:id — Delete a page in an anonymous room ──
  .delete('/xoomshare/:pathCode/pages/:id', async ({ params, request, set }) => {
    try {
      if (!enforceXoomshareRateLimit(request, set, 'mutation')) {
        return { success: false, error: 'Too many Xoomshare changes. Please try again later.' }
      }
      if (!isXoomsharePageId(params.id)) {
        set.status = 400
        return { success: false, error: 'Page id is invalid' }
      }
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare room not found or expired' }
      }

      const participant = resolveXoomshareRequestParticipant({ request, set, room: room[0]! })
      if (!participant.isRoomOwner) {
        set.status = 403
        return { success: false, error: 'Only the creator can delete pages' }
      }

      const pageDeletion = await db.transaction(async (tx) => {
        // All resource and page mutations take this same root-row lock.
        const lockedRoom = await lockXoomshareRoom(tx, params.pathCode, room[0]!)
        if (!lockedRoom || isPageExpired(lockedRoom)) {
          return { success: false as const, status: 404, error: 'Xoomshare room not found or expired' }
        }

        const existingPages = await tx.select().from(pages).where(eq(pages.sessionId, lockedRoom.sessionId!))
        if (existingPages.length <= 1) {
          return { success: false as const, status: 400, error: 'Cannot delete the only page in the room' }
        }
        const pageToDelete = existingPages.find((page) => page.id === params.id)
        if (!pageToDelete) {
          return { success: false as const, status: 404, error: 'Page not found in this room' }
        }

        const deletedPageResources = await tx.select({
          sizeBytes: resources.sizeBytes,
          providerPublicId: resources.providerPublicId,
          providerResourceType: resources.providerResourceType,
        })
          .from(resources)
          .where(eq(resources.pageId, pageToDelete.id))
        const deletedResourceCount = deletedPageResources.length
        const deletedResourceBytes = deletedPageResources.reduce((total, resource) => total + resource.sizeBytes, 0)

        await enqueueRemoteAssetDeletions(tx, deletedPageResources)
        const [deletedPage] = await tx.delete(pages)
          .where(and(eq(pages.id, pageToDelete.id), eq(pages.sessionId, lockedRoom.sessionId!)))
          .returning()
        if (!deletedPage) {
          return { success: false as const, status: 409, error: 'Page changed before it could be deleted' }
        }

        if (deletedPage.pathCode) {
          const nextRoot = existingPages.find((page) => page.id !== deletedPage.id)
          if (!nextRoot) {
            throw new Error('Xoomshare root promotion requires a remaining page')
          }
          // The old root is gone, so the unique path code can be safely moved.
          // Its latest locked counters and all room settings follow the root.
          await tx.update(pages).set({
            pathCode: deletedPage.pathCode,
            allowGuestResources: deletedPage.allowGuestResources,
            expiresAt: deletedPage.expiresAt,
            sessionId: deletedPage.sessionId,
            resourceCount: sql`GREATEST(0, ${lockedRoom.resourceCount} - ${deletedResourceCount})`,
            resourceBytes: sql`GREATEST(0, ${lockedRoom.resourceBytes} - ${deletedResourceBytes})`,
          }).where(eq(pages.id, nextRoot.id))
        } else if (deletedResourceCount > 0) {
          await tx.update(pages).set({
            resourceCount: sql`GREATEST(0, ${pages.resourceCount} - ${deletedResourceCount})`,
            resourceBytes: sql`GREATEST(0, ${pages.resourceBytes} - ${deletedResourceBytes})`,
          }).where(eq(pages.id, lockedRoom.id))
        }

        return { success: true as const }
      })
      if (!pageDeletion.success) {
        set.status = pageDeletion.status
        return { success: false, error: pageDeletion.error }
      }

      publishXoomshareUpdate(room[0]!.id, { type: 'page_deleted', pageId: params.id })
      void drainAssetDeletionQueue()

      return { success: true }
    } catch (e) {
      console.error('Delete Xoomshare page failed:', e)
      set.status = 500
      return { success: false, error: 'Unable to delete page' }
    }
  })


  // ── PATCH /xoomshare/:pathCode/settings — Toggle room settings (creator only) ──
  .patch('/xoomshare/:pathCode/settings', async ({ params, body, request, set }) => {
    try {
      if (!enforceXoomshareRateLimit(request, set, 'mutation')) {
        return { success: false, error: 'Too many Xoomshare changes. Please try again later.' }
      }
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      const participant = resolveXoomshareRequestParticipant({ request, set, room: room[0]! })
      if (!participant.isRoomOwner) {
        set.status = 403
        return { success: false, error: 'Only the creator can change settings' }
      }

      const { allowGuestResources } = body as { allowGuestResources?: boolean }
      if (typeof allowGuestResources !== 'boolean') {
        set.status = 400
        return { success: false, error: 'allowGuestResources must be a boolean' }
      }

      const updatedRoom = await db.transaction(async (tx) => {
        const lockedRoom = await lockXoomshareRoom(tx, params.pathCode, room[0]!)
        if (!lockedRoom || isPageExpired(lockedRoom)) {
          throw new XoomshareMutationError(404, 'Xoomshare page not found or expired')
        }
        await tx.update(pages).set({ allowGuestResources }).where(eq(pages.sessionId, lockedRoom.sessionId!))
        return lockedRoom
      })

      publishXoomshareUpdate(updatedRoom.id, { type: 'settings_updated' })

      return { success: true, allowGuestResources }
    } catch (e) {
      console.error('Update Xoomshare settings failed:', e)
      if (e instanceof XoomshareMutationError) {
        set.status = e.status
        return { success: false, error: e.message }
      }
      set.status = 500
      return { success: false, error: 'Unable to update settings' }
    }
  })

  // ── DELETE /xoomshare/:pathCode — Destroy an entire anonymous room (creator only) ──
  .delete('/xoomshare/:pathCode', async ({ params, request, set }) => {
    try {
      if (!enforceXoomshareRateLimit(request, set, 'mutation')) {
        return { success: false, error: 'Too many Xoomshare changes. Please try again later.' }
      }
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      const participant = resolveXoomshareRequestParticipant({ request, set, room: room[0]! })
      if (!participant.isRoomOwner) {
        set.status = 403
        return { success: false, error: 'Only the creator can destroy the session' }
      }

      const destroyedRoomId = await db.transaction(async (tx) => {
        const lockedRoom = await lockXoomshareRoom(tx, params.pathCode, room[0]!)
        if (!lockedRoom || isPageExpired(lockedRoom)) {
          throw new XoomshareMutationError(404, 'Xoomshare page not found or expired')
        }
        const roomPages = await tx.select({ id: pages.id }).from(pages).where(eq(pages.sessionId, lockedRoom.sessionId!))
        const assets = await tx.select({
          providerPublicId: resources.providerPublicId,
          providerResourceType: resources.providerResourceType,
        }).from(resources).where(inArray(resources.pageId, roomPages.map((page) => page.id)))
        await enqueueRemoteAssetDeletions(tx, assets)
        await tx.delete(pages).where(eq(pages.sessionId, lockedRoom.sessionId!))
        return lockedRoom.id
      })

      publishXoomshareUpdate(destroyedRoomId, { type: 'room_destroyed' })
      void drainAssetDeletionQueue()

      return { success: true }
    } catch (e) {
      console.error('Destroy Xoomshare session failed:', e)
      if (e instanceof XoomshareMutationError) {
        set.status = e.status
        return { success: false, error: e.message }
      }
      set.status = 500
      return { success: false, error: 'Unable to destroy session' }
    }
  })

  // ── POST /xoomshare/:pathCode/resources — Add a resource to an anonymous room ──
  .post('/xoomshare/:pathCode/resources', async ({ params, body, request, set }) => {
    let uploadedAsset: UploadedResourceAsset | null = null
    try {
      if (!enforceXoomshareRateLimit(request, set, 'mutation')) {
        return { success: false, error: 'Too many Xoomshare changes. Please try again later.' }
      }
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      let participant = resolveXoomshareRequestParticipant({ request, set, room: room[0]! })
      if (!canCreateXoomshareResource({
        isRoomOwner: participant.isRoomOwner,
        allowGuestResources: room[0]!.allowGuestResources,
      })) {
        set.status = 403
        return { success: false, error: 'Only the device that created this Xoomshare page can add resources' }
      }
      if (!participant.participantId) {
        participant = ensureXoomshareRequestParticipant({ request, set, room: room[0]! })
      }

      const requestBody = body as { type?: unknown; content?: unknown; title?: unknown; x?: unknown; y?: unknown; pageId?: unknown }
      const { type, content, title, x, y, pageId } = requestBody

      if (!isResourceType(type)) {
        throw new ResourceValidationError('Resource type is not supported')
      }

      const requestContent = getRequiredString(content, 'Resource content')
      if (type === 'text' && requestContent.length > MAX_XOOMSHARE_TEXT_LENGTH) {
        throw new ResourceValidationError(`Text resources must be ${MAX_XOOMSHARE_TEXT_LENGTH} characters or fewer`)
      }
      const requestTitle = getBoundedXoomshareOptionalString(title, 'Resource title', XOOMSHARE_MAX_TITLE_BYTES)
      const resourceX = normalizeResourceCoordinate(x, randomResourceCoordinate())
      const resourceY = normalizeResourceCoordinate(y, randomResourceCoordinate())
      if (pageId !== undefined && pageId !== null && typeof pageId !== 'string') {
        set.status = 400
        return { success: false, error: 'Page id is invalid' }
      }
      const requestedPageId = typeof pageId === 'string' && pageId.trim().length > 0 ? pageId.trim() : room[0]!.id
      if (!isXoomsharePageId(requestedPageId)) {
        set.status = 400
        return { success: false, error: 'Page id is invalid' }
      }

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
      const contentBytes = getXoomshareResourcePayloadBytes(type, requestContent)

      // This is intentionally only a cheap preflight. Remote uploads/OG
      // retrieval happen outside the transaction; the quota is authoritatively
      // checked and committed with the insert below under the root row lock.
      if (
        room[0]!.resourceCount >= XOOMSHARE_MAX_RESOURCES
        || room[0]!.resourceBytes + getXoomshareResourceStorageBytes({ contentBytes, title: requestTitle }) > XOOMSHARE_MAX_RESOURCE_BYTES
      ) {
        set.status = 409
        return { success: false, error: 'Xoomshare room storage limit reached.' }
      }

      if (type === 'image' || type === 'pdf' || type === 'file') {
        if (!requestContent.startsWith('data:')) {
          throw new ResourceValidationError('Images, PDFs, and files must be valid base64 data URLs')
        }
      }

      if (type === 'image' || type === 'pdf' || type === 'file') {
        uploadedAsset = await uploadResourceAsset(requestContent, type, { retainDataUrlLocally: DEV_MODE })
        finalContent = uploadedAsset.url
      } else if (type === 'link') {
        const parsedUrl = new URL(requestContent)
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          throw new ResourceValidationError('Only http and https links are supported')
        }

        const ogData = await fetchOpenGraphData(requestContent)
        if (ogData.title) finalTitle = truncateUtf8(ogData.title, XOOMSHARE_MAX_TITLE_BYTES)
        finalDescription = ogData.description
          ? truncateUtf8(ogData.description, XOOMSHARE_MAX_DESCRIPTION_BYTES)
          : null
        finalThumbnailUrl = ogData.thumbnailUrl
          ? truncateUtf8(ogData.thumbnailUrl, XOOMSHARE_MAX_TITLE_BYTES)
          : null
      }

      const sizeBytes = getXoomshareResourceStorageBytes({
        contentBytes,
        title: finalTitle,
        description: finalDescription,
        thumbnailUrl: finalThumbnailUrl,
      })

      const created = await db.transaction(async (tx) => {
        const lockedRoom = await lockXoomshareRoom(tx, params.pathCode, room[0]!)
        if (!lockedRoom || isPageExpired(lockedRoom)) {
          throw new XoomshareMutationError(404, 'Xoomshare page not found or expired')
        }
        if (!canCreateXoomshareResource({
          isRoomOwner: participant.isRoomOwner,
          allowGuestResources: lockedRoom.allowGuestResources,
        })) {
          throw new XoomshareMutationError(403, 'Only the device that created this Xoomshare page can add resources')
        }
        const [currentTargetPage] = await tx.select({ id: pages.id })
          .from(pages)
          .where(and(eq(pages.id, targetPage.id), eq(pages.sessionId, lockedRoom.sessionId!)))
          .limit(1)
        if (!currentTargetPage) {
          throw new XoomshareMutationError(404, 'Target page not found in this room')
        }
        const quota = await tx.update(pages)
          .set({
            resourceCount: sql`${pages.resourceCount} + 1`,
            resourceBytes: sql`${pages.resourceBytes} + ${sizeBytes}`,
          })
          .where(and(
            eq(pages.id, lockedRoom.id),
            sql`${pages.resourceCount} < ${XOOMSHARE_MAX_RESOURCES}`,
            sql`${pages.resourceBytes} + ${sizeBytes} <= ${XOOMSHARE_MAX_RESOURCE_BYTES}`,
          ))
          .returning({ id: pages.id })
        if (quota.length !== 1) {
          throw new XoomshareMutationError(409, `Xoomshare rooms are limited to ${XOOMSHARE_MAX_RESOURCES} resources and ${XOOMSHARE_MAX_RESOURCE_BYTES / (1024 * 1024)}MB of payloads.`)
        }
        const [newResource] = await tx.insert(resources).values({
          pageId: currentTargetPage.id,
          type,
          content: finalContent,
          title: finalTitle,
          description: finalDescription,
          thumbnailUrl: finalThumbnailUrl,
          x: resourceX,
          y: resourceY,
          sessionId: participant.participantId,
          sizeBytes,
          providerPublicId: uploadedAsset?.publicId ?? null,
          providerResourceType: uploadedAsset?.publicId ? uploadedAsset.resourceType : null,
        }).returning()
        if (!newResource) throw new Error('Xoomshare resource insert failed')
        return { roomId: lockedRoom.id, resource: newResource }
      })

      // The database transaction committed the URL and quota atomically.
      // Clearing this before any websocket/formatting work prevents a later
      // non-DB exception from deleting a resource that is now persisted.
      uploadedAsset = null
      publishXoomshareUpdate(created.roomId, { type: 'resource_updated' })

      set.status = 201
      return {
        success: true,
        resource: {
          ...formatResource(created.resource),
          isOwner: true,
        },
      }
    } catch (e: unknown) {
      await queueFailedUncommittedAssetCleanup(uploadedAsset)
      console.error('Create Xoomshare resource failed:', e)

      if (e instanceof XoomshareMutationError) {
        set.status = e.status
        return { success: false, error: e.message }
      }

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

      if (e instanceof ResourceUploadValidationError) {
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

      if (e instanceof ResourceUploadError) {
        set.status = 502
        return { success: false, error: 'Upload failed. Please try again.' }
      }

      set.status = 500
      return { success: false, error: 'Unable to save this resource right now. Please try again.' }
    }
  })

  // ── PATCH /xoomshare/:pathCode/resources/:id/text — Edit an owned text resource ──
  .patch('/xoomshare/:pathCode/resources/:id/text', async ({ params, body, request, set }) => {
    try {
      if (!enforceXoomshareRateLimit(request, set, 'mutation')) {
        return { success: false, error: 'Too many Xoomshare changes. Please try again later.' }
      }
      if (!isXoomsharePageId(params.id)) {
        set.status = 400
        return { success: false, error: 'Resource id is invalid' }
      }
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }
      const participant = resolveXoomshareRequestParticipant({ request, set, room: room[0]! })
      const requestBody = body as { content?: unknown; title?: unknown }
      const content = getRequiredString(requestBody.content, 'Resource content')
      if (content.length > MAX_XOOMSHARE_TEXT_LENGTH) {
        throw new ResourceValidationError(`Text resources must be ${MAX_XOOMSHARE_TEXT_LENGTH} characters or fewer`)
      }
      const nextSizeBytes = utf8ByteLength(content)
      const requestedTitle = requestBody.title === undefined
        ? undefined
        : getBoundedXoomshareOptionalString(requestBody.title, 'Resource title', XOOMSHARE_MAX_TITLE_BYTES)
      const values: { content: string; title?: string | null } = { content }
      if (requestedTitle !== undefined) values.title = requestedTitle
      const updated = await db.transaction(async (tx) => {
        const lockedRoom = await lockXoomshareRoom(tx, params.pathCode, room[0]!)
        if (!lockedRoom || isPageExpired(lockedRoom)) {
          throw new XoomshareMutationError(404, 'Xoomshare page not found or expired')
        }
        const roomPages = await tx.select({ id: pages.id }).from(pages)
          .where(eq(pages.sessionId, lockedRoom.sessionId!))
        const [existingResource] = await tx.select().from(resources)
          .where(and(eq(resources.id, params.id), inArray(resources.pageId, roomPages.map((page) => page.id))))
          .limit(1)
        if (!existingResource) throw new XoomshareMutationError(404, 'Resource not found')
        if (existingResource.type !== 'text') {
          throw new XoomshareMutationError(400, 'Only text resources can be edited')
        }
        if (!canManageXoomshareResource({
          isRoomOwner: participant.isRoomOwner,
          participantId: participant.participantId,
          resourceParticipantId: existingResource.sessionId,
        })) {
          throw new XoomshareMutationError(403, 'You can only edit your own resources')
        }
        const nextTitle = requestedTitle === undefined ? existingResource.title : requestedTitle
        const nextStoredBytes = getXoomshareResourceStorageBytes({
          contentBytes: nextSizeBytes,
          title: nextTitle,
          description: existingResource.description,
          thumbnailUrl: existingResource.thumbnailUrl,
        })
        const byteDelta = nextStoredBytes - existingResource.sizeBytes
        if (byteDelta > 0) {
          const quota = await tx.update(pages)
            .set({ resourceBytes: sql`${pages.resourceBytes} + ${byteDelta}` })
            .where(and(
              eq(pages.id, lockedRoom.id),
              sql`${pages.resourceBytes} + ${byteDelta} <= ${XOOMSHARE_MAX_RESOURCE_BYTES}`,
            ))
            .returning({ id: pages.id })
          if (quota.length !== 1) throw new XoomshareMutationError(409, 'Xoomshare room storage limit reached.')
        }
        const [updatedResource] = await tx.update(resources)
          .set({ ...values, sizeBytes: nextStoredBytes })
          .where(and(
            eq(resources.id, params.id),
            eq(resources.sizeBytes, existingResource.sizeBytes),
            eq(resources.content, existingResource.content),
          ))
          .returning()
        if (!updatedResource) {
          throw new XoomshareMutationError(409, 'This text changed before your edit could be saved. Refresh and try again.')
        }
        if (byteDelta < 0) {
          await tx.update(pages)
            .set({ resourceBytes: sql`GREATEST(0, ${pages.resourceBytes} - ${-byteDelta})` })
            .where(eq(pages.id, lockedRoom.id))
        }
        return { roomId: lockedRoom.id, resource: updatedResource }
      })

      publishXoomshareUpdate(updated.roomId, { type: 'resource_updated' })

      return {
        success: true,
        resource: {
          ...formatResource(updated.resource),
          isOwner: true,
        },
      }
    } catch (e: unknown) {
      console.error('Update Xoomshare text resource failed:', e)
      if (e instanceof XoomshareMutationError) {
        set.status = e.status
        return { success: false, error: e.message }
      }
      if (e instanceof ResourceValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }
      set.status = 500
      return { success: false, error: 'Unable to update this text resource right now.' }
    }
  })

  // ── PATCH /xoomshare/:pathCode/resources/:id/position — Move an anonymous resource ──
  .patch('/xoomshare/:pathCode/resources/:id/position', async ({ params, body, request, set }) => {
    try {
      if (!enforceXoomshareRateLimit(request, set, 'mutation')) {
        return { success: false, error: 'Too many Xoomshare changes. Please try again later.' }
      }
      if (!isXoomsharePageId(params.id)) {
        set.status = 400
        return { success: false, error: 'Resource id is invalid' }
      }
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      const participant = resolveXoomshareRequestParticipant({ request, set, room: room[0]! })

      const { x, y } = body as { x?: unknown; y?: unknown }
      const resourceX = normalizeResourceCoordinate(x, 100)
      const resourceY = normalizeResourceCoordinate(y, 100)
      const moved = await db.transaction(async (tx) => {
        const lockedRoom = await lockXoomshareRoom(tx, params.pathCode, room[0]!)
        if (!lockedRoom || isPageExpired(lockedRoom)) {
          throw new XoomshareMutationError(404, 'Xoomshare page not found or expired')
        }
        const roomPages = await tx.select({ id: pages.id }).from(pages)
          .where(eq(pages.sessionId, lockedRoom.sessionId!))
        const roomPageIds = roomPages.map((page) => page.id)
        const [existingResource] = await tx.select().from(resources)
          .where(and(eq(resources.id, params.id), inArray(resources.pageId, roomPageIds)))
          .limit(1)
        if (!existingResource) throw new XoomshareMutationError(404, 'Resource not found')
        if (!canManageXoomshareResource({
          isRoomOwner: participant.isRoomOwner,
          participantId: participant.participantId,
          resourceParticipantId: existingResource.sessionId,
        })) {
          throw new XoomshareMutationError(403, 'You can only move your own resources')
        }
        const [updatedResource] = await tx.update(resources)
          .set({ x: resourceX, y: resourceY })
          .where(eq(resources.id, params.id))
          .returning()
        if (!updatedResource) throw new XoomshareMutationError(409, 'Resource changed before it could be moved')
        return { roomId: lockedRoom.id, resource: updatedResource }
      })

      publishXoomshareUpdate(moved.roomId, { type: 'resource_updated' })

      return {
        success: true,
        resource: {
          ...formatResource(moved.resource),
          isOwner: true,
        },
      }
    } catch (e: unknown) {
      console.error('Update Xoomshare resource position failed:', e)

      if (e instanceof XoomshareMutationError) {
        set.status = e.status
        return { success: false, error: e.message }
      }

      if (e instanceof ResourceValidationError) {
        set.status = 400
        return { success: false, error: e.message }
      }

      set.status = 500
      return { success: false, error: 'Unable to move this resource right now.' }
    }
  })

  // ── DELETE /xoomshare/:pathCode/resources/:id — Delete an anonymous resource ──
  .delete('/xoomshare/:pathCode/resources/:id', async ({ params, request, set }) => {
    try {
      if (!enforceXoomshareRateLimit(request, set, 'mutation')) {
        return { success: false, error: 'Too many Xoomshare changes. Please try again later.' }
      }
      if (!isXoomsharePageId(params.id)) {
        set.status = 400
        return { success: false, error: 'Resource id is invalid' }
      }
      const room = await db.select().from(pages).where(eq(pages.pathCode, params.pathCode)).limit(1)
      if (room.length === 0 || isPageExpired(room[0]!)) {
        set.status = 404
        return { success: false, error: 'Xoomshare page not found or expired' }
      }

      const participant = resolveXoomshareRequestParticipant({ request, set, room: room[0]! })
      const deleted = await db.transaction(async (tx) => {
        const lockedRoom = await lockXoomshareRoom(tx, params.pathCode, room[0]!)
        if (!lockedRoom || isPageExpired(lockedRoom)) {
          throw new XoomshareMutationError(404, 'Xoomshare page not found or expired')
        }
        const roomPages = await tx.select({ id: pages.id }).from(pages)
          .where(eq(pages.sessionId, lockedRoom.sessionId!))
        const roomPageIds = roomPages.map((page) => page.id)
        const [existingResource] = await tx.select().from(resources)
          .where(and(eq(resources.id, params.id), inArray(resources.pageId, roomPageIds)))
          .limit(1)
        if (!existingResource) throw new XoomshareMutationError(404, 'Resource not found')
        if (!canManageXoomshareResource({
          isRoomOwner: participant.isRoomOwner,
          participantId: participant.participantId,
          resourceParticipantId: existingResource.sessionId,
        })) {
          throw new XoomshareMutationError(403, 'You can only delete your own resources')
        }
        // RETURNING gates the counter release: duplicate requests cannot both
        // consume the same resource's bytes after they serialize on the root.
        await enqueueRemoteAssetDeletions(tx, [existingResource])
        const [deletedResource] = await tx.delete(resources)
          .where(and(eq(resources.id, params.id), inArray(resources.pageId, roomPageIds)))
          .returning({ id: resources.id, sizeBytes: resources.sizeBytes })
        if (!deletedResource) throw new XoomshareMutationError(404, 'Resource not found')
        await tx.update(pages)
          .set({
            resourceCount: sql`GREATEST(0, ${pages.resourceCount} - 1)`,
            resourceBytes: sql`GREATEST(0, ${pages.resourceBytes} - ${deletedResource.sizeBytes})`,
          })
          .where(eq(pages.id, lockedRoom.id))
        return { roomId: lockedRoom.id }
      })

      publishXoomshareUpdate(deleted.roomId, { type: 'resource_updated' })
      void drainAssetDeletionQueue()

      return { success: true }
    } catch (e) {
      console.error('Delete Xoomshare resource failed:', e)
      if (e instanceof XoomshareMutationError) {
        set.status = e.status
        return { success: false, error: e.message }
      }
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
      
      return { pages: userPages.map(formatPage) }
    } catch {
      return { pages: [] }
    }
  })

  // ── POST /pages — Create a new page ──
  .post('/pages', async ({ body, jwt, cookie: { auth_token }, set }) => {
    const token = auth_token?.value as string | undefined
    if (!token) {
      set.status = 401
      return { success: false, error: 'Please sign in again to create pages.' }
    }

    try {
      const payload = await jwt.verify(token)
      if (!payload) {
        set.status = 401
        return { success: false, error: 'Please sign in again to create pages.' }
      }

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

      return { success: true, page: formatPage(newPage[0]!) }
    } catch (e) {
      console.error(e)
      return { success: false, error: 'server error' }
    }
  })

  // ── PATCH /pages/:id — Update a page name ──
  .patch('/pages/:id', async ({ params, body, jwt, cookie: { auth_token }, set }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { success: false, error: 'unauthorized' }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { success: false, error: 'invalid token' }

      const { id } = params
      const { name } = body as { name: string }
      if (!isUuid(id)) {
        set.status = 400
        return { success: false, error: 'Page id is invalid.' }
      }


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

      return { success: true, page: formatPage(updatedPage[0]!) }
    } catch {
      return { success: false, error: 'server error' }
    }
  })

  // ── DELETE /pages/:id — Delete a page ──
  .delete('/pages/:id', async ({ params, jwt, cookie: { auth_token }, set }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { success: false, error: 'unauthorized' }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { success: false, error: 'invalid token' }

      const { id } = params

      if (!isUuid(id)) {
        set.status = 400
        return { success: false, error: 'Page id is invalid.' }
      }

      const deleted = await db.transaction(async (tx) => {
        const [page] = await tx.select({ id: pages.id }).from(pages)
          .where(and(eq(pages.id, id), eq(pages.userId, payload.sub as string))).limit(1)
        if (!page) return false
        const assets = await tx.select({
          providerPublicId: resources.providerPublicId,
          providerResourceType: resources.providerResourceType,
        }).from(resources).where(eq(resources.pageId, page.id))
        await enqueueRemoteAssetDeletions(tx, assets)
        await tx.delete(pages).where(eq(pages.id, page.id))
        return true
      })
      if (deleted) void drainAssetDeletionQueue()

      return { success: true }
    } catch {
      return { success: false, error: 'server error' }
    }
  })
  // ══════════════════════════════════════════════
  // ── Resources API ──
  // ══════════════════════════════════════════════

  // ── GET /pages/:id/resources — List resources for a page ──
  .get('/pages/:id/resources', async ({ params, jwt, cookie: { auth_token }, set }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { resources: [] }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { resources: [] }

      const { id } = params

      // Verify page ownership
      if (!isUuid(id)) {
        set.status = 400
        return { resources: [] }
      }

      const page = await db.select().from(pages).where(and(eq(pages.id, id), eq(pages.userId, payload.sub as string))).limit(1)
      if (page.length === 0) return { resources: [] }

      const pageResources = await db.select().from(resources).where(eq(resources.pageId, id))
      return { resources: pageResources.map(formatResource) }
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

    let uploadedAsset: UploadedResourceAsset | null = null
    try {
      const payload = await jwt.verify(token)
      if (!payload) {
        set.status = 401
        return { success: false, error: 'Please sign in again to save resources.' }
      }

      const { id } = params
      const requestBody = body as { type?: unknown; content?: unknown; title?: unknown; x?: unknown; y?: unknown }
      const { type, content, title, x, y } = requestBody
      if (!isUuid(id)) {
        set.status = 400
        return { success: false, error: 'Page id is invalid.' }
      }


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
        if (!requestContent.startsWith('data:')) {
          throw new ResourceValidationError('Images, PDFs, and files must be valid base64 data URLs')
        }
        uploadedAsset = await uploadResourceAsset(requestContent, finalType, { retainDataUrlLocally: DEV_MODE })
        finalContent = uploadedAsset.url
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
        providerPublicId: uploadedAsset?.publicId ?? null,
        providerResourceType: uploadedAsset?.publicId ? uploadedAsset.resourceType : null,
      }).returning()

      // Persisted metadata owns the remote asset from this point onward.
      uploadedAsset = null

      if (app.server) {
        app.server.publish(`page_${id}`, JSON.stringify({ type: 'resource_updated' }))
      }

      set.status = 201
      return { success: true, resource: formatResource(newResource[0]!) }
    } catch (e: unknown) {
      await queueFailedUncommittedAssetCleanup(uploadedAsset)
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

      if (e instanceof ResourceUploadValidationError) {
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

      if (e instanceof ResourceUploadError) {
        set.status = 502
        return { success: false, error: 'Upload failed. Please try again.' }
      }

      set.status = 500
      return { success: false, error: 'Unable to save this resource right now. Please try again.' }
    }
  })
  // ── GET /resources/:id — Fetch a single resource ──
  .get('/resources/:id', async ({ params, set }) => {
    try {
      if (!isUuid(params.id)) {
        set.status = 400
        return { success: false, error: 'Resource id is invalid.' }
      }
      const [resource] = await db.select().from(resources).where(eq(resources.id, params.id)).limit(1)
      if (!resource) return { success: false, error: 'not found' }
      return { success: true, resource: formatResource(resource) }

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
      
      if (!isUuid(params.id)) {
        set.status = 400
        return { success: false, error: 'Resource id is invalid.' }
      }

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

      return { success: true, resource: formatResource(updatedResource!) };
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

  // ── PATCH /resources/:id/content — Edit a saved text resource ──
  .patch('/resources/:id/content', async ({ params, body, jwt, cookie: { auth_token }, set }) => {
    const token = auth_token?.value as string | undefined
    if (!token) {
      set.status = 401
      return { success: false, error: 'Please sign in again to edit resources.' }
    }

    try {
      const session = await jwt.verify(token)
      if (!session || !session.sub) {
        set.status = 401
        return { success: false, error: 'Please sign in again to edit resources.' }
      }

      if (!isUuid(params.id)) {
        set.status = 400
        return { success: false, error: 'Resource id is invalid.' }
      }

      const { content } = body as { content?: unknown }
      if (typeof content !== 'string' || content.trim().length === 0) {
        set.status = 400
        return { success: false, error: 'Text content is required.' }
      }

      const [resource] = await db
        .select({ pageId: resources.pageId, type: resources.type })
        .from(resources)
        .where(eq(resources.id, params.id))
        .limit(1)

      if (!resource) {
        set.status = 404
        return { success: false, error: 'Resource not found.' }
      }

      if (resource.type !== 'text') {
        set.status = 400
        return { success: false, error: 'Only text resources can be edited.' }
      }

      const [page] = await db
        .select({ userId: pages.userId })
        .from(pages)
        .where(eq(pages.id, resource.pageId))
        .limit(1)

      if (!page || page.userId !== session.sub) {
        set.status = 403
        return { success: false, error: 'You do not have access to this resource.' }
      }

      const [updatedResource] = await db
        .update(resources)
        .set({ content })
        .where(eq(resources.id, params.id))
        .returning()

      if (app.server) {
        app.server.publish(`page_${resource.pageId}`, JSON.stringify({ type: 'resource_updated' }))
      }

      return {
        success: true,
        resource: formatResource(updatedResource!),
      }
    } catch (e: unknown) {
      console.error('Update resource content failed:', e)
      set.status = 500
      return { success: false, error: 'Unable to update this text right now.' }
    }
  })

  // ── DELETE /resources/:id — Delete a resource ──
  .delete('/resources/:id', async ({ params, jwt, cookie: { auth_token }, set }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { success: false, error: 'unauthorized' }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { success: false, error: 'invalid token' }

      const { id } = params

      if (!isUuid(id)) {
        set.status = 400
        return { success: false, error: 'Resource id is invalid.' }
      }

      // We need to verify the user owns the page this resource belongs to.
      // Drizzle join for deletion ownership verification:
      const resourceToDelete = await db.select({
        resourceId: resources.id,
        pageId: resources.pageId,
        providerPublicId: resources.providerPublicId,
        providerResourceType: resources.providerResourceType,
      })
        .from(resources)
        .innerJoin(pages, eq(resources.pageId, pages.id))
        .where(and(eq(resources.id, id), eq(pages.userId, payload.sub as string)))
        .limit(1)

      if (resourceToDelete.length === 0) {
        return { success: false, error: 'resource not found' }
      }

      await db.transaction(async (tx) => {
        await enqueueRemoteAssetDeletions(tx, [resourceToDelete[0]!])
        await tx.delete(resources).where(eq(resources.id, id))
      })

      if (app.server) {
        app.server.publish(`page_${resourceToDelete[0]!.pageId}`, JSON.stringify({ type: 'resource_updated' }))
      }
      void drainAssetDeletionQueue()

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
        pages: userPages.map(formatPage),
      }
    } catch (e) {
      console.error(e)
      return { success: false, error: 'server error' }
    }
  })

  // ── GET /public/pages/:pageId/resources — Get resources for a public page ──
  .get('/public/pages/:pageId/resources', async ({ params, set }) => {
    try {
      const { pageId } = params
      if (!isUuid(pageId)) {
        set.status = 400
        return { success: false, error: 'Page id is invalid.' }
      }


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
      return { success: true, resources: pageResources.map(formatResource) }
    } catch (e) {
      console.error(e)
      return { success: false, error: 'server error' }
    }
  })


const serverPort = Number(process.env.PORT) || 5000
const serverOptions = { port: serverPort, maxRequestBodySize: MAX_REQUEST_BODY_BYTES }
if (DEV_MODE) {
  app.listen({ ...serverOptions, hostname: '127.0.0.1' })
} else {
  app.listen(serverOptions)
}

console.log(
  `🚀 Saveswitch API running at http://${app.server?.hostname}:${app.server?.port}`
)
