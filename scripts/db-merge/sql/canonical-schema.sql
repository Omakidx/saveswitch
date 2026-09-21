\set ON_ERROR_STOP on

-- Run only against a new disposable database. This creates the application's
-- current PostgreSQL model; it does not create Heroku, Neon, FDW, or Cloudinary
-- objects. The merge script separately refuses a non-empty target.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  username text UNIQUE,
  name text NOT NULL,
  picture text NOT NULL,
  visibility text NOT NULL DEFAULT 'public',
  CONSTRAINT users_visibility_check CHECK (visibility IN ('public', 'private'))
);

CREATE TABLE public.pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text REFERENCES public.users(id) ON DELETE CASCADE,
  color text NOT NULL,
  name text NOT NULL,
  visibility text NOT NULL DEFAULT 'private',
  path_code text,
  session_id text,
  expires_at timestamp without time zone,
  allow_guest_resources boolean NOT NULL DEFAULT false,
  xoomshare_resource_count integer NOT NULL DEFAULT 0,
  xoomshare_resource_bytes integer NOT NULL DEFAULT 0,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT pages_visibility_check CHECK (visibility IN ('public', 'private')),
  CONSTRAINT pages_xoomshare_resource_count_nonnegative
    CHECK (xoomshare_resource_count >= 0),
  CONSTRAINT pages_xoomshare_resource_bytes_nonnegative
    CHECK (xoomshare_resource_bytes >= 0)
);

CREATE UNIQUE INDEX pages_path_code_unique
  ON public.pages (path_code) WHERE path_code IS NOT NULL;
CREATE INDEX pages_session_id_idx ON public.pages (session_id);

CREATE TABLE public.resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  type text NOT NULL,
  content text NOT NULL,
  title text,
  description text,
  thumbnail_url text,
  x integer NOT NULL DEFAULT 0,
  y integer NOT NULL DEFAULT 0,
  z_index integer NOT NULL DEFAULT 1,
  rotation integer NOT NULL DEFAULT 0,
  session_id text,
  size_bytes integer NOT NULL DEFAULT 0,
  provider_public_id text,
  provider_resource_type text,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT resources_type_check CHECK (type IN ('link', 'image', 'text', 'pdf', 'file')),
  CONSTRAINT resources_size_bytes_nonnegative CHECK (size_bytes >= 0),
  CONSTRAINT resources_provider_pair_check CHECK (
    (provider_public_id IS NULL AND provider_resource_type IS NULL)
    OR (provider_public_id IS NOT NULL AND provider_resource_type IN ('image', 'raw'))
  )
);

CREATE INDEX resources_page_id_idx ON public.resources (page_id);

-- This table intentionally begins empty. The rehearsal never imports or
-- enqueues Cloudinary deletion work from either source.
CREATE TABLE public.asset_deletion_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_public_id text NOT NULL,
  provider_resource_type text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT asset_deletion_queue_provider_resource_type_check
    CHECK (provider_resource_type IN ('image', 'raw')),
  CONSTRAINT asset_deletion_queue_attempts_nonnegative CHECK (attempts >= 0)
);

CREATE UNIQUE INDEX asset_deletion_queue_provider_public_id_unique
  ON public.asset_deletion_queue (provider_public_id);
CREATE INDEX asset_deletion_queue_created_at_idx
  ON public.asset_deletion_queue (created_at);
