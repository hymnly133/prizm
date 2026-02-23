/**
 * Playwright 浏览器会话：经 CDP（relay）连接客户端浏览器。
 * 提供快照、按 ref 执行 click/fill/select、取整页文本，供 browserTools 直接代理。
 */

import { chromium } from 'playwright'
import type { Page, Browser } from 'playwright'

export interface PlaywrightBrowserSession {
  page: Page
  close(): Promise<void>
}

const CONNECT_TIMEOUT_MS = 35_000

/** 与 getAccessibilitySnapshot 中使用的选择器一致，用于按 ref 定位元素 */
export const INTERACTIVE_ELEMENTS_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [onclick]'

/**
 * 通过 CDP URL（Prizm relay）连接已有浏览器，返回 page 与 close。
 */
export async function connectPlaywrightBrowser(
  cdpUrl: string,
  options?: { timeoutMs?: number }
): Promise<PlaywrightBrowserSession> {
  const timeoutMs = options?.timeoutMs ?? CONNECT_TIMEOUT_MS
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: timeoutMs })
  const contexts = browser.contexts()
  const context = contexts[0]
  if (!context) {
    await browser.close()
    throw new Error('Browser has no context after CDP connect')
  }
  const pages = context.pages()
  const page = pages[0]
  if (!page) {
    await browser.close()
    throw new Error('Browser context has no page after CDP connect')
  }
  return {
    page,
    async close() {
      await browser.close()
    }
  }
}

/** 快照中的可操作元素项（无 selector，定位用 INTERACTIVE_ELEMENTS_SELECTOR + ref 索引） */
export interface SnapshotElement {
  ref: number
  role: string
  name: string
}

const OBSERVE_MAX = 80

/**
 * 获取当前页面的可访问性风格快照：可点击/可填写的元素列表，按文档顺序带 ref。
 */
export async function getAccessibilitySnapshot(page: Page): Promise<SnapshotElement[]> {
  const raw = await page.evaluate((max) => {
    function getRole(el: Element): string {
      const role = el.getAttribute('role')?.trim()
      if (role) return role.toLowerCase()
      const tag = (el.tagName || '').toLowerCase()
      if (tag === 'a') return 'link'
      if (tag === 'button') return 'button'
      if (tag === 'input') {
        const t = (el as HTMLInputElement).type?.toLowerCase()
        if (t === 'submit' || t === 'button') return 'button'
        if (t === 'search') return 'searchbox'
        return 'textbox'
      }
      if (tag === 'select') return 'listbox'
      if (tag === 'textarea') return 'textbox'
      return 'generic'
    }
    function getName(el: Element): string {
      const ariaLabel = el.getAttribute('aria-label')?.trim()
      if (ariaLabel) return ariaLabel
      const ariaLabelledBy = el.getAttribute('aria-labelledby')?.trim()
      if (ariaLabelledBy) {
        const first = document.getElementById(ariaLabelledBy.split(/\s+/)[0])
        if (first?.textContent) return first.textContent.trim().slice(0, 200)
      }
      if (el instanceof HTMLInputElement && el.placeholder) return el.placeholder
      if (el instanceof HTMLButtonElement && el.textContent)
        return el.textContent.trim().slice(0, 200)
      if (el.textContent) return el.textContent.trim().slice(0, 200)
      return ''
    }
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [onclick]'
    const nodes = document.querySelectorAll(selector)
    const result: Array<{ ref: number; role: string; name: string }> = []
    for (let i = 0; i < Math.min(nodes.length, max); i++) {
      const el = nodes[i]
      if (!el || !(el instanceof Element)) continue
      result.push({ ref: i, role: getRole(el), name: getName(el) })
    }
    return result
  }, OBSERVE_MAX)
  return raw as SnapshotElement[]
}

/** act 解析结果：由 LLM 根据 instruction + snapshot 产出 */
export interface ResolvedAct {
  ref: number
  actionType: 'click' | 'type' | 'select'
  value?: string
}

/**
 * 根据快照与解析结果执行一次操作（按 ref 用 INTERACTIVE_ELEMENTS_SELECTOR 定位）。
 */
export async function executeResolvedAct(
  page: Page,
  snapshot: SnapshotElement[],
  resolved: ResolvedAct
): Promise<void> {
  const { ref, actionType, value } = resolved
  if (ref < 0 || ref >= snapshot.length) {
    throw new Error(`Invalid ref: ${ref}. Snapshot has ${snapshot.length} elements.`)
  }
  const locator = page.locator(INTERACTIVE_ELEMENTS_SELECTOR).nth(ref)
  switch (actionType) {
    case 'click':
      await locator.click()
      break
    case 'type':
      if (value !== undefined) await locator.fill(value)
      break
    case 'select':
      if (value !== undefined) await locator.selectOption(value)
      break
    default:
      throw new Error(`Unknown actionType: ${actionType}`)
  }
}

/**
 * 获取整页可见文本（用于 extract 无参或兜底）。
 */
export async function getPageText(page: Page, maxChars: number = 30_000): Promise<string> {
  const text = await page.evaluate(() => {
    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').trim()
      if (node.nodeType !== Node.ELEMENT_NODE) return ''
      const el = node as Element
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return ''
      let out = ''
      for (const child of Array.from(node.childNodes)) out += walk(child)
      const tag = el.tagName
      if (['P', 'DIV', 'BR', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) {
        if (out && !out.endsWith('\n')) out += '\n'
      }
      return out
    }
    return walk(document.body)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  })
  return text.length > maxChars ? text.slice(0, maxChars) + '...(truncated)' : text
}
