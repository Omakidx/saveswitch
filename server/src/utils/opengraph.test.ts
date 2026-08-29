import { describe, expect, test } from 'bun:test';
import { fetchOpenGraphData, type OpenGraphDependencies } from './opengraph';

const publicResolver = async () => ['93.184.216.34'];
function htmlResponse(body = '<title>Public page</title>') {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}


describe('fetchOpenGraphData SSRF boundary', () => {
  test('returns metadata for an allowed public HTML page', async () => {
    const dependencies: OpenGraphDependencies = { resolveHostname: publicResolver, fetch: async () => htmlResponse('<meta property="og:title" content="Allowed">') };
    await expect(fetchOpenGraphData('https://public.example/page', dependencies)).resolves.toEqual({ title: 'Allowed', description: null, thumbnailUrl: null });
  });

  test.each(['http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://192.168.1.10/', 'http://[fc00::1]/', 'http://[fe80::1]/'])('rejects unsafe literal destination %s before fetching', async (url) => {
    let called = false;
    const result = await fetchOpenGraphData(url, { resolveHostname: async () => ['127.0.0.1'], fetch: async () => { called = true; return htmlResponse(); } });
    expect(result).toEqual({ title: null, description: null, thumbnailUrl: null });
    expect(called).toBe(false);
  });

  test('rejects a hostname that resolves to a private address before fetching', async () => {
    let called = false;
    const result = await fetchOpenGraphData('https://private.example', { resolveHostname: async () => ['10.0.0.8'], fetch: async () => { called = true; return htmlResponse(); } });
    expect(result).toEqual({ title: null, description: null, thumbnailUrl: null });
    expect(called).toBe(false);
  });

  test('revalidates every redirect and rejects a public-to-private redirect', async () => {
    const requests: string[] = [];
    const result = await fetchOpenGraphData('https://public.example/start', {
      resolveHostname: async (host) => host === 'public.example' ? ['93.184.216.34'] : ['169.254.169.254'],
      fetch: async (url) => { requests.push(String(url)); return new Response(null, { status: 302, headers: { location: 'http://metadata.example/latest' } }); },
    });
    expect(result).toEqual({ title: null, description: null, thumbnailUrl: null });
    expect(requests).toEqual(['https://public.example/start']);
  });

  test('requires HTML and bounds redirects', async () => {
    const nonHtml = await fetchOpenGraphData('https://public.example/data', { resolveHostname: publicResolver, fetch: async () => new Response('nope', { headers: { 'content-type': 'application/json' } }) });
    expect(nonHtml).toEqual({ title: null, description: null, thumbnailUrl: null });

    let count = 0;
    const redirects = await fetchOpenGraphData('https://public.example/loop', { resolveHostname: publicResolver, fetch: async () => { count += 1; return new Response(null, { status: 302, headers: { location: '/loop' } }); } });
    expect(redirects).toEqual({ title: null, description: null, thumbnailUrl: null });
    expect(count).toBe(4);
  });

  test('discards redirect bodies before following the next hop', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('redirect body')); },
      cancel() { cancelled = true; },
    });
    let calls = 0;
    const result = await fetchOpenGraphData('https://public.example/start', {
      resolveHostname: publicResolver,
      fetch: async () => {
        calls += 1;
        if (calls === 1) return new Response(body, { status: 302, headers: { location: 'https://public.example/follow' } });
        return htmlResponse('<title>Followed safely</title>');
      },
    });
    expect(result).toEqual({ title: 'Followed safely', description: null, thumbnailUrl: null });
    expect(calls).toBe(2);
    expect(cancelled).toBe(true);
  });

  test('discards rejected non-HTML bodies without reading them', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('not HTML')); },
      cancel() { cancelled = true; },
    });
    const result = await fetchOpenGraphData('https://public.example/data', {
      resolveHostname: publicResolver,
      fetch: async () => new Response(body, { status: 415, headers: { 'content-type': 'application/json' } }),
    });
    expect(result).toEqual({ title: null, description: null, thumbnailUrl: null });
    expect(cancelled).toBe(true);
  });

  test('does not surface an untrusted OpenGraph thumbnail URL to browsers', async () => {
    const result = await fetchOpenGraphData('https://public.example/preview', {
      resolveHostname: publicResolver,
      fetch: async () => htmlResponse('<meta property="og:title" content="Safe title"><meta property="og:image" content="http://127.0.0.1/private.png">'),
    });
    expect(result).toEqual({ title: 'Safe title', description: null, thumbnailUrl: null });
  });
});
