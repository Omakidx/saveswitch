import { NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api';
import { isValidXoomsharePathCode } from '@/lib/downloadPath';

type DownloadResource = {
  type?: unknown;
  content?: unknown;
  title?: unknown;
};

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i;
const SAFE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const RESOURCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFoundResponse() {
  return new NextResponse('Resource not found', {
    status: 404,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

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
    return notFoundResponse();
  }

  const dataMatch = DATA_URL_PATTERN.exec(resource.content);
  if (dataMatch) {
    const mimeType = dataMatch[1]!.toLowerCase();
    if (!isAllowedDataMime(resource.type, mimeType)) {
      return notFoundResponse();
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
      return notFoundResponse();
    }
    return NextResponse.redirect(url, {
      status: 302,
      headers: {
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return notFoundResponse();
  }
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!RESOURCE_ID_PATTERN.test(id)) return notFoundResponse();

  const xoomsharePathCodes = new URL(request.url).searchParams.getAll('xoomshare');
  if (xoomsharePathCodes.length > 1) return notFoundResponse();

  const xoomsharePathCode = xoomsharePathCodes[0];
  if (xoomsharePathCode !== undefined && !isValidXoomsharePathCode(xoomsharePathCode)) {
    return notFoundResponse();
  }

  try {
    const headers = new Headers();
    if (xoomsharePathCode) headers.set('x-saveswitch-xoomshare-path', xoomsharePathCode);

    const res = await fetch(`${API_BASE}/resources/${encodeURIComponent(id)}`, {
      cache: 'no-store',
      headers,
      // Do not follow an unexpected upstream redirect from the metadata endpoint.
      redirect: 'manual',
    });
    if (!res.ok) return notFoundResponse();

    const data = await res.json();
    if (!data.success || !data.resource) return notFoundResponse();

    return attachmentResponse(data.resource as DownloadResource);
  } catch {
    return notFoundResponse();
  }
}
