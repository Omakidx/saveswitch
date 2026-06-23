# Saveswitch — Architecture Document

## 1. Overview

Saveswitch is a real-time web application that enables seamless cross-device sharing of copied resources (text, links, and images). It supports two modes of operation:

- **Xoomshare (Anonymous)** — Frictionless sharing via a unique path code, no login required.
- **Authenticated Mode** — Persistent dashboard with private/public spaces, user profiles, and social features (comments & notifications).

The application follows a **decoupled client–server architecture** where the frontend (`client/`) and backend (`server/`) are independently developed, deployed, and scaled.

---

## 2. Tech Stack

### 2.1 Runtime & Package Manager

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Runtime | **Bun** | Up to 4× faster startup than Node.js, native TypeScript execution (no transpilation step), built-in test runner, and a blazing-fast package manager — reducing CI/CD time and developer friction. |
| Package Manager | **Bun** (built-in) | Replaces npm/yarn/pnpm with a single binary; lockfile-compatible and dramatically faster installs. |

> Both `client/` and `server/` use Bun as their runtime and package manager.

### 2.2 Frontend (`client/`)

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Framework | **React** (with Vite) | Vite provides instant HMR via native ESM and optimised production builds with Rollup. React gives the component model, hooks ecosystem, and vast community support. |
| Routing | **React Router v7** | Client-side routing with nested layouts, loaders, and actions. |
| Styling | **Tailwind CSS v4** | Utility-first CSS framework for rapid, consistent UI development. Combined with custom design tokens for premium aesthetics (glassmorphism, gradients, micro-animations). |
| State Management | **React Context + Hooks** | Lightweight; avoids external state libraries. Real-time state is managed via the WebSocket client. |
| Real-Time Client | **Socket.IO Client** | Connects to the server's WebSocket layer for live clipboard sync and comment streaming. |
| HTTP Client | **Axios** or **fetch** | For RESTful API calls to the backend. |
| Auth Client | **Google OAuth** (redirect flow) | The client initiates the OAuth flow; the server handles token exchange and session management. |
| Media Uploads | **Direct-to-Cloudinary** (signed uploads) | The client requests a signed upload URL from the server, then uploads directly to Cloudinary — keeping the server lightweight. |

### 2.3 Backend (`server/`)

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Framework | **Elysia** (on Bun) | End-to-end type-safe HTTP framework built natively for Bun. Offers excellent DX with schema validation, lifecycle hooks, and plugin support out of the box. |
| Database | **Neon Postgres** | Serverless, auto-scaling Postgres with branching support for dev/staging environments. |
| ORM | **Drizzle ORM** | Lightweight, type-safe SQL query builder with zero runtime overhead. Schema-first migrations. |
| Authentication | **Custom JWT + Google OAuth** | Server exchanges Google auth codes for user identity, issues JWTs for session management, and stores refresh tokens securely. |
| Real-Time | **Socket.IO** (on Bun) | WebSocket server scoped by room/path code for real-time clipboard sync and live comments. |
| Media Storage | **Cloudinary** | Image upload, optimisation (WebP/AVIF), and CDN delivery. The server issues signed upload credentials. |
| Validation | **Typebox / Elysia schemas** | Request/response validation at the edge, ensuring data integrity before it reaches the database. |
| Scheduling | **Bun Cron / pg_cron** | Handles TTL expiration of anonymous Xoomshare rooms and stale data cleanup. |

---

## 3. Project Structure

