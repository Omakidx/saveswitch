ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "provider_public_id" text;
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "provider_resource_type" text;

CREATE TABLE IF NOT EXISTS "asset_deletion_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider_public_id" text NOT NULL,
  "provider_resource_type" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "asset_deletion_queue_provider_resource_type_check"
    CHECK ("provider_resource_type" IN ('image', 'raw')),
  CONSTRAINT "asset_deletion_queue_attempts_nonnegative" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "asset_deletion_queue_provider_public_id_unique"
  ON "asset_deletion_queue" ("provider_public_id");
CREATE INDEX IF NOT EXISTS "asset_deletion_queue_created_at_idx"
  ON "asset_deletion_queue" ("created_at");
