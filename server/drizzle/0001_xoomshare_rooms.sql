ALTER TABLE "pages" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "path_code" text;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "session_id" text;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS "pages_path_code_unique" ON "pages" ("path_code");