```
saveswitch/
├── architecture.md          # This document
├── rough-note.md            # Product requirements & feature notes
│
├── client/                  # Frontend application (React + Vite)
│   ├── public/              # Static assets (favicon, manifest, etc.)
│   ├── src/
│   │   ├── assets/          # Images, fonts, icons
│   │   ├── components/      # Reusable UI components
│   │   │   ├── ui/          # Base primitives (Button, Input, Modal, Switch)
│   │   │   ├── layout/      # Header, Sidebar, Footer, PageShell
│   │   │   └── features/    # Feature-specific (ClipboardCard, CommentThread, PrivacyToggle)
│   │   ├── pages/           # Route-level page components
│   │   │   ├── Home.tsx
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── XoomShare.tsx        # Anonymous share creation
│   │   │   ├── XoomShareRoom.tsx    # Path-code room view
│   │   │   └── PublicProfile.tsx    # /@username view
│   │   ├── hooks/            # Custom React hooks (useAuth, useSocket, useClipboard)
│   │   ├── context/          # React Context providers (AuthContext, ThemeContext)
│   │   ├── services/         # API service layer (api.ts, socket.ts, cloudinary.ts)
│   │   ├── utils/            # Helper functions, constants, type definitions
│   │   ├── styles/           # Tailwind config extensions, global CSS
│   │   ├── App.tsx           # Root component with router
│   │   └── main.tsx          # Vite entry point
│   ├── index.html
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json          # (managed by bun)
│
├── server/                   # Backend application (Elysia on Bun)
│   ├── src/
│   │   ├── index.ts          # Server entry point (Elysia app bootstrap)
│   │   ├── routes/           # Route modules
│   │   │   ├── auth.ts       # Google OAuth callback, JWT issuance, session refresh
│   │   │   ├── resources.ts  # CRUD for text/link/image resources
│   │   │   ├── xoomshare.ts  # Create/fetch anonymous rooms by path code
│   │   │   ├── comments.ts   # Comment CRUD & real-time broadcast
│   │   │   ├── users.ts      # Profile, public/private toggle, notifications
│   │   │   └── upload.ts     # Cloudinary signed upload URL generation
│   │   ├── middleware/        # Auth guards, rate limiting, CORS
│   │   ├── db/
│   │   │   ├── schema.ts     # Drizzle ORM table definitions
│   │   │   ├── migrate.ts    # Migration runner
│   │   │   └── index.ts      # Database connection (Neon pool)
│   │   ├── ws/               # WebSocket handlers
│   │   │   ├── rooms.ts      # Xoomshare room sync logic
│   │   │   └── comments.ts   # Live comment streaming
│   │   ├── services/         # Business logic layer
│   │   │   ├── auth.service.ts
│   │   │   ├── resource.service.ts
│   │   │   ├── xoomshare.service.ts
│   │   │   └── cloudinary.service.ts
│   │   ├── utils/            # Helpers, JWT signing, validators
│   │   └── types/            # Shared TypeScript types/interfaces
│   ├── drizzle.config.ts     # Drizzle Kit config for migrations
│   ├── tsconfig.json
│   └── package.json          # (managed by bun)
│
└── .env                      # Shared environment variables (gitignored)
```

---

## 4. Database Schema (Drizzle ORM + Neon Postgres)

### 4.1 Tables

```
┌──────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│     users         │     │     resources          │     │    comments       │
├──────────────────┤     ├──────────────────────┤     ├──────────────────┤
│ id (UUID, PK)     │◄───┤ user_id (FK, nullable) │     │ id (UUID, PK)     │
│ google_id         │     │ id (UUID, PK)          │◄───┤ resource_id (FK)  │
│ email             │     │ type (enum: text,      │     │ user_id (FK)      │
│ display_name      │     │   link, image)         │     │ body (TEXT)        │
│ avatar_url        │     │ content (TEXT)          │     │ created_at         │
│ username (unique) │     │ cloudinary_url         │     └──────────────────┘
│ created_at        │     │ path_code (unique,     │
│ updated_at        │     │   nullable)            │     ┌──────────────────┐
└──────────────────┘     │ visibility (enum:      │     │  notifications     │
                          │   private, public)     │     ├──────────────────┤
                          │ is_xoomshare (BOOL)    │     │ id (UUID, PK)     │
                          │ expires_at (TIMESTAMP, │     │ user_id (FK)      │
                          │   nullable)            │     │ type (enum)        │
                          │ session_id (TEXT,      │     │ payload (JSONB)    │
                          │   nullable)            │     │ read (BOOL)        │
                          │ created_at             │     │ created_at         │
                          │ updated_at             │     └──────────────────┘
                          └──────────────────────┘
```

### 4.2 Key Indexes

| Index | Table | Column(s) | Purpose |
|-------|-------|-----------|---------|
| `idx_resources_path_code` | resources | `path_code` | O(1) lookup for Xoomshare rooms |
| `idx_resources_user_id` | resources | `user_id` | Fast dashboard queries |
| `idx_resources_visibility` | resources | `visibility, user_id` | Public profile page queries |
| `idx_comments_resource_id` | comments | `resource_id` | Fetch comments for a resource |
| `idx_users_username` | users | `username` | Public profile path resolution (`/@username`) |
| `idx_notifications_user_id` | notifications | `user_id, read` | Unread notification count |

