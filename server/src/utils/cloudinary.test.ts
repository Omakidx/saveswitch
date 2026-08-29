import { describe, expect, test } from 'bun:test'
import { cleanupUncommittedResourceAsset, dedupeUploadedResourceAssets, getAssetDeletionQueueOutcome } from './cloudinary'

describe('resource upload cleanup lifecycle', () => {
  test('cleans a remote asset whose database transaction did not commit', async () => {
    const cleaned: string[] = []
    const result = await cleanupUncommittedResourceAsset(
      { url: 'https://example.test/resource', publicId: 'room/asset', resourceType: 'raw' },
      async (asset) => { cleaned.push(asset.publicId!); return true },
    )

    expect(result).toBe(true)
    expect(cleaned).toEqual(['room/asset'])
  })

  test('does not clean after commit clears the pending asset', async () => {
    const cleaned: string[] = []
    const result = await cleanupUncommittedResourceAsset(null, async (asset) => { cleaned.push(asset.url) })

    expect(result).toBe(false)
    expect(cleaned).toEqual([])
  })

  test('never sends development data URLs to remote cleanup', async () => {
    const cleaned: string[] = []
    const result = await cleanupUncommittedResourceAsset(
      { url: 'data:text/plain;base64,QQ==', publicId: null, resourceType: 'raw' },
      async (asset) => { cleaned.push(asset.url) },
    )

    expect(result).toBe(false)
    expect(cleaned).toEqual([])
  })

  test('keeps failed durable cleanup work for retry and removes confirmed work', () => {
    expect(getAssetDeletionQueueOutcome(true)).toEqual({ remove: true, incrementAttempts: false })
    expect(getAssetDeletionQueueOutcome(false)).toEqual({ remove: false, incrementAttempts: true })
  })

  test('reports failed immediate cleanup so callers retain the asset in the durable queue', async () => {
    const result = await cleanupUncommittedResourceAsset(
      { url: 'https://example.test/resource', publicId: 'room/failed', resourceType: 'raw' },
      async () => false,
    )
    expect(result).toBe(false)
    expect(getAssetDeletionQueueOutcome(result)).toEqual({ remove: false, incrementAttempts: true })
  })

  test('deduplicates remote cleanup work and ignores local data URLs', () => {
    const assets = dedupeUploadedResourceAssets([
      { url: 'https://example.test/a', publicId: 'folder/a', resourceType: 'raw' },
      { url: 'https://example.test/a-again', publicId: 'folder/a', resourceType: 'raw' },
      { url: 'data:application/pdf;base64,QQ==', publicId: null, resourceType: 'raw' },
    ])
    expect(assets).toEqual([{ url: 'https://example.test/a', publicId: 'folder/a', resourceType: 'raw' }])
  })
})
