export interface OpenGraphData {
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
}

function decodeHTMLEntities(text: string | null): string | null {
  if (!text) return text;
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}

export async function fetchOpenGraphData(url: string): Promise<OpenGraphData> {
  let title = null;
  let description = null;
  let thumbnailUrl = null;

  // YouTube fast-path for thumbnails and reliable metadata
  const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/|watch\?.+&v=))([\w-]{11})/);
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    
    try {
      const ytRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({
          context: {
            client: { hl: 'en', gl: 'US', clientName: 'WEB', clientVersion: '2.20210721.00.00' }
          },
          videoId: videoId
        }),
        signal: AbortSignal.timeout(5000)
      });
      const ytData = await ytRes.json() as any;
      if (ytData.videoDetails) {
        title = ytData.videoDetails.title;
        description = ytData.videoDetails.shortDescription || null;
      }
    } catch (err) {
      console.error(`Failed to fetch youtubei metadata for ${videoId}:`, err);
    }
    
    // Fallback to Googlebot HTML fetch if youtubei failed (due to anti-bot or age restrictions)
    if (!title || !description) {
      try {
        const botRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
          },
          signal: AbortSignal.timeout(5000)
        });
        const botHtml = await botRes.text();
        const tMatch = botHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
        const dMatch = botHtml.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) || botHtml.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
        
        if (!title && tMatch?.[1]) {
          title = tMatch[1].replace(' - YouTube', '').trim();
        }
        if (!description && dMatch?.[1]) {
          description = dMatch[1].trim();
        }
      } catch (err) {
        console.error(`Failed to fetch Googlebot fallback metadata for ${videoId}:`, err);
      }
    }
    
    // Return early for YouTube to avoid the generic HTML fetch which gives "- YouTube"
    return { 
      title: decodeHTMLEntities(title), 
      description: decodeHTMLEntities(description), 
      thumbnailUrl 
    };
  }
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(5000)
    });
    const html = await res.text();

    const titleMatch = html.match(/<meta\s+name=["']title["']\s+content=["']([^"']+)["']/i) || html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) || html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
    const imageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);

    title = titleMatch?.[1]?.trim() ?? null;
    description = descMatch?.[1]?.trim() ?? null;
    
    if (!thumbnailUrl && imageMatch?.[1]) {
      thumbnailUrl = imageMatch[1].trim();
    }
  } catch (error) {
    console.error(`Failed to fetch OpenGraph data for ${url}:`, error);
  }

  return { 
    title: decodeHTMLEntities(title), 
    description: decodeHTMLEntities(description), 
    thumbnailUrl 
  };
}
