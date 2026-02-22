import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 1. Mocks via hoisted so they can be referenced inside vi.mock factory
const mocks = vi.hoisted(() => {
  return {
    mockBrowserView: class {
      webContents = {
        loadURL: vi.fn(),
        session: {
          setProxy: vi.fn()
        },
        close: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false)
      }
    },
    mockSessionFromPartition: vi.fn().mockReturnValue({
      setProxy: vi.fn()
    }),
    mockSpawnOn: vi.fn(),
    mockSpawnKill: vi.fn(),
    mockWsOn: vi.fn(),
    mockWsSend: vi.fn(),
    mockWsClose: vi.fn()
  }
})

// 1. Mock Electron
vi.mock('electron', () => {
  const electronMock = {
    app: {
      getAppPath: vi.fn().mockReturnValue('/mock/app/path'),
      getPath: vi.fn().mockReturnValue('/mock/user/data')
    },
    BrowserView: mocks.mockBrowserView,
    session: {
      fromPartition: mocks.mockSessionFromPartition
    }
  }
  return {
    ...electronMock,
    default: electronMock
  }
})

// 2. Mock 'fs' and 'path'
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true) // assume chromium / chrome exists
}))

// 3. Mock windowManager to avoid referencing actual window
vi.mock('../windowManager', () => ({
  windowManager: {
    getMainWindow: vi.fn().mockReturnValue({
      setBrowserView: vi.fn(),
      removeBrowserView: vi.fn(),
      getBounds: vi.fn().mockReturnValue({ width: 800, height: 600 })
    })
  }
}))

// 4. Mock process spawn
vi.mock('child_process', () => ({
  spawn: vi.fn().mockImplementation(() => {
    return {
      on: mocks.mockSpawnOn,
      kill: mocks.mockSpawnKill,
      stdout: { on: vi.fn(), pipe: vi.fn() },
      stderr: { on: vi.fn(), pipe: vi.fn() }
    }
  })
}))

// 5. Mock Config and Log
vi.mock('../config', () => ({
  loadConfigFromDisk: vi.fn().mockReturnValue({
    client: { name: 'test-client' },
    server: { host: '127.0.0.1', port: 4127 }
  })
}))

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

// 6. Mock WebSocket
vi.mock('ws', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return {
        on: mocks.mockWsOn,
        send: mocks.mockWsSend,
        close: mocks.mockWsClose,
        readyState: 1 // OPEN
      }
    })
  }
})

// Import Service after mocks
import { browserNodeService } from '../browserNodeService'

describe('BrowserNodeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // We mock the polling for endpoint to just immediately resolve
    vi.spyOn(browserNodeService as any, 'waitForCdpEndpoint').mockResolvedValue(
      'ws://localhost:9222/devtools/browser/mock'
    )

    // We mock the websocket relay tunnel connect so it doesn't actually connect
    vi.spyOn(browserNodeService as any, 'connectToServerTunnel').mockResolvedValue(undefined)

    // We mock getBrowserExecutablePath to prevent failure on missing Chrome path
    vi.spyOn(browserNodeService as any, 'getBrowserExecutablePath').mockReturnValue(
      '/mock/chrome.exe'
    )
  })

  afterEach(async () => {
    await browserNodeService.stopNode()
  })

  it('should get initial status as stopped', () => {
    const status = browserNodeService.getStatus()
    expect(status.isRunning).toBe(false)
    expect(status.mode).toBeNull()
  })

  it('should start External process node successfully', async () => {
    const result = await browserNodeService.startNode('external')
    if (!result.success) console.error('[Test External] Msg:', result.message)
    expect(result.success).toBe(true)
    expect(browserNodeService.getStatus().isRunning).toBe(true)
    expect(browserNodeService.getStatus().mode).toBe('external')

    expect((browserNodeService as any).waitForCdpEndpoint).toHaveBeenCalled()
    expect((browserNodeService as any).connectToServerTunnel).toHaveBeenCalled()
  })

  it('should start Internal view node successfully', async () => {
    const result = await browserNodeService.startNode('internal')
    if (!result.success) console.error('[Test Internal] Msg:', result.message)
    expect(result.success).toBe(true)
    expect(browserNodeService.getStatus().isRunning).toBe(true)
    expect(browserNodeService.getStatus().mode).toBe('internal')

    expect((browserNodeService as any).waitForCdpEndpoint).toHaveBeenCalled()
    expect((browserNodeService as any).connectToServerTunnel).toHaveBeenCalled()
  })

  it('should stop active node and clear resources', async () => {
    await browserNodeService.startNode('external')
    expect(browserNodeService.getStatus().isRunning).toBe(true)

    await browserNodeService.stopNode()

    expect(browserNodeService.getStatus().isRunning).toBe(false)
    expect(browserNodeService.getStatus().mode).toBeNull()
    expect(mocks.mockSpawnKill).toHaveBeenCalled()
  })

  it('should fail start when getBrowserExecutablePath returns null (external mode)', async () => {
    vi.spyOn(browserNodeService as any, 'getBrowserExecutablePath').mockReturnValueOnce(null)

    const result = await browserNodeService.startNode('external')

    expect(result.success).toBe(false)
    expect(result.message).toContain('Chrome')
    expect(result.message).toContain('Edge')
    expect(browserNodeService.getStatus().isRunning).toBe(false)
  })

  it('should fail when waitForCdpEndpoint times out', async () => {
    vi.spyOn(browserNodeService as any, 'waitForCdpEndpoint').mockRejectedValue(
      new Error('Timeout waiting for local browser CDP endpoint')
    )

    const result = await browserNodeService.startNode('external')

    expect(result.success).toBe(false)
    expect(result.message).toContain('Timeout')
    expect(browserNodeService.getStatus().isRunning).toBe(false)
  })

  it('should fail when connectToServerTunnel rejects', async () => {
    vi.spyOn(browserNodeService as any, 'connectToServerTunnel').mockRejectedValue(
      new Error('ECONNREFUSED')
    )

    const result = await browserNodeService.startNode('external')

    expect(result.success).toBe(false)
    expect(result.message).toContain('ECONNREFUSED')
    expect(browserNodeService.getStatus().isRunning).toBe(false)
  })

  it('should return already running when startNode is called twice', async () => {
    await browserNodeService.startNode('external')
    const second = await browserNodeService.startNode('external')

    expect(second.success).toBe(false)
    expect(second.message).toContain('already running')
    expect(browserNodeService.getStatus().mode).toBe('external')
  })

  it('should return status with wsEndpoint when running', async () => {
    await browserNodeService.startNode('external')

    const status = browserNodeService.getStatus()
    expect(status.isRunning).toBe(true)
    expect(status.mode).toBe('external')
    expect(status.wsEndpoint).toBe('ws://localhost:9222/devtools/browser/mock')
  })

  it('should be idempotent to call stopNode when not running', async () => {
    await expect(browserNodeService.stopNode()).resolves.not.toThrow()
    expect(browserNodeService.getStatus().isRunning).toBe(false)
  })
})
