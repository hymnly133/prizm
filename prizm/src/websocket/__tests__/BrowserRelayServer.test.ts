import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrowserRelayServer } from '../BrowserRelayServer'
import { Server } from 'http'
import WebSocket from 'ws'
import { AddressInfo } from 'net'
import type { ClientRegistry } from '../../auth/ClientRegistry'
import type { ValidateResult } from '../../auth/ClientRegistry'

function createMockClientRegistry(validKey: string, clientIdForKey: string): ClientRegistry {
  return {
    validate(apiKey: string): ValidateResult | null {
      if (apiKey !== validKey) return null
      return { clientId: clientIdForKey, allowedScopes: ['*'] }
    }
  } as unknown as ClientRegistry
}

describe('BrowserRelayServer', () => {
  let server: Server
  let relayServer: BrowserRelayServer
  let port: number
  let wsEndpoint: string

  beforeEach(async () => {
    server = new Server()
    relayServer = new BrowserRelayServer()

    server.on('upgrade', (req, socket, head) => {
      relayServer.handleUpgrade(req, socket, head)
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))
    port = (server.address() as AddressInfo).port
    wsEndpoint = `ws://localhost:${port}/api/v1/browser/relay`
  })

  afterEach(() => {
    server.close()
  })

  it('should accept provider and consumer connections and relay messages', async () => {
    const clientId = 'test-client-1'

    // Connect Provider
    const providerWs = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=provider`)
    await new Promise((resolve) => providerWs.on('open', resolve))

    // Connect Consumer
    const consumerWs = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=consumer`)
    await new Promise((resolve) => consumerWs.on('open', resolve))

    // Send from Consumer to Provider
    const consumerToProviderPromise = new Promise<string>((resolve) => {
      providerWs.once('message', (data) => resolve(data.toString()))
    })
    consumerWs.send('hello from consumer')
    expect(await consumerToProviderPromise).toBe('hello from consumer')

    // Send from Provider to Consumer
    const providerToConsumerPromise = new Promise<string>((resolve) => {
      consumerWs.once('message', (data) => resolve(data.toString()))
    })
    providerWs.send('reply from provider')
    expect(await providerToConsumerPromise).toBe('reply from provider')

    providerWs.close()
    consumerWs.close()
  })

  it('should queue messages if consumer sends before provider connects', async () => {
    const clientId = 'test-client-2'

    // Connect Consumer FIRST
    const consumerWs = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=consumer`)
    await new Promise((resolve) => consumerWs.on('open', resolve))

    // Send message while there is no provider
    consumerWs.send('queued message 1')
    consumerWs.send('queued message 2')

    // Connect Provider
    const providerWs = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=provider`)

    const messages: string[] = []
    providerWs.on('message', (data) => messages.push(data.toString()))

    await new Promise((resolve) => providerWs.on('open', resolve))

    // Wait a brief moment for the queue to drain
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(messages).toEqual(['queued message 1', 'queued message 2'])

    providerWs.close()
    consumerWs.close()
  })

  it('should reject invalid roles', async () => {
    const ws = new WebSocket(`${wsEndpoint}?clientId=test&role=hacker`)

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    })

    const { code, reason } = await closePromise
    expect(code).toBe(1008) // Policy Violation
    expect(reason).toBe('Invalid role')
  })

  it('should reject connection when role is missing', async () => {
    const ws = new WebSocket(`${wsEndpoint}?clientId=test`)

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    })

    const { code, reason } = await closePromise
    expect(code).toBe(1008)
    expect(reason).toBe('Invalid role')
  })

  it('should replace existing provider when new provider connects for same clientId', async () => {
    const clientId = 'replace-provider-client'

    const provider1 = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=provider`)
    await new Promise((resolve) => provider1.on('open', resolve))

    const provider2 = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=provider`)
    await new Promise((resolve) => provider2.on('open', resolve))

    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(provider1.readyState).toBe(WebSocket.CLOSED)
    expect(provider2.readyState).toBe(WebSocket.OPEN)

    provider2.close()
  })

  it('should replace existing consumer when new consumer connects for same clientId', async () => {
    const clientId = 'replace-consumer-client'

    const provider = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=provider`)
    await new Promise((resolve) => provider.on('open', resolve))

    const consumer1 = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=consumer`)
    await new Promise((resolve) => consumer1.on('open', resolve))

    const close1Promise = new Promise<number>((resolve) => {
      consumer1.on('close', (code) => resolve(code))
    })

    const consumer2 = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=consumer`)
    await new Promise((resolve) => consumer2.on('open', resolve))

    const code1 = await close1Promise
    expect(code1).toBe(1000)

    const msgPromise = new Promise<string>((resolve) => {
      provider.once('message', (data) => resolve(data.toString()))
    })
    consumer2.send('from new consumer')
    expect(await msgPromise).toBe('from new consumer')

    provider.close()
    consumer2.close()
  })

  it('should close consumer when provider disconnects', async () => {
    const clientId = 'provider-disconnect-client'

    const provider = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=provider`)
    await new Promise((resolve) => provider.on('open', resolve))

    const consumer = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=consumer`)
    await new Promise((resolve) => consumer.on('open', resolve))

    const consumerClosePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      consumer.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    })

    provider.close(1000, 'Provider leaving')

    const { code, reason } = await consumerClosePromise
    expect(code).toBe(1001)
    expect(reason).toContain('Provider disconnected')
  })

  it('should cleanup session when both provider and consumer disconnect', async () => {
    const clientId = 'cleanup-session-client'

    const provider = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=provider`)
    await new Promise((resolve) => provider.on('open', resolve))

    const consumer = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=consumer`)
    await new Promise((resolve) => consumer.on('open', resolve))

    provider.close()
    consumer.close()

    await new Promise((resolve) => setTimeout(resolve, 50))

    const provider2 = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=provider`)
    await new Promise((resolve) => provider2.on('open', resolve))
    expect(provider2.readyState).toBe(WebSocket.OPEN)
    provider2.close()
  })

  it('getPlaywrightEndpoint returns correct URL', () => {
    const endpoint = relayServer.getPlaywrightEndpoint(4127, 'my-client')
    expect(endpoint).toBe(
      'ws://localhost:4127/api/v1/browser/relay?clientId=my-client&role=consumer'
    )
  })

  it('accepts provider with valid apiKey and normalizes clientId to API key owner', async () => {
    const realClientId = 'real-client-id-from-registry'
    const apiKey = 'prizm_test_key_123'
    const mockRegistry = createMockClientRegistry(apiKey, realClientId)
    const authRelay = new BrowserRelayServer({
      clientRegistry: mockRegistry,
      authEnabled: true
    })
    const authServer = new Server()
    authServer.on('upgrade', (req, socket, head) => {
      authRelay.handleUpgrade(req, socket, head)
    })
    await new Promise<void>((resolve) => authServer.listen(0, resolve))
    const authPort = (authServer.address() as AddressInfo).port
    const authEndpoint = `ws://127.0.0.1:${authPort}/api/v1/browser/relay`

    // Provider connects with wrong clientId but valid apiKey -> should be accepted (normalized to realClientId)
    const providerWs = new WebSocket(
      `${authEndpoint}?clientId=wrong-display-name&apiKey=${encodeURIComponent(apiKey)}&role=provider`
    )
    await new Promise((resolve, reject) => {
      providerWs.on('open', resolve)
      providerWs.on('close', (code, reason) => reject(new Error(`Provider closed: ${code} ${reason}`)))
    })

    // Consumer connects with real clientId (as server-side Playwright would); no apiKey from loopback is allowed
    const consumerWs = new WebSocket(
      `${authEndpoint}?clientId=${realClientId}&role=consumer`
    )
    await new Promise((resolve) => consumerWs.on('open', resolve))

    // Same session: consumer -> provider message
    const received = new Promise<string>((resolve) => {
      providerWs.once('message', (data) => resolve(data.toString()))
    })
    consumerWs.send('ping')
    expect(await received).toBe('ping')

    providerWs.close()
    consumerWs.close()
    authRelay.destroy()
    authServer.close()
  })

  it('rejects consumer when clientId does not match API key owner', async () => {
    const realClientId = 'real-id'
    const apiKey = 'prizm_another_key'
    const mockRegistry = createMockClientRegistry(apiKey, realClientId)
    const authRelay = new BrowserRelayServer({
      clientRegistry: mockRegistry,
      authEnabled: true
    })
    const authServer = new Server()
    authServer.on('upgrade', (req, socket, head) => {
      authRelay.handleUpgrade(req, socket, head)
    })
    await new Promise<void>((resolve) => authServer.listen(0, resolve))
    const authPort = (authServer.address() as AddressInfo).port
    const authEndpoint = `ws://127.0.0.1:${authPort}/api/v1/browser/relay`

    const consumerWs = new WebSocket(
      `${authEndpoint}?clientId=wrong-id&apiKey=${encodeURIComponent(apiKey)}&role=consumer`
    )
    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      consumerWs.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    })
    const { code, reason } = await closePromise
    expect(code).toBe(4003)
    expect(reason).toContain('clientId does not match')

    authRelay.destroy()
    authServer.close()
  })

  it('destroy closes all connections and clears sessions', async () => {
    const clientId = 'destroy-client'

    const provider = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=provider`)
    await new Promise((resolve) => provider.on('open', resolve))

    const consumer = new WebSocket(`${wsEndpoint}?clientId=${clientId}&role=consumer`)
    await new Promise((resolve) => consumer.on('open', resolve))

    const providerClosePromise = new Promise<number>((resolve) => {
      provider.on('close', (code) => resolve(code))
    })
    const consumerClosePromise = new Promise<number>((resolve) => {
      consumer.on('close', (code) => resolve(code))
    })

    relayServer.destroy()

    expect(await providerClosePromise).toBe(1001)
    expect(await consumerClosePromise).toBe(1001)
  })
})
