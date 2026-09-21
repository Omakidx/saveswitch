type DownloadableResource = {
  type: string
  content: string
  title: string | null
}

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i
const SAFE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const isAllowedDataMime = (type: string, mimeType: string) => {
  if (type === 'image') return SAFE_IMAGE_MIME_TYPES.has(mimeType)
  if (type === 'pdf') return mimeType === 'application/pdf'
  return type === 'file' && mimeType === 'application/octet-stream'
}

const downloadName = (resource: DownloadableResource) => {
  const fallback = resource.type === 'image' ? 'image' : resource.type === 'pdf' ? 'document.pdf' : 'download'
  if (typeof resource.title !== 'string') return fallback
  return resource.title
    .replace(/[\r\n"\\]/g, '_')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .trim()
    .slice(0, 180) || fallback
}

export const createDownloadResponse = (resource: DownloadableResource, inline = false): Response | null => {
  if (!['image', 'pdf', 'file'].includes(resource.type) || typeof resource.content !== 'string') return null

  const dataMatch = DATA_URL_PATTERN.exec(resource.content)
  if (dataMatch) {
    const mimeType = dataMatch[1]!.toLowerCase()
    if (!isAllowedDataMime(resource.type, mimeType)) return null
    const bytes = Buffer.from(dataMatch[2]!, 'base64')
    const filename = downloadName(resource)
    const disposition = inline && resource.type === 'pdf' ? 'inline' : 'attachment'
    return new Response(bytes, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(bytes.byteLength),
        'Content-Type': mimeType,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  try {
    const url = new URL(resource.content)
    if (url.protocol !== 'https:') return null
    return new Response(null, {
      status: 302,
      headers: {
        'Cache-Control': 'private, no-store',
        Location: url.toString(),
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return null
  }
}
