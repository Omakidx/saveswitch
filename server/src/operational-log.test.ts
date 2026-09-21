import { describe, expect, test } from 'bun:test'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { logOperationalFailure } from './operational-log'

describe('logOperationalFailure', () => {
  test('does not log a Drizzle query, parameters, cause, or private content', () => {
    const marker = 'DO_NOT_LOG_PRIVATE_RESOURCE_CONTENT'
    const failure = new DrizzleQueryError('insert into resources values ($1)', [marker], new Error(marker))
    const captured: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => { captured.push(args) }
    try {
      logOperationalFailure('Create resource failed', failure)
      const output = JSON.stringify(captured)
      expect(output).toBe('[["Create resource failed",{"kind":"error"}]]')
      expect(output).not.toContain(marker)
      expect(output).not.toContain('insert into resources')
      expect(output).not.toContain('params')
    } finally {
      console.error = original
    }
  })
})
