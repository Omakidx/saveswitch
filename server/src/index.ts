import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { jwt } from '@elysiajs/jwt'
import { db } from './db'
import { users, pages, resources } from './db/schema'
import { eq, and } from 'drizzle-orm'
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
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/auth/google/callback'
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

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
        await db.insert(users).values({
          id: userInfo.id,
          email: userInfo.email,
          name: userInfo.name,
          picture: userInfo.picture,
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
        await db.insert(users).values({
          id: payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
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

      const { name, picture } = body as UserProfileUpdateBody
      
      const updateData: Partial<typeof users.$inferInsert> = {}
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          set.status = 400
          return { success: false, error: 'Display name is required' }
        }

        updateData.name = name.trim()
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
  // ── Pages API ──
  // ══════════════════════════════════════════════

  // ── GET /pages — List user's pages ──
  .get('/pages', async ({ jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { pages: [] }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { pages: [] }
      
      const userPages = await db.select().from(pages).where(eq(pages.userId, payload.sub as string))
      
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

      const { color, name } = body as { color: string; name: string }

      if (!color || !name) {
        return { success: false, error: 'color and name are required' }
      }

      // Check for duplicates on the same day
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      
      const existingPages = await db.select().from(pages).where(
        and(
          eq(pages.userId, payload.sub as string),
          eq(pages.name, name)
        )
      )
      
      const duplicate = existingPages.find(p => p.createdAt >= todayStart)
      if (duplicate) {
        return { success: false, error: 'A page with this name already exists today' }
      }

      const newPage = await db.insert(pages).values({
        userId: payload.sub as string,
        color,
        name,
        visibility: 'private',
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
  .post('/pages/:id/resources', async ({ params, body, jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined
    if (!token) return { success: false, error: 'unauthorized' }

    try {
      const payload = await jwt.verify(token)
      if (!payload) return { success: false, error: 'invalid token' }

      const { id } = params
      const { type, content, title, x, y } = body as { type: string; content: string; title?: string; x?: number; y?: number }

      if (!type || !content) {
        return { success: false, error: 'type and content are required' }
      }

      // Verify page ownership
      const page = await db.select().from(pages).where(and(eq(pages.id, id), eq(pages.userId, payload.sub as string))).limit(1)
      if (page.length === 0) return { success: false, error: 'page not found' }

      let finalContent = content
      let finalTitle = title || null
      let finalDescription = null
      let finalThumbnailUrl = null

      if (type === 'image' || type === 'pdf') {
        if (content.startsWith('data:')) {
          finalContent = await uploadResource(content, type)
        }
      } else if (type === 'link') {
        const ogData = await fetchOpenGraphData(content)
        if (ogData.title) finalTitle = ogData.title
        finalDescription = ogData.description
        finalThumbnailUrl = ogData.thumbnailUrl
      }

      const newResource = await db.insert(resources).values({
        pageId: id,
        type: type as 'link' | 'image' | 'text' | 'pdf',
        content: finalContent,
        title: finalTitle,
        description: finalDescription,
        thumbnailUrl: finalThumbnailUrl,
        x: x ?? 100 + Math.floor(Math.random() * 200),
        y: y ?? 100 + Math.floor(Math.random() * 200),
      }).returning()

      return { success: true, resource: { ...newResource[0]!, created_at: newResource[0]!.createdAt.toISOString() } }
    } catch (e) {
      console.error(e)
      return { success: false, error: 'server error' }
    }
  })

  // ── PATCH /resources/:id/position — Update resource coordinates ──
  .patch('/resources/:id/position', async ({ params, body, jwt, cookie: { auth_token } }) => {
    const token = auth_token?.value as string | undefined;
    if (!token) throw new Error('Unauthorized');
    const session = await jwt.verify(token);
    if (!session || !session.sub) throw new Error('Unauthorized');

    const { x, y } = body as { x: number; y: number };
    
    // Check if user owns the page this resource belongs to
    const [resource] = await db
      .select({ pageId: resources.pageId })
      .from(resources)
      .where(eq(resources.id, params.id));
      
    if (!resource) throw new Error('Resource not found');
    
    const [page] = await db
      .select({ userId: pages.userId })
      .from(pages)
      .where(eq(pages.id, resource.pageId));
      
    if (!page || page.userId !== session.sub) throw new Error('Unauthorized');

    const [updatedResource] = await db
      .update(resources)
      .set({ x, y })
      .where(eq(resources.id, params.id))
      .returning();

    return { success: true, resource: updatedResource };
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
      const resourceToDelete = await db.select({ resourceId: resources.id })
        .from(resources)
        .innerJoin(pages, eq(resources.pageId, pages.id))
        .where(and(eq(resources.id, id), eq(pages.userId, payload.sub as string)))
        .limit(1)

      if (resourceToDelete.length === 0) {
        return { success: false, error: 'resource not found' }
      }

      await db.delete(resources).where(eq(resources.id, id))
      return { success: true }
    } catch (e) {
      console.error(e)
      return { success: false, error: 'server error' }
    }
  })


  .listen(Number(process.env.PORT) || 5000)

console.log(
  `🚀 Saveswitch API running at http://${app.server?.hostname}:${app.server?.port}`
)
