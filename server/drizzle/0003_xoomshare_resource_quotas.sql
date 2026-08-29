ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "xoomshare_resource_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "xoomshare_resource_bytes" integer DEFAULT 0 NOT NULL;
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "size_bytes" integer DEFAULT 0 NOT NULL;

-- Legacy uploaded files are represented by remote URLs, so their exact binary
-- size is unavailable. The backfill counts every persisted variable-length
-- field, while new binary resources retain their decoded input payload cost.
UPDATE "resources"
SET "size_bytes" =
  octet_length("content")
  + COALESCE(octet_length("title"), 0)
  + COALESCE(octet_length("description"), 0)
  + COALESCE(octet_length("thumbnail_url"), 0)
WHERE "size_bytes" = 0;

UPDATE "pages" AS root
SET
  "xoomshare_resource_count" = totals.resource_count,
  "xoomshare_resource_bytes" = totals.resource_bytes
FROM (
  SELECT
    root_page.id AS root_id,
    COUNT(resource.id)::integer AS resource_count,
    COALESCE(SUM(resource.size_bytes), 0)::integer AS resource_bytes
  FROM "pages" AS root_page
  LEFT JOIN "pages" AS room_page ON room_page.session_id = root_page.session_id
  LEFT JOIN "resources" AS resource ON resource.page_id = room_page.id
  WHERE root_page.path_code IS NOT NULL AND root_page.session_id IS NOT NULL
  GROUP BY root_page.id
) AS totals
WHERE root.id = totals.root_id;

-- Postgres does not support ADD CONSTRAINT IF NOT EXISTS. These catalog guards
-- keep a manually replayed/dev migration idempotent without masking failures
-- from the ALTER TABLE itself.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pages_xoomshare_resource_count_nonnegative') THEN
    ALTER TABLE "pages" ADD CONSTRAINT "pages_xoomshare_resource_count_nonnegative"
      CHECK ("xoomshare_resource_count" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pages_xoomshare_resource_bytes_nonnegative') THEN
    ALTER TABLE "pages" ADD CONSTRAINT "pages_xoomshare_resource_bytes_nonnegative"
      CHECK ("xoomshare_resource_bytes" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resources_size_bytes_nonnegative') THEN
    ALTER TABLE "resources" ADD CONSTRAINT "resources_size_bytes_nonnegative"
      CHECK ("size_bytes" >= 0);
  END IF;
END $$;

-- Room-scoped authorization, aggregation, and cleanup all begin from these
-- columns. They also keep multi-page Xoomshare operations bounded.
CREATE INDEX IF NOT EXISTS "pages_session_id_idx" ON "pages" ("session_id");
CREATE INDEX IF NOT EXISTS "resources_page_id_idx" ON "resources" ("page_id");
