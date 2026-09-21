\set ON_ERROR_STOP on

-- A fail-closed contract for the disposable canonical database. The expected
-- source relations must be postgres_fdw foreign tables in source-only schemas.
-- No statement in this file writes to either staging source.
DO $$
DECLARE
  relation_name text;
  relation_schema text;
  expected_server text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'heroku_source.users', 'heroku_source.pages', 'heroku_source.resources',
    'heroku_source.asset_deletion_queue',
    'neon_source.users', 'neon_source.pages', 'neon_source.resources'
  ] LOOP
    relation_schema := split_part(relation_name, '.', 1);
    expected_server := CASE relation_schema
      WHEN 'heroku_source' THEN 'heroku_stage'
      WHEN 'neon_source' THEN 'neon_stage'
    END;

    IF to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION 'Required source relation % is missing', relation_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_foreign_table ft
      JOIN pg_class c ON c.oid = ft.ftrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_foreign_server s ON s.oid = ft.ftserver
      WHERE n.nspname = relation_schema
        AND c.relname = split_part(relation_name, '.', 2)
        AND s.srvname = expected_server
        AND COALESCE(s.srvoptions, ARRAY[]::text[]) @> ARRAY['updatable=false']
        AND NOT (COALESCE(ft.ftoptions, ARRAY[]::text[]) @> ARRAY['updatable=true'])
        AND EXISTS (
          SELECT 1
          FROM pg_user_mappings um
          WHERE um.srvid = s.oid
            AND um.usename = current_user
            AND COALESCE(um.umoptions, ARRAY[]::text[]) @> ARRAY['user=merge_reader']
        )
    ) THEN
      RAISE EXCEPTION 'Source relation % must use its approved updatable=false server, have no table write override, and map the current user to merge_reader', relation_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_foreign_server h
    CROSS JOIN pg_foreign_server n
    WHERE h.srvname = 'heroku_stage'
      AND n.srvname = 'neon_stage'
      AND h.oid <> n.oid
      AND COALESCE(h.srvoptions, ARRAY[]::text[]) @> ARRAY['dbname=stage_heroku']
      AND COALESCE(n.srvoptions, ARRAY[]::text[]) @> ARRAY['dbname=stage_neon']
      AND EXISTS (
        SELECT 1 FROM unnest(COALESCE(h.srvoptions, ARRAY[]::text[])) AS option
        WHERE option LIKE 'host=saveswitch-stage-heroku-%'
      )
      AND EXISTS (
        SELECT 1 FROM unnest(COALESCE(n.srvoptions, ARRAY[]::text[])) AS option
        WHERE option LIKE 'host=saveswitch-stage-neon-%'
      )
  ) THEN
    RAISE EXCEPTION 'FDW servers must be distinct and point to the approved disposable Heroku and Neon staging databases';
  END IF;
END $$;

-- Aggregate-only evidence that the local source access path is available.
SELECT source, entity, row_count
FROM (
  SELECT 'heroku'::text AS source, 'users'::text AS entity, count(*)::bigint AS row_count FROM heroku_source.users
  UNION ALL SELECT 'heroku', 'pages', count(*)::bigint FROM heroku_source.pages
  UNION ALL SELECT 'heroku', 'resources', count(*)::bigint FROM heroku_source.resources
  UNION ALL SELECT 'heroku', 'asset_deletion_queue', count(*)::bigint FROM heroku_source.asset_deletion_queue
  UNION ALL SELECT 'neon', 'users', count(*)::bigint FROM neon_source.users
  UNION ALL SELECT 'neon', 'pages', count(*)::bigint FROM neon_source.pages
  UNION ALL SELECT 'neon', 'resources', count(*)::bigint FROM neon_source.resources
) AS source_counts
ORDER BY source, entity;
