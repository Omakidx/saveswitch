import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface OpenGraphData { title: string | null; description: string | null; thumbnailUrl: string | null; }
export interface OpenGraphDependencies { fetch?: (input: string, init: RequestInit) => Promise<Response>; resolveHostname?: (hostname: string) => Promise<string[]>; }
interface PageResponse {
  status: number;
  headers: Headers;
  readText(maxBytes: number): Promise<string>;
  /** Release an unread/partially-read response body. This is safe to call more than once. */
  discard(): Promise<void>;
}

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 1_000_000;
const HEADERS = { 'User-Agent': 'SaveSwitch link preview/1.0', Accept: 'text/html,application/xhtml+xml;q=0.9' };
const empty = (): OpenGraphData => ({ title: null, description: null, thumbnailUrl: null });

function decode(text: string | null): string | null {
  return text?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)) ?? null;
}
function ipv4(address: string): number[] | null {
  const parts = address.split('.'); const result = parts.map(Number);
  return parts.length === 4 && result.every((n, i) => /^\d+$/.test(parts[i]!) && n >= 0 && n <= 255) ? result : null;
}
function publicV4(address: string): boolean {
  const ip = ipv4(address); if (!ip) return false; const [a, b, c] = ip as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31)) return false;
  if (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) return false;
  if ((a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) return false;
  return true;
}
function expandV6(address: string): number[] | null {
  let value = address.replace(/^\[|\]$/g, '').toLowerCase(); let tail: string[] = [];
  if (value.includes('.')) { const at = value.lastIndexOf(':'); const v4 = ipv4(value.slice(at + 1)); if (!v4) return null; tail = [((v4[0]! << 8) | v4[1]!).toString(16), ((v4[2]! << 8) | v4[3]!).toString(16)]; value = value.slice(0, at + 1); }
  const halves = value.split('::'); if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : []; const right = halves[1] ? halves[1].split(':').filter(Boolean) : []; const supplied = [...left, ...right, ...tail];
  if (supplied.length > 8 || supplied.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  const groups = value.includes('::') ? [...left, ...Array(8 - supplied.length).fill('0'), ...right, ...tail] : supplied;
  return groups.length === 8 ? groups.map((x) => parseInt(x, 16)) : null;
}
function publicV6(address: string): boolean {
  const ip = expandV6(address); if (!ip) return false; const first = ip[0]!;
  if (ip.every((x) => x === 0) || (ip.slice(0, 7).every((x) => x === 0) && ip[7] === 1)) return false;
  if (ip.slice(0, 5).every((x) => x === 0) && ip[5] === 0xffff) return publicV4(`${ip[6]! >> 8}.${ip[6]! & 255}.${ip[7]! >> 8}.${ip[7]! & 255}`);
  return (first & 0xfe00) !== 0xfc00 && (first & 0xffc0) !== 0xfe80 && (first & 0xff00) !== 0xff00 && !(first === 0x2001 && ip[1] === 0x0db8);
}
const publicIp = (ip: string) => ip.includes(':') ? publicV6(ip) : publicV4(ip);
function validUrl(input: string): URL | null {
  try { const url = new URL(input); const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase(); const port = (url.protocol === 'http:' && (url.port === '' || url.port === '80')) || (url.protocol === 'https:' && (url.port === '' || url.port === '443'));
    return port && !url.username && !url.password && host && host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local') ? url : null;
  } catch { return null; }
}
async function resolvePublic(url: URL, resolve: (host: string) => Promise<string[]>): Promise<string[] | null> {
  const addresses = (await resolve(url.hostname.replace(/^\[|\]$/g, ''))).map((x) => x.replace(/^\[|\]$/g, ''));
  return addresses.length && addresses.every(publicIp) ? addresses : null;
}
async function defaultResolver(host: string): Promise<string[]> { return (await lookup(host, { all: true, verbatim: true })).map((x) => x.address); }
async function readFetch(response: Response, maximum: number): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) return ''; const chunks: Uint8Array[] = []; let bytes = 0; let complete = false;
  try { for (;;) { const { done, value } = await reader.read(); if (done) { complete = true; break; } if (!value) continue; bytes += value.byteLength; if (bytes > maximum) { await reader.cancel(); throw new Error('OpenGraph response exceeds size limit'); } chunks.push(value); } } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const combined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; } return new TextDecoder().decode(combined);
}
function pinnedRequest(url: URL, addresses: string[]): Promise<PageResponse> {
  const address = addresses[0]!; const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    let timerCleared = false;
    let absoluteTimer: ReturnType<typeof setTimeout> | undefined;
    const clearAbsoluteTimer = () => { if (timerCleared) return; timerCleared = true; if (absoluteTimer) clearTimeout(absoluteTimer); };
    const req = request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`, method: 'GET', headers: HEADERS,
      // Pin the request to the validated DNS answer to prevent a re-resolution/rebinding race.
      lookup: (_host, _opts, callback) => callback(null, address, address.includes(':') ? 6 : 4),
    }, (res) => { const headers = new Headers(); for (const [key, value] of Object.entries(res.headers)) { if (Array.isArray(value)) headers.set(key, value.join(', ')); else if (value !== undefined) headers.set(key, value); }
      let discarded = false;
      const discard = async () => { if (discarded) return; discarded = true; clearAbsoluteTimer(); if (!res.destroyed) res.destroy(); };
      resolve({ status: res.statusCode ?? 0, headers, discard, readText: async (maximum) => {
        const chunks: Uint8Array[] = []; let bytes = 0;
        try { for await (const chunk of res) { const value = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk); bytes += value.byteLength; if (bytes > maximum) throw new Error('OpenGraph response exceeds size limit'); chunks.push(value); }
          const combined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; } return new TextDecoder().decode(combined);
        } finally { await discard(); }
      } });
    });
    absoluteTimer = setTimeout(() => req.destroy(new Error('OpenGraph request exceeded wall-clock timeout')), TIMEOUT_MS);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('OpenGraph request timed out')));
    req.once('error', (error) => { clearAbsoluteTimer(); reject(error); });
    req.end();
  });
}
async function request(url: URL, addresses: string[], deps: OpenGraphDependencies): Promise<PageResponse> {
  if (!deps.fetch) return pinnedRequest(url, addresses);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try { response = await deps.fetch(url.toString(), { headers: HEADERS, redirect: 'manual', signal: controller.signal }); }
  catch (error) { clearTimeout(timeout); throw error; }
  let discarded = false;
  return {
    status: response.status,
    headers: response.headers,
    readText: (maximum) => readFetch(response, maximum),
    discard: async () => {
      if (discarded) return;
      discarded = true;
      clearTimeout(timeout);
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
    },
  };
}
function redirect(status: number) { return [301, 302, 303, 307, 308].includes(status); }
function html(response: PageResponse) { const type = response.headers.get('content-type')?.toLowerCase() ?? ''; const length = Number(response.headers.get('content-length')); return (type.startsWith('text/html') || type.startsWith('application/xhtml+xml')) && (!Number.isFinite(length) || length <= MAX_HTML_BYTES); }
async function safeHtml(input: string, deps: OpenGraphDependencies): Promise<string | null> {
  const resolve = deps.resolveHostname ?? defaultResolver; let url = validUrl(input); if (!url) return null;
  for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) { let addresses: string[] | null; try { addresses = await resolvePublic(url, resolve); } catch { return null; } if (!addresses) return null; let response: PageResponse; try { response = await request(url, addresses, deps); } catch { return null; }
    if (redirect(response.status)) {
      const location = response.headers.get('location'); let next: URL | null = null;
      try { if (location && hops < MAX_REDIRECTS) next = validUrl(new URL(location, url).toString()); } catch { next = null; }
      await response.discard();
      if (!next) return null;
      url = next;
      continue;
    }
    if (response.status < 200 || response.status >= 300 || !html(response)) { await response.discard(); return null; }
    try { return await response.readText(MAX_HTML_BYTES); } catch { return null; } finally { await response.discard(); }
  } return null;
}
/** Preview lookup is deliberately best-effort: all failures return empty metadata. */
export async function fetchOpenGraphData(input: string, dependencies: OpenGraphDependencies = {}): Promise<OpenGraphData> {
  const url = validUrl(input); if (!url) return empty(); const source = await safeHtml(url.toString(), dependencies); if (!source) return empty();
  const title = source.match(/<meta\s+name=["']title["']\s+content=["']([^"']+)["']/i) || source.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || source.match(/<title[^>]*>([^<]+)<\/title>/i);
  const description = source.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) || source.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  // Never surface third-party image URLs to browsers. A future proxy/cache must
  // reapply the DNS, IP and redirect checks before enabling thumbnails.
  return { title: decode(title?.[1]?.trim() ?? null), description: decode(description?.[1]?.trim() ?? null), thumbnailUrl: null };
}
