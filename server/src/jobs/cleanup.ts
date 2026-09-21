import { destroyUploadedResourceAsset, getAssetDeletionQueueOutcome } from '../utils/cloudinary'

const CLEANUP_ADVISORY_LOCK = 918_204_611
const DEFAULT_LIMIT = 25

export type CleanupSummary = {
  skipped: boolean
  roomsDeleted: number
  roomFailures: number
  assetsDeleted: number
  assetFailures: number
}

export const cleanupExitCode = (summary: CleanupSummary, fatal = false) =>
  fatal ? 1 : summary.roomFailures > 0 || summary.assetFailures > 0 ? 2 : 0

/**
 * Runs on a reserved postgres-js session. Advisory locks are session scoped,
 * therefore the lock is held until every room and outbox item has been handled.
 */
export const runCleanupJob = async ({
  sql,
  destroy = destroyUploadedResourceAsset,
  now = new Date(),
  limit = DEFAULT_LIMIT,
}: {
  sql: any
  destroy?: typeof destroyUploadedResourceAsset
  now?: Date
  limit?: number
}): Promise<CleanupSummary> => {
  const summary: CleanupSummary = { skipped: false, roomsDeleted: 0, roomFailures: 0, assetsDeleted: 0, assetFailures: 0 }
  const reserved = await sql.reserve()
  let locked = false
  try {
    const lockResult = await reserved`SELECT pg_try_advisory_lock(${CLEANUP_ADVISORY_LOCK}) AS acquired`
    locked = Boolean(lockResult[0]?.acquired)
    if (!locked) return { ...summary, skipped: true }

    const candidates = await reserved.begin((tx: any) => tx`
        SELECT id, session_id
        FROM pages
        WHERE path_code IS NOT NULL
          AND session_id IS NOT NULL
          AND (expires_at < ${now} OR created_at < ${new Date(now.getTime() - 3 * 60 * 60 * 1000)})
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `)
    for (const candidate of candidates) {
      try {
        await reserved.begin(async (tx: any) => {
          // Recheck under a row lock. This protects a room revived/changed after
          // candidate selection and serializes removal with room mutations.
          const roots = await tx`
            UPDATE pages SET xoomshare_resource_count = xoomshare_resource_count
            WHERE id = ${candidate.id}
              AND path_code IS NOT NULL
              AND session_id = ${candidate.session_id}
              AND (expires_at < ${now} OR created_at < ${new Date(now.getTime() - 3 * 60 * 60 * 1000)})
            RETURNING session_id
          `
          if (roots.length === 0) return
          const assets = await tx`
            SELECT provider_public_id, provider_resource_type
            FROM resources
            WHERE page_id IN (SELECT id FROM pages WHERE session_id = ${candidate.session_id})
              AND provider_public_id IS NOT NULL
              AND provider_resource_type IN ('image', 'raw')
          `
          for (const asset of assets) {
            await tx`
              INSERT INTO asset_deletion_queue (provider_public_id, provider_resource_type)
              VALUES (${asset.provider_public_id}, ${asset.provider_resource_type})
              ON CONFLICT (provider_public_id) DO NOTHING
            `
          }
          await tx`DELETE FROM pages WHERE session_id = ${candidate.session_id}`
          summary.roomsDeleted += 1
        })
      } catch {
        // Continue through later rooms: a bad room must not starve the queue.
        summary.roomFailures += 1
      }
    }

    const queue = await reserved.begin((tx: any) => tx`
      SELECT id, provider_public_id, provider_resource_type
      FROM asset_deletion_queue
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `)
    for (const item of queue) {
      try {
        const outcome = getAssetDeletionQueueOutcome(await destroy({
          url: '', publicId: item.provider_public_id, resourceType: item.provider_resource_type,
        }))
        if (outcome.remove) {
          await reserved`DELETE FROM asset_deletion_queue WHERE id = ${item.id}`
          summary.assetsDeleted += 1
        } else if (outcome.incrementAttempts) {
          await reserved`
            UPDATE asset_deletion_queue
            SET attempts = attempts + 1, last_error = 'Cloudinary destroy failed; retry scheduled', updated_at = ${new Date()}
            WHERE id = ${item.id}
          `
          summary.assetFailures += 1
        }
      } catch {
        // Retain the durable row even if the provider client itself throws.
        await reserved`
          UPDATE asset_deletion_queue
          SET attempts = attempts + 1, last_error = 'Cloudinary destroy failed; retry scheduled', updated_at = ${new Date()}
          WHERE id = ${item.id}
        `
        summary.assetFailures += 1
      }
    }
    return summary
  } finally {
    try {
      if (locked) await reserved`SELECT pg_advisory_unlock(${CLEANUP_ADVISORY_LOCK})`
    } finally {
      reserved.release()
    }
  }
}
