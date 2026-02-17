/**
 * Shared HTTP fetcher for Prizm API used by stdio MCP tool modules.
 * Injects scope into GET query and POST/PATCH body; adds Authorization header.
 */

export type PrizmFetcher = (path: string, options?: RequestInit) => Promise<unknown>

export function createPrizmFetcher(
  baseUrl: string,
  apiKey: string,
  scope: string
): PrizmFetcher {
  const base = baseUrl.replace(/\/+$/, '')

  return async function fetchPrizm(path: string, options: RequestInit = {}): Promise<unknown> {
    let url = `${base}${path}`
    const method = (options.method ?? 'GET').toUpperCase()
    let body = options.body
    if (scope) {
      if (method === 'GET' || method === 'DELETE') {
        url += (path.includes('?') ? '&' : '?') + `scope=${encodeURIComponent(scope)}`
      } else if (body && typeof body === 'string') {
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>
          parsed.scope = scope
          body = JSON.stringify(parsed)
        } catch {
          body = JSON.stringify({ scope })
        }
      } else {
        body = JSON.stringify({ scope })
      }
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      ...((options.headers as Record<string, string>) || {})
    }
    const res = await fetch(url, { ...options, body, headers })
    if (!res.ok) {
      throw new Error(`Prizm API error: ${res.status} ${await res.text()}`)
    }
    if (res.status === 204) return undefined
    return res.json()
  }
}
