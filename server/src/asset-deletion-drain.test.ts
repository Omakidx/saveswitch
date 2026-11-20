import { describe, expect, test } from 'bun:test'
import { createAssetDeletionDrainer, type PendingAssetDeletion } from './asset-deletion-drain'

const item = (id: string): PendingAssetDeletion => ({ id, providerPublicId: `pub-${id}`, providerResourceType: 'raw' })

describe('asset deletion drainer', () => {
  test('removes destroyed assets, records failures, and isolates a throwing item from the rest', async () => {
    const removed: string[] = []
    const failed: string[] = []
    const errors: string[] = []
    const drain = createAssetDeletionDrainer({
      listPending: async () => [item('ok'), item('boom'), item('fail'), item('ok2')],
      destroy: async (i) => {
        if (i.id === 'boom') throw new Error('network')
        return i.id.startsWith('ok')
      },
      remove: async (i) => { removed.push(i.id) },
      recordFailure: async (i) => { failed.push(i.id) },
      onError: (message) => { errors.push(message) },
    })
    await drain()
    expect(removed).toEqual(['ok', 'ok2'])
    expect(failed).toEqual(['fail'])
    expect(errors).toHaveLength(1)
  })

  test('never rejects when the queue cannot be read (safe for fire-and-forget callers)', async () => {
    const drain = createAssetDeletionDrainer({
      listPending: async () => { throw new Error('db down') },
      destroy: async () => true,
      remove: async () => {},
      recordFailure: async () => {},
      onError: () => {},
    })
    await expect(drain()).resolves.toBeUndefined()
  })

  test('concurrent triggers share a single in-flight pass, then a later trigger runs again', async () => {
    let passes = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const drain = createAssetDeletionDrainer({
      listPending: async () => { passes += 1; await gate; return [] },
      destroy: async () => true,
      remove: async () => {},
      recordFailure: async () => {},
    })
    const first = drain()
    const second = drain()
    release()
    await Promise.all([first, second])
    expect(passes).toBe(1)
    await drain()
    expect(passes).toBe(2)
  })
})
