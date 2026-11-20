import { describe, expect, test } from 'bun:test'
import { cleanupExitCode, runCleanupJob } from './cleanup'

const makeCleanupSql = ({
  candidates = [],
  roots = [],
  assets = [],
  queue = [],
}: {
  candidates?: any[]
  roots?: any[]
  assets?: any[]
  queue?: any[]
}) => {
  const queries: string[] = []
  let released = 0
  const reserved: any = (parts: TemplateStringsArray) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim()
    queries.push(query)
    if (query.includes('pg_try_advisory_lock')) return Promise.resolve([{ acquired: true }])
    if (query.includes('pg_advisory_unlock')) return Promise.resolve([{ released: true }])
    if (query.includes('SELECT id, session_id') && query.includes('FROM pages')) return Promise.resolve(candidates)
    if (query.includes('UPDATE pages SET xoomshare_resource_count')) return Promise.resolve(roots)
    if (query.includes('SELECT provider_public_id, provider_resource_type') && query.includes('FROM resources')) return Promise.resolve(assets)
    if (query.includes('INSERT INTO asset_deletion_queue')) return Promise.resolve([])
    if (query.includes('DELETE FROM pages')) return Promise.resolve([])
    if (query.includes('SELECT id, provider_public_id, provider_resource_type') && query.includes('FROM asset_deletion_queue')) return Promise.resolve(queue)
    if (query.includes('DELETE FROM asset_deletion_queue')) return Promise.resolve([])
    if (query.includes('UPDATE asset_deletion_queue')) return Promise.resolve([])
    throw new Error(`unexpected cleanup query: ${query}`)
  }
  reserved.begin = async (callback: (tx: any) => Promise<unknown>) => callback(reserved)
  reserved.release = () => { released += 1 }
  return {
    sql: { reserve: async () => reserved },
    queries,
    released: () => released,
  }
}

describe('cleanup exit semantics', () => {
  const clean = { skipped: false, roomsDeleted: 0, roomFailures: 0, assetsDeleted: 0, assetFailures: 0 }
  test('uses zero for no work and overlap', () => {
    expect(cleanupExitCode(clean)).toBe(0)
    expect(cleanupExitCode({ ...clean, skipped: true })).toBe(0)
  })
  test('uses two for retained partial failures and one for fatal setup', () => {
    expect(cleanupExitCode({ ...clean, roomFailures: 1 })).toBe(2)
    expect(cleanupExitCode({ ...clean, assetFailures: 1 })).toBe(2)
    expect(cleanupExitCode(clean, true)).toBe(1)
  })
})

describe('cleanup lock lifecycle', () => {
  test('skips an overlapping job and releases its reserved connection', async () => {
    let released = 0
    const reserved: any = (parts: TemplateStringsArray) => {
      if (parts[0]?.includes('pg_try_advisory_lock')) return Promise.resolve([{ acquired: false }])
      throw new Error('unexpected cleanup query')
    }
    reserved.reserve = async () => reserved
    reserved.release = () => { released += 1 }
    const summary = await runCleanupJob({ sql: reserved })
    expect(summary.skipped).toBe(true)
    expect(cleanupExitCode(summary)).toBe(0)
    expect(released).toBe(1)
  })

  test('releases and reports a fatal setup failure', async () => {
    let released = 0
    const reserved: any = () => Promise.reject(new Error('db unavailable'))
    reserved.reserve = async () => reserved
    reserved.release = () => { released += 1 }
    await expect(runCleanupJob({ sql: reserved })).rejects.toThrow('db unavailable')
    expect(released).toBe(1)
  })

  test('deletes an expired room, durably queues its assets, and drains confirmed work', async () => {
    const fake = makeCleanupSql({
      candidates: [{ id: 'root', session_id: 'room' }],
      roots: [{ session_id: 'room' }],
      assets: [{ provider_public_id: 'room/asset', provider_resource_type: 'raw' }],
      queue: [{ id: 'queue-1', provider_public_id: 'room/asset', provider_resource_type: 'raw' }],
    })
    const destroyed: string[] = []
    const summary = await runCleanupJob({
      sql: fake.sql,
      destroy: async (asset) => { destroyed.push(asset.publicId!); return true },
    })

    expect(summary).toEqual({ skipped: false, roomsDeleted: 1, roomFailures: 0, assetsDeleted: 1, assetFailures: 0 })
    expect(destroyed).toEqual(['room/asset'])
    expect(fake.queries.some((query) => query.includes('INSERT INTO asset_deletion_queue'))).toBe(true)
    expect(fake.queries.some((query) => query.includes('DELETE FROM asset_deletion_queue'))).toBe(true)
    expect(fake.released()).toBe(1)
  })

  test('retains provider failures, increments attempts, and returns the partial-failure code', async () => {
    const fake = makeCleanupSql({
      queue: [{ id: 'queue-1', provider_public_id: 'room/asset', provider_resource_type: 'raw' }],
    })
    const summary = await runCleanupJob({ sql: fake.sql, destroy: async () => false })

    expect(summary.assetFailures).toBe(1)
    expect(cleanupExitCode(summary)).toBe(2)
    expect(fake.queries.some((query) => query.includes('SET attempts = attempts + 1'))).toBe(true)
    expect(fake.released()).toBe(1)
  })
})
