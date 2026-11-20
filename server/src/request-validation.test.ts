import { describe, expect, test } from 'bun:test'
import { isUuid } from './request-validation'

describe('isUuid', () => {
  test('accepts valid RFC UUIDs and rejects database-invalid route values', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isUuid('.env')).toBe(false)
    expect(isUuid('not-a-resource-id')).toBe(false)
  })
})

import { asRecord, isUniqueViolation } from './request-validation'

describe('asRecord', () => {
  test('turns null, arrays and primitives into an empty object so handlers cannot throw on destructuring', () => {
    expect(asRecord(null)).toEqual({})
    expect(asRecord(undefined)).toEqual({})
    expect(asRecord([1, 2])).toEqual({})
    expect(asRecord('x')).toEqual({})
    expect(asRecord({ a: 1 })).toEqual({ a: 1 })
  })
})

describe('isUniqueViolation', () => {
  test('detects Postgres 23505 directly and through drizzle wrapper causes', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation(new Error('wrapped', { cause: { code: '23505' } }))).toBe(true)
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})

import { isSafeCssColor } from './request-validation'

describe('isSafeCssColor', () => {
  test('accepts the colors the client and server really generate and rejects injection attempts', () => {
    for (const ok of ['#fffDCE', '#fff', 'rgba(255, 244, 210, 0.48)', 'hsl(120, 70%, 85%)', 'rgb(1 2 3 / 0.5)']) expect(isSafeCssColor(ok)).toBe(true)
    for (const bad of ['red; background:url(x)', 'url(javascript:1)', '#ggg', 'rgb(1,2,3);x', '', 5, 'hsl(1,2%,3%)<script>']) expect(isSafeCssColor(bad)).toBe(false)
  })
})