---

## 5. Core Workflows

### 5.1 Xoomshare Flow (Anonymous — No Login Required)

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Sender  │────▶│  Client  │────▶│  Server  │────▶│ Neon DB  │
│  Device  │     │  (React) │     │ (Elysia) │     │          │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                       │                │
                       │   WebSocket    │
                       ◄────────────────►
                       │                │
┌──────────┐     ┌──────────┐          │
│ Receiver │◄───▶│  Client  │◄─────────┘
│  Device  │     │  (React) │
└──────────┘     └──────────┘
```

1. **Initiation** — User copies text/link/image and opens Saveswitch.
2. **Entry Point** — User clicks "Xoomshare" on the login/register page (no authentication needed).
3. **Room Creation** — User creates or enters a unique path code (e.g., `saveswitch.xyz/my-secret-room`). A `session_id` cookie is stored locally to recognise the sender as the "owner".
4. **Persistence** — Text/links are saved directly to Postgres. Images are uploaded to Cloudinary (via signed URL), and the resulting CDN URL is stored in Postgres.
5. **Real-Time Sync** — A Socket.IO WebSocket connection is established scoped to the room's `path_code`. Any new item pasted in the room appears instantly on all connected devices.
6. **Retrieval** — The receiver opens the same path code URL, connects to the WebSocket room, and sees all shared content in real-time.
7. **Expiration** — Anonymous rooms have a configurable **TTL (Time-To-Live)** (e.g., 24h). A scheduled Bun cron job prunes expired rooms and their resources.

### 5.2 Authenticated Flow (Google OAuth)

1. **Sign-In** — User clicks "Sign in with Google". The client redirects to Google's OAuth consent screen.
2. **Token Exchange** — Google redirects back to the server's `/auth/google/callback`. The server verifies the auth code, creates/updates the user record, and issues a **JWT** (stored as an httpOnly cookie).
3. **Dashboard** — The authenticated user sees their personal dashboard with saved resources, sorted by date (Today, Yesterday, etc.) and categorised by type (text, link, image).
4. **Privacy Toggle (Private ↔ Public Space)** — A persistent switch at the top of the dashboard controls the user's space mode:
   - **Private** — Resources are visible only to the owner.
   - **Public** — Resources are visible to anyone visiting `saveswitch.xyz/@username`.
5. **Public Profile** — Other users can visit `/@username` to browse public resources.
6. **Social Layer (Comments)** — Logged-in users can comment on public resources. Comments are broadcast in real-time via Socket.IO. The resource owner receives a notification.

### 5.3 Comment & Notification Flow

1. Authenticated user navigates to a public resource on `/@username`.
2. User submits a comment via the comment space (bottom-right of the resource view).
3. Server persists the comment and broadcasts it to all clients viewing that resource via Socket.IO.
4. A notification record is created for the resource owner.
5. The owner sees the notification badge update in real-time on their dashboard.

---

## 6. API Design (RESTful + WebSocket)

### 6.1 REST Endpoints (`server/src/routes/`)

#### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/auth/google` | — | Redirect to Google OAuth consent |
| `GET` | `/auth/google/callback` | — | Handle OAuth callback, issue JWT |
| `POST` | `/auth/logout` | JWT | Invalidate session |
| `GET` | `/auth/me` | JWT | Get current user profile |

#### Resources

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/resources` | JWT | List authenticated user's resources (with filters & pagination) |
| `POST` | `/resources` | JWT | Create a new resource (text/link/image) |
| `PATCH` | `/resources/:id` | JWT | Update resource content or visibility |
| `DELETE` | `/resources/:id` | JWT | Delete a resource |

#### Xoomshare

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/xoomshare` | — | Create an anonymous room with a unique path code |
| `GET` | `/xoomshare/:pathCode` | — | Fetch all resources in a room |
| `POST` | `/xoomshare/:pathCode/resources` | — | Add a resource to an anonymous room (session_id cookie validated) |

#### Users & Profiles

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/users/:username` | — | Fetch public profile and public resources |
| `PATCH` | `/users/me/visibility` | JWT | Toggle private/public space |

#### Comments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/resources/:id/comments` | — | List comments on a public resource |
| `POST` | `/resources/:id/comments` | JWT | Post a comment |
| `DELETE` | `/comments/:id` | JWT | Delete own comment |

