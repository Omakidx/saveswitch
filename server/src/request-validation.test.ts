import { describe, expect, test } from 'bun:test'
import { isUuid } from './request-validation'

describe('isUuid', () => {
  test('accepts valid RFC UUIDs and rejects database-invalid route values', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isUuid('.env')).toBe(false)
    expect(isUuid('not-a-resource-id')).toBe(false)
  })
})
