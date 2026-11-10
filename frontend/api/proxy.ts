// Vercel Function: forwards /api/* (rewritten here by vercel.json) to the backend Worker on
// Cloudflare, adding the shared key. The key lives only in Vercel env vars, never in the browser.
//   BACKEND_URL      e.g. https://trimsheet-backend.<account>.workers.dev
//   BACKEND_API_KEY  same value as the backend's API_KEY secret
export const config = { maxDuration: 60 }

const HOP_BY_HOP = ['host', 'connection', 'content-length', 'accept-encoding', 'x-forwarded-host', 'x-vercel-id']

async function proxy(request: Request): Promise<Response> {
  const base = process.env.BACKEND_URL
  const key = process.env.BACKEND_API_KEY
  if (!base || !key) {
    return Response.json({ error: { code: 'not_configured', message: 'BACKEND_URL / BACKEND_API_KEY가 설정되지 않았습니다.' } }, { status: 500 })
  }

  const incoming = new URL(request.url)
  const path = (incoming.searchParams.get('path') ?? '').replace(/^\/+/, '')
  incoming.searchParams.delete('path')
  // Only plain path segments: never let the client point the proxy at another host.
  if (!/^[\w\-./%]*$/.test(path) || path.split('/').includes('..')) {
    return Response.json({ error: { code: 'bad_path', message: '잘못된 경로입니다.' } }, { status: 400 })
  }
  const target = new URL(`/api/${path}`, base)
  target.search = incoming.searchParams.toString()

  const headers = new Headers(request.headers)
  for (const h of HOP_BY_HOP) headers.delete(h)
  headers.set('x-trimsheet-key', key)

  const hasBody = !['GET', 'HEAD'].includes(request.method)
  const res = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    // Required by Node's fetch when streaming a request body.
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)

  // fetch already decoded the body; drop headers that describe the encoded form.
  const out = new Headers(res.headers)
  out.delete('content-encoding')
  out.delete('content-length')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
