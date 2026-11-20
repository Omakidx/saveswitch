export type PendingAssetDeletion = {
  id: string
  providerPublicId: string
  providerResourceType: 'image' | 'raw'
}

export type AssetDeletionDrainDeps = {
  listPending: (limit: number) => Promise<PendingAssetDeletion[]>
  destroy: (item: PendingAssetDeletion) => Promise<boolean>
  remove: (item: PendingAssetDeletion) => Promise<void>
  recordFailure: (item: PendingAssetDeletion) => Promise<void>
  onError?: (message: string, error: unknown) => void
}

/**
 * Builds a drain function that is safe to fire-and-forget: it never rejects,
 * runs at most one pass at a time per process, and isolates failures per item so
 * one bad asset (or a transient DB/Cloudinary error) cannot stall the others or
 * surface as an unhandled promise rejection.
 */
export const createAssetDeletionDrainer = (deps: AssetDeletionDrainDeps) => {
  let inFlight: Promise<void> | null = null
  const onError = deps.onError ?? ((message, error) => console.error(message, error))

  const run = async (limit: number) => {
    let pending: PendingAssetDeletion[]
    try {
      pending = await deps.listPending(limit)
    } catch (error) {
      onError('Asset deletion queue read failed:', error)
      return
    }
    for (const item of pending) {
      try {
        if (await deps.destroy(item)) await deps.remove(item)
        else await deps.recordFailure(item)
      } catch (error) {
        onError('Asset deletion queue item failed:', error)
      }
    }
  }

  return (limit = 25): Promise<void> => {
    if (inFlight) return inFlight
    inFlight = run(limit).finally(() => { inFlight = null })
    return inFlight
  }
}
