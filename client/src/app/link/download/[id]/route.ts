import { NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api';

type DownloadResource = {
  type?: unknown;
  content?: unknown;
  title?: unknown;
};

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i;
const SAFE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function isAllowedDataMime(type: string, mimeType: string) {
  if (type === 'image') return SAFE_IMAGE_MIME_TYPES.has(mimeType);
  if (type === 'pdf') return mimeType === 'application/pdf';
  return type === 'file' && mimeType === 'application/octet-stream';
}

function getDownloadName(resource: DownloadResource) {
  const fallback = resource.type === 'image'
    ? 'image'
    : resource.type === 'pdf'
      ? 'document.pdf'
      : 'download';
  if (typeof resource.title !== 'string') return fallback;

  return resource.title
    .replace(/[\r\n"\\]/g, '_')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .trim()
    .slice(0, 180) || fallback;
}

function attachmentResponse(resource: DownloadResource) {
  if (
    typeof resource.type !== 'string' ||
    typeof resource.content !== 'string' ||
    !['image', 'pdf', 'file'].includes(resource.type)
  ) {
    return new NextResponse('Resource is not downloadable', { status: 400 });
  }

  const dataMatch = DATA_URL_PATTERN.exec(resource.content);
  if (dataMatch) {
    const mimeType = dataMatch[1]!.toLowerCase();
    if (!isAllowedDataMime(resource.type, mimeType)) {
      return new NextResponse('Resource is not downloadable', { status: 400 });
    }

    const bytes = Buffer.from(dataMatch[2]!, 'base64');
    const filename = getDownloadName(resource);
    return new NextResponse(bytes, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(bytes.byteLength),
        'Content-Type': mimeType,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  try {
    const url = new URL(resource.content);
    if (url.protocol !== 'https:') {
      return new NextResponse('Resource is not downloadable', { status: 400 });
    }
    return NextResponse.redirect(url);
  } catch {
    return new NextResponse('Resource is not downloadable', { status: 400 });
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new NextResponse('Resource not found', { status: 404 });
  }

  try {
    const res = await fetch(`${API_BASE}/resources/${id}`);
    if (!res.ok) {
      return new NextResponse('Resource not found', { status: 404 });
    }

    const data = await res.json();
    if (!data.success || !data.resource) {
      return new NextResponse('Resource not found', { status: 404 });
    }

    return attachmentResponse(data.resource as DownloadResource);
  } catch (error) {
    console.error('Error fetching resource:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
