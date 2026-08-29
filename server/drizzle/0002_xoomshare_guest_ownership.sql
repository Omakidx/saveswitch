ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "allow_guest_resources" boolean DEFAULT false NOT NULL;
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "session_id" text;
