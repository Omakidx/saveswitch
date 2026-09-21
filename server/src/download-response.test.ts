import { describe, expect, test } from 'bun:test'
import { createDownloadResponse } from './download-response'

describe('createDownloadResponse', () => {
  test('creates a no-store inline PDF response without trusting the filename', async () => {
    const response = createDownloadResponse({
      type: 'pdf',
      content: 'data:application/pdf;base64,JVBERg==',
      title: 'report\r\nunsafe.pdf',
    }, true)
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-disposition')).toStartWith('inline; filename="report__unsafe.pdf"')
    expect(response?.headers.get('cache-control')).toBe('private, no-store')
    expect(await response?.arrayBuffer()).toHaveLength(4)
  })

  test('redirects only to HTTPS and rejects non-downloadable content', () => {
    expect(createDownloadResponse({ type: 'file', content: 'https://res.cloudinary.com/example/file', title: null })?.status).toBe(302)
    expect(createDownloadResponse({ type: 'file', content: 'http://example.com/file', title: null })).toBeNull()
    expect(createDownloadResponse({ type: 'text', content: 'secret', title: null })).toBeNull()
  })
})
