import { describe, expect, test } from 'bun:test'
import { reportProfileUpdateFailure } from './profile-update-error'

describe('reportProfileUpdateFailure', () => {
  test('does not expose unexpected error details in logs or responses', () => {
    const marker = 'DO_NOT_DISCLOSE_INTERNAL_DATABASE_DETAIL'
    const captured: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => { captured.push(args) }
    try {
      const response = reportProfileUpdateFailure(new Error(marker))
      expect(response).toEqual({ status: 500, error: 'Unable to update the profile right now.' })
      expect(JSON.stringify({ response, captured })).not.toContain(marker)
    } finally {
      console.error = original
    }
  })
})
