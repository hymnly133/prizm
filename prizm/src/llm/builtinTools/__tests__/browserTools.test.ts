import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserExecutor } from '../browserTools'

// Use vi.hoisted to prevent vitest from hoisting the mock above the variables
const mocks = vi.hoisted(() => {
  return {
    mockGoto: vi.fn().mockResolvedValue(true),
    mockAct: vi.fn().mockResolvedValue({ success: true }),
    mockExtract: vi.fn().mockResolvedValue({ result: 'mocked data' }),
    mockObserve: vi.fn().mockResolvedValue([{ action: 'click button' }]),
    mockClose: vi.fn().mockResolvedValue(true),
    mockInit: vi.fn().mockResolvedValue(true)
  }
})

vi.mock('@browserbasehq/stagehand', () => {
  return {
    Stagehand: class {
      context = {
        pages: () => [{ goto: mocks.mockGoto }],
        newPage: () => Promise.resolve({ goto: mocks.mockGoto })
      }
      init() {
        return mocks.mockInit()
      }
      close() {
        return mocks.mockClose()
      }
      act(inst: string) {
        return mocks.mockAct(inst)
      }
      extract(inst: string) {
        return mocks.mockExtract(inst)
      }
      observe(inst: string) {
        return mocks.mockObserve(inst)
      }
    }
  }
})

describe('BrowserExecutor', () => {
  let executor: BrowserExecutor
  let mockContext: any

  beforeEach(() => {
    vi.clearAllMocks()
    executor = new BrowserExecutor()
    mockContext = {
      clientId: 'test-client',
      sessionId: 'test-session-1'
    }
  })

  // To prevent bleeding state across tests since BrowserExecutor holds an activeMap,
  // we issue a 'close' at the end of every test.
  afterEach(async () => {
    await executor.execute({ action: 'close' }, mockContext)
  })

  it('should initialize stagehand and navigate to a URL', async () => {
    const result = await executor.execute(
      { action: 'navigate', url: 'https://example.com' },
      mockContext
    )

    expect(mocks.mockInit).toHaveBeenCalledOnce()
    expect(mocks.mockGoto).toHaveBeenCalledWith('https://example.com')
    expect(result).toBe('Navigated to https://example.com')
  })

  it('should reuse the same stagehand instance for the same session ID', async () => {
    // First call initializes
    await executor.execute({ action: 'navigate', url: 'https://example.com' }, mockContext)
    expect(mocks.mockInit).toHaveBeenCalledOnce()

    // Second call should reuse, init shouldn't increment
    await executor.execute({ action: 'navigate', url: 'https://example.org' }, mockContext)
    expect(mocks.mockInit).toHaveBeenCalledOnce() // still 1
    expect(mocks.mockGoto).toHaveBeenCalledWith('https://example.org')
  })

  it('should route act action correctly', async () => {
    const result = await executor.execute(
      { action: 'act', instruction: 'click the login button' },
      mockContext
    )

    expect(mocks.mockAct).toHaveBeenCalledWith('click the login button')
    expect(result).toBe('Action completed: click the login button. Success: true')
  })

  it('should route extract action correctly', async () => {
    const result = await executor.execute(
      { action: 'extract', instruction: 'get title' },
      mockContext
    )

    expect(mocks.mockExtract).toHaveBeenCalledWith('get title')
    expect(result).toBe('Extracted data: {"result":"mocked data"}')
  })

  it('should route observe action correctly', async () => {
    const result = await executor.execute(
      { action: 'observe', instruction: 'list all links' },
      mockContext
    )

    expect(mocks.mockObserve).toHaveBeenCalledWith('list all links')
    expect(result).toBe('Observations: [{"action":"click button"}]')
  })

  it('should close the session', async () => {
    // initialize first
    await executor.execute({ action: 'navigate', url: 'https://example.com' }, mockContext)

    const result = await executor.execute({ action: 'close' }, mockContext)
    expect(mocks.mockClose).toHaveBeenCalledOnce()
    expect(result).toBe('Browser session closed.')

    // executing after close should result in re-init since the map was cleared
    await executor.execute({ action: 'navigate', url: 'https://example.com' }, mockContext)
    expect(mocks.mockInit).toHaveBeenCalledTimes(2)
  })

  it('should handle missing arguments gracefully', async () => {
    const resNav = await executor.execute({ action: 'navigate' }, mockContext)
    expect(resNav).toContain('Failed to execute navigate')

    const resAct = await executor.execute({ action: 'act' }, mockContext)
    expect(resAct).toContain('Failed to execute act')
  })

  it('should return message when close is called with no active session', async () => {
    const result = await executor.execute({ action: 'close' }, mockContext)
    expect(result).toBe('No active browser session to close.')
  })

  it('should reject unknown action', async () => {
    await executor.execute({ action: 'navigate', url: 'https://example.com' }, mockContext)

    const result = await executor.execute({ action: 'invalid_action' as any }, mockContext)
    expect(result).toContain('Failed to execute invalid_action')
    expect(result).toContain('Unknown browser action')
  })

  it('should use default clientId and sessionId when context omits them', async () => {
    const emptyContext = {}
    const result = await executor.execute({ action: 'close' }, emptyContext)
    expect(result).toBe('No active browser session to close.')
  })

  it('should require instruction for extract action', async () => {
    await executor.execute({ action: 'navigate', url: 'https://example.com' }, mockContext)
    const result = await executor.execute({ action: 'extract' }, mockContext)
    expect(result).toContain('Failed to execute extract')
  })

  it('should require instruction for observe action', async () => {
    await executor.execute({ action: 'navigate', url: 'https://example.com' }, mockContext)
    const result = await executor.execute({ action: 'observe' }, mockContext)
    expect(result).toContain('Failed to execute observe')
  })

  it('should handle Stagehand init failure and return error message', async () => {
    mocks.mockInit.mockRejectedValueOnce(new Error('CDP connection refused'))

    const result = await executor.execute(
      { action: 'navigate', url: 'https://example.com' },
      mockContext
    )

    expect(result).toContain('Failed to execute navigate')
    expect(result).toContain('CDP connection refused')
  })

  it('should expose toolName as prizm_browser', () => {
    expect(executor.toolName).toBe('prizm_browser')
  })
})
