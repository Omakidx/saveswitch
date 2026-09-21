import { describe, expect, test } from 'bun:test'
import { checkDatabaseReadiness } from './readiness'

describe('checkDatabaseReadiness', () => {
  test('accepts a successful bounded query', async () => {
    expect(await checkDatabaseReadiness({ execute: async () => [] }, 'SELECT 1', 20)).toBe(true)
  })
  test('rejects query failures and deadlines without exposing details', async () => {
    expect(checkDatabaseReadiness({ execute: () => { throw new Error('synchronous failure') } }, 'SELECT 1', 20)).resolves.toBe(false)
    expect(await checkDatabaseReadiness({ execute: async () => { throw new Error('sensitive') } }, 'SELECT 1', 20)).toBe(false)
    let cancelled = false
    const pending = new Promise(() => {}) as Promise<unknown> & { cancel?: () => void }
    pending.cancel = () => { cancelled = true }
    expect(await checkDatabaseReadiness({ execute: () => pending }, 'SELECT 1', 1)).toBe(false)
    expect(cancelled).toBe(true)
  })
})