#### Uploads

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/upload/sign` | JWT / session | Generate a signed Cloudinary upload URL |

#### Notifications

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/notifications` | JWT | List user's notifications |
| `PATCH` | `/notifications/:id/read` | JWT | Mark notification as read |

### 6.2 WebSocket Events (Socket.IO)

#### Rooms (Xoomshare & Dashboard)

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `room:join` | Client → Server | `{ pathCode }` | Join a Xoomshare or profile room |
| `room:leave` | Client → Server | `{ pathCode }` | Leave a room |
| `resource:new` | Server → Client | `{ resource }` | New resource added to the room |
| `resource:deleted` | Server → Client | `{ resourceId }` | Resource removed from the room |

#### Comments

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `comment:new` | Server → Client | `{ comment }` | New comment posted |
| `comment:deleted` | Server → Client | `{ commentId }` | Comment removed |

#### Notifications

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `notification:new` | Server → Client | `{ notification }` | New notification for the user |

---

## 7. Authentication & Security

### 7.1 Authentication Strategy

- **Google OAuth 2.0** — Used for registered user sign-in. The server handles the full code-exchange flow.
- **JWT (JSON Web Tokens)** — Issued on successful OAuth. Stored as `httpOnly`, `Secure`, `SameSite=Strict` cookies to prevent XSS and CSRF.
- **Session ID Cookie (Xoomshare)** — Anonymous users receive a random `session_id` cookie to identify them as the room owner. This cookie is scoped to the specific path code.

### 7.2 Security Measures

| Concern | Approach |
|---------|----------|
| **CORS** | Strict origin whitelist — only the client domain is allowed. |
| **Rate Limiting** | Per-IP rate limiting on all public endpoints (especially Xoomshare creation and uploads). |
| **Input Validation** | All request bodies validated via Elysia's built-in Typebox schemas before reaching handlers. |
| **SQL Injection** | Prevented by Drizzle ORM's parameterized queries — no raw SQL. |
| **XSS** | React's default escaping + httpOnly cookies. User-generated content is sanitised before rendering. |
| **File Uploads** | Signed Cloudinary uploads with file-type and size restrictions enforced server-side. |
| **Content Expiration** | Anonymous rooms auto-expire after a configurable TTL (default: 24 hours). |

---

## 8. Real-Time Architecture (Socket.IO)

```
┌──────────────────────────────────────────┐
│              Elysia Server               │
│                                          │
│  ┌────────────┐    ┌──────────────────┐  │
│  │ REST Routes │    │  Socket.IO Server │  │
│  │ (HTTP)      │    │  (WebSocket)      │  │
│  └──────┬─────┘    └────────┬─────────┘  │
│         │                    │            │
│         ▼                    ▼            │
│  ┌─────────────────────────────────────┐  │
│  │         Service Layer               │  │
│  │  (Business Logic + DB Access)       │  │
│  └──────────────┬──────────────────────┘  │
│                  │                        │
│                  ▼                        │
│  ┌─────────────────────────────────────┐  │
│  │    Drizzle ORM → Neon Postgres      │  │
│  └─────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

- **Room Scoping** — Each Xoomshare path code and each `@username` profile maps to a unique Socket.IO room. Clients only receive events for rooms they've joined.
- **Broadcast on Mutation** — When a resource or comment is created/deleted via REST, the service layer also emits the corresponding Socket.IO event to the relevant room.
- **Connection Auth** — Authenticated Socket.IO connections pass the JWT via the `auth` handshake. Anonymous connections pass the `session_id`.

---

## 9. Media Handling (Cloudinary)

### Upload Flow

1. **Client** requests a signed upload URL from `POST /upload/sign` (passing file type and intended resource context).
2. **Server** validates the request, generates Cloudinary signed params (with transformation presets, folder, and size limits), and returns them.
3. **Client** uploads the file directly to Cloudinary using the signed params.
4. **Cloudinary** returns the asset URL and metadata.
5. **Client** sends the Cloudinary URL to the server to persist alongside the resource record.

### Optimisations

- **Auto-format** — Cloudinary delivers images in WebP/AVIF based on browser support.
- **Responsive sizing** — URL transformations generate multiple sizes for different viewports.
- **Lazy loading** — Client-side images use native `loading="lazy"` and Intersection Observer.

---

## 10. Deployment Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│   Client (Vite)     │     │   Server (Elysia)    │
│   Deployed on:      │     │   Deployed on:        │
│   Vercel / Netlify  │────▶│   Fly.io / Railway    │
│   (Static + CDN)    │     │   (Bun runtime)       │
└─────────────────────┘     └──────────┬────────────┘
                                        │
                            ┌───────────▼───────────┐
                            │    Neon Postgres       │
                            │    (Serverless DB)     │
                            └───────────────────────┘
                                        │
                            ┌───────────▼───────────┐
                            │      Cloudinary        │
                            │    (Media CDN)         │
                            └───────────────────────┘
```

