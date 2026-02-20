/**
 * Lightweight hash-based routing for Electron.
 * Syncs activePage state with window.location.hash for deep linking
 * and browser-like back/forward navigation.
 *
 * 优化：使用 ref 读取 activePage，hashchange 监听器只注册一次。
 */
import { useEffect, useRef } from 'react'

type PageKey = 'home' | 'work' | 'docs' | 'agent' | 'workflow' | 'settings' | 'test'

const VALID_PAGES = new Set<string>(['home', 'work', 'docs', 'agent', 'workflow', 'settings', 'test'])

const PAGE_ALIASES: Record<string, PageKey> = {
  user: 'home',
  collaboration: 'agent',
  collab: 'agent',
  schedule: 'work'
}

function parseHash(): PageKey {
  const hash = window.location.hash.replace('#/', '').replace('#', '')
  const page = hash.split('/')[0]
  if (PAGE_ALIASES[page]) return PAGE_ALIASES[page]
  if (VALID_PAGES.has(page)) return page as PageKey
  return 'home'
}

function setHash(page: PageKey) {
  const newHash = `#/${page}`
  if (window.location.hash !== newHash) {
    window.location.hash = newHash
  }
}

/**
 * Syncs the active page with the URL hash.
 * @param activePage - current page
 * @param setActivePage - setter to update page from hash changes
 */
export function useHashRoute(activePage: PageKey, setActivePage: (page: PageKey) => void) {
  const ignoreNextHash = useRef(false)
  const activePageRef = useRef(activePage)
  activePageRef.current = activePage

  useEffect(() => {
    const initial = parseHash()
    if (initial !== activePage) {
      setActivePage(initial)
    } else {
      setHash(activePage)
    }
  }, [])

  useEffect(() => {
    if (ignoreNextHash.current) {
      ignoreNextHash.current = false
      return
    }
    setHash(activePage)
  }, [activePage])

  /** 只注册一次 hashchange 监听器，通过 ref 读取最新 activePage */
  useEffect(() => {
    function onHashChange() {
      const page = parseHash()
      if (page !== activePageRef.current) {
        ignoreNextHash.current = true
        setActivePage(page)
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [setActivePage])
}
