import { describe, expect, test } from 'bun:test'
import { installGracefulShutdown } from './shutdown'

describe('installGracefulShutdown', () => {
  test('closes once when invoked repeatedly', async () => {
    let closed = 0
    const shutdown = installGracefulShutdown({ close: () => { closed += 1 }, exit: () => {}, signals: [] })
    await Promise.all([shutdown(), shutdown()])
    expect(closed).toBe(1)
  })
})