| Component | Platform | Rationale |
|-----------|----------|-----------|
| **Client** | Vercel or Netlify | Optimised for static/SPA hosting with edge CDN, preview deploys, and instant rollbacks. |
| **Server** | Fly.io or Railway | First-class Bun support, global edge deployment, persistent WebSocket connections, and easy scaling. |
| **Database** | Neon | Serverless Postgres with auto-suspend, branching, and scale-to-zero for cost efficiency. |
| **Media** | Cloudinary | Global CDN, on-the-fly transformations, and generous free tier. |

### Environment Variables

```env
# Client (.env)
VITE_API_URL=https://api.saveswitch.xyz
VITE_WS_URL=wss://api.saveswitch.xyz
VITE_GOOGLE_CLIENT_ID=<google-client-id>
VITE_CLOUDINARY_CLOUD_NAME=<cloud-name>

# Server (.env)
DATABASE_URL=postgres://<user>:<pass>@<neon-host>/<db>?sslmode=require
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
JWT_SECRET=<random-256-bit-secret>
CLOUDINARY_CLOUD_NAME=<cloud-name>
CLOUDINARY_API_KEY=<api-key>
CLOUDINARY_API_SECRET=<api-secret>
CLIENT_ORIGIN=https://saveswitch.xyz
PORT=3000
```

---

## 11. Development Workflow

### Getting Started

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Clone & install dependencies
git clone <repo-url> && cd saveswitch
cd client && bun install
cd ../server && bun install

# Start development servers
# Terminal 1 — Client (Vite dev server with HMR)
cd client && bun run dev

# Terminal 2 — Server (Elysia with Bun's --watch)
cd server && bun run dev
```

### Scripts (package.json)

**Client:**
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint src/",
    "format": "prettier --write src/"
  }
}
```

**Server:**
```json
{
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "bun src/db/migrate.ts",
    "db:studio": "drizzle-kit studio",
    "lint": "eslint src/",
    "test": "bun test"
  }
}
```

---

## 12. Performance Considerations

| Area | Strategy |
|------|----------|
| **Bun Runtime** | Native TypeScript execution, faster HTTP handling, and lower memory footprint compared to Node.js. |
| **Tailwind CSS** | Utility classes are purged at build time — only used styles ship to production, resulting in tiny CSS bundles. |
| **Vite Builds** | Tree-shaking, code-splitting, and lazy-loaded routes keep JS bundle sizes minimal. |
| **Database** | Indexed queries on `path_code`, `user_id`, and `username` ensure sub-millisecond lookups. Connection pooling via Neon's serverless driver. |
| **CDN Delivery** | Static client assets served from Vercel/Netlify edge. Images served from Cloudinary's global CDN. |
| **WebSocket Efficiency** | Socket.IO rooms are scoped per path code / username — no unnecessary broadcasts. |
| **Caching** | HTTP cache headers on public profile pages and Cloudinary assets. Stale-while-revalidate patterns where appropriate. |

---

## 13. Future Considerations

- **PDF Support** — Extend the `resource.type` enum and Cloudinary upload config to handle PDF documents.
- **Clipboard API Integration** — Use the browser's Clipboard API to auto-detect and paste content directly.
- **Mobile PWA** — Add a service worker and Web App Manifest for installable, offline-capable mobile experience.
- **E2E Encryption** — Optional end-to-end encryption for private Xoomshare rooms.
- **Analytics Dashboard** — Track resource views, shares, and comment engagement for public profiles.
- **Webhook Integrations** — Allow users to forward saved resources to Notion, Slack, or other tools.