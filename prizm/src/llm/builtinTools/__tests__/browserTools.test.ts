import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserExecutor } from '../browserTools'

const fakePage = {
  goto: vi.fn().mockResolvedValue(undefined),
  locator: vi.fn(() => ({
    nth: () => ({
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      selectOption: vi.fn().mockResolvedValue(undefined)
    })
  }))
}
const fakeSession = {
  page: fakePage,
  close: vi.fn().mockResolvedValue(undefined)
}

vi.mock('../../config', () => ({ getConfig: () => ({ port: 4127, dataDir: '/tmp' }) }))
vi.mock('../../playwrightBrowserSession', () => ({
  connectPlaywrightBrowser: vi.fn(() => Promise.resolve(fakeSession)),
  getAccessibilitySnapshot: vi.fn(() =>
    Promise.resolve([{ ref: 0, role: 'button', name: 'Submit' }])
  ),
  executeResolvedAct: vi.fn(() => Promise.resolve()),
  getPageText: vi.fn((_page: unknown, _max?: number) => Promise.resolve('Page text content'))
}))

describe('BrowserExecutor', () => {
  let executor: BrowserExecutor
  const mockContext = { clientId: 'test-client', sessionId: 'test-session-1' }

  beforeEach(async () => {
    vi.clearAllMocks()
    fakePage.goto.mockResolvedValue(undefined)
    fakeSession.close.mockResolvedValue(undefined)
    const mod = await import('../../playwrightBrowserSession')
    ;(mod.getAccessibilitySnapshot as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ref: 0, role: 'button', name: 'Submit' }
    ])
    ;(mod.getPageText as ReturnType<typeof vi.fn>).mockResolvedValue('Page text content')
    executor = new BrowserExecutor()
  })

  afterEach(async () => {
    await executor.execute({ action: 'close' }, mockContext)
  })

  it('should proxy goto', async () => {
    const result = await executor.execute(
      { action: 'goto', url: 'https://example.com' },
      mockContext
    )
    expect(fakePage.goto).toHaveBeenCalledWith('https://example.com', expect.any(Object))
    expect(result).toBe('ok: navigated to https://example.com')
  })

  it('should proxy snapshot and return JSON', async () => {
    const result = await executor.execute(
      { action: 'snapshot' },
      { ...mockContext, sessionId: 'snap-session' }
    )
    const { getAccessibilitySnapshot } = await import('../../playwrightBrowserSession')
    expect(getAccessibilitySnapshot).toHaveBeenCalled()
    expect(JSON.parse(result)).toEqual([{ ref: 0, role: 'button', name: 'Submit' }])
  })

  it('should proxy click with ref', async () => {
    await executor.execute({ action: 'snapshot' }, mockContext)
    const result = await executor.execute({ action: 'click', ref: 0 }, mockContext)
    const { executeResolvedAct } = await import('../../playwrightBrowserSession')
    expect(executeResolvedAct).toHaveBeenCalledWith(
      fakePage,
      [{ ref: 0, role: 'button', name: 'Submit' }],
      { ref: 0, actionType: 'click' }
    )
    expect(result).toBe('ok: clicked ref 0')
  })

  it('should proxy fill with ref and value', async () => {
    await executor.execute({ action: 'snapshot' }, mockContext)
    const result = await executor.execute({ action: 'fill', ref: 0, value: 'hello' }, mockContext)
    expect(result).toBe('ok: filled ref 0')
  })

  it('should proxy select_option with ref and value', async () => {
    await executor.execute({ action: 'snapshot' }, mockContext)
    const result = await executor.execute(
      { action: 'select_option', ref: 0, value: 'opt1' },
      mockContext
    )
    expect(result).toBe('ok: selected ref 0 = opt1')
  })

  it('should proxy get_text', async () => {
    const result = await executor.execute({ action: 'get_text' }, mockContext)
    const { getPageText } = await import('../../playwrightBrowserSession')
    expect(getPageText).toHaveBeenCalled()
    expect(result).toBe('Page text content')
  })

  it('should reuse session for same session ID', async () => {
    const { connectPlaywrightBrowser } = await import('../../playwrightBrowserSession')
    await executor.execute({ action: 'goto', url: 'https://example.com' }, mockContext)
    await executor.execute({ action: 'goto', url: 'https://example.org' }, mockContext)
    expect(connectPlaywrightBrowser).toHaveBeenCalledTimes(1)
    expect(fakePage.goto).toHaveBeenCalledTimes(2)
  })

  it('should close session', async () => {
    await executor.execute({ action: 'goto', url: 'https://example.com' }, mockContext)
    const result = await executor.execute({ action: 'close' }, mockContext)
    expect(fakeSession.close).toHaveBeenCalled()
    expect(result).toBe('ok: browser session closed')
  })

  it('should require url for goto', async () => {
    const result = await executor.execute({ action: 'goto' }, mockContext)
    expect(result).toContain('error:')
    expect(result).toContain('url is required')
  })

  it('should require ref for click', async () => {
    await executor.execute({ action: 'snapshot' }, mockContext)
    const result = await executor.execute({ action: 'click' }, mockContext)
    expect(result).toContain('error:')
    expect(result).toContain('ref is required')
  })

  it('should return ok when close with no active session', async () => {
    const result = await executor.execute({ action: 'close' }, mockContext)
    expect(result).toBe('ok: no active session')
  })

  it('should reject unknown action', async () => {
    await executor.execute({ action: 'goto', url: 'https://example.com' }, mockContext)
    const result = await executor.execute({ action: 'invalid_action' as 'goto' }, mockContext)
    expect(result).toContain('error:')
    expect(result).toContain('Unknown browser action')
  })

  it('should expose toolName as prizm_browser', () => {
    expect(executor.toolName).toBe('prizm_browser')
  })
})
