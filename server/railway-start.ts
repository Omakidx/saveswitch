// Railway entrypoint: runs the API and a Cloudflare tunnel side by side.
//
// - The API listens on API_HOST:API_PORT (default 127.0.0.1:5010). The tunnel's
//   remotely managed ingress forwards api.saveswitch.xyz to that address.
// - cloudflared reads TUNNEL_TOKEN from the environment.
// - Railway's healthcheck hits GET /ready on $PORT, which returns 200 only once
//   the API answers /health and cloudflared reports registered connections.
// - If either child exits, this process exits so Railway restarts the container.

const apiHost = process.env.API_HOST || '127.0.0.1'
const apiPort = process.env.API_PORT || '5010'
const metricsAddress = '127.0.0.1:20241'
const readinessPort = Number(process.env.PORT) || 8080

if (!process.env.TUNNEL_TOKEN) {
  console.error('TUNNEL_TOKEN is not set; refusing to start without the Cloudflare tunnel.')
  process.exit(1)
}

const api = Bun.spawn(['bun', 'src/index.ts'], {
  env: { ...process.env, API_HOST: apiHost, PORT: apiPort },
  stdout: 'inherit',
  stderr: 'inherit',
})

const tunnel = Bun.spawn(
  ['cloudflared', 'tunnel', '--no-autoupdate', '--metrics', metricsAddress, 'run'],
  { env: process.env, stdout: 'inherit', stderr: 'inherit' },
)

let shuttingDown = false
function shutdown(code: number) {
  if (shuttingDown) return
  shuttingDown = true
  api.kill('SIGTERM')
  tunnel.kill('SIGTERM')
  setTimeout(() => process.exit(code), 15_000).unref()
  Promise.allSettled([api.exited, tunnel.exited]).then(() => process.exit(code))
}

api.exited.then((code) => {
  console.error(`API process exited with code ${code}`)
  shutdown(code || 1)
})
tunnel.exited.then((code) => {
  console.error(`cloudflared exited with code ${code}`)
  shutdown(code || 1)
})
process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))

async function isOk(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) })
    return res.ok
  } catch {
    return false
  }
}

let announced = false
Bun.serve({
  port: readinessPort,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname !== '/ready') return new Response('Not found', { status: 404 })
    const [apiReady, tunnelReady] = await Promise.all([
      isOk(`http://${apiHost}:${apiPort}/health`),
      isOk(`http://${metricsAddress}/ready`),
    ])
    if (apiReady && tunnelReady) {
      if (!announced) {
        announced = true
        console.log('API and tunnel ready')
      }
      return Response.json({ status: 'ready' })
    }
    return Response.json({ status: 'starting', api: apiReady, tunnel: tunnelReady }, { status: 503 })
  },
})
