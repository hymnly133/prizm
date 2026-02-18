/**
 * HeaderSlotsContext - 标题栏自定义插槽
 *
 * 允许各页面通过 useRegisterHeaderSlots 向全局标题栏注入自定义内容。
 * 基于 pageKey 隔离：同时挂载的多个页面各自注册自己的插槽，
 * AppHeader 只渲染当前活跃页面对应的插槽。
 *
 * 性能优化：
 * - 拆分为两个 Context（dispatch + state），注册方不因 state 变化重渲染
 * - activePage 通过 prop 传入，避免 effect 同步导致的双重渲染
 * - register 幂等：引用相同时跳过 setState
 * - Provider value 全部 useMemo
 */
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

export interface HeaderSlots {
  /** 标题栏左侧区域（logo 右侧） */
  left?: ReactNode
  /** 标题栏右侧区域（设置按钮左侧） */
  right?: ReactNode
}

/* ── Dispatch Context: register/unregister（永远不变，注册方不因 state 变化重渲染） ── */

interface DispatchContextValue {
  register: (pageKey: string, slots: HeaderSlots) => void
  unregister: (pageKey: string) => void
}

const DispatchContext = createContext<DispatchContextValue>({
  register: () => {},
  unregister: () => {}
})

/* ── State Context: slotsMap + activePage（仅 AppHeader 等读取方订阅） ── */

interface StateContextValue {
  slotsMap: Record<string, HeaderSlots>
  activePage: string
}

const StateContext = createContext<StateContextValue>({
  slotsMap: {},
  activePage: ''
})

/* ── Provider ── */

export interface HeaderSlotsProviderProps {
  children: ReactNode
  activePage: string
}

export function HeaderSlotsProvider({ children, activePage }: HeaderSlotsProviderProps) {
  const [slotsMap, setSlotsMap] = useState<Record<string, HeaderSlots>>({})

  /** 幂等 register：只在 slots 引用变化时更新 state */
  const slotsRef = useRef<Record<string, HeaderSlots>>({})
  const register = useCallback((pageKey: string, slots: HeaderSlots) => {
    if (slotsRef.current[pageKey] === slots) return
    slotsRef.current[pageKey] = slots
    setSlotsMap((prev) => ({ ...prev, [pageKey]: slots }))
  }, [])

  const unregister = useCallback((pageKey: string) => {
    delete slotsRef.current[pageKey]
    setSlotsMap((prev) => {
      if (!(pageKey in prev)) return prev
      const next = { ...prev }
      delete next[pageKey]
      return next
    })
  }, [])

  const dispatchValue = useMemo(() => ({ register, unregister }), [register, unregister])
  const stateValue = useMemo(() => ({ slotsMap, activePage }), [slotsMap, activePage])

  return (
    <DispatchContext.Provider value={dispatchValue}>
      <StateContext.Provider value={stateValue}>{children}</StateContext.Provider>
    </DispatchContext.Provider>
  )
}

/** 获取当前活跃页面的标题栏插槽（仅 AppHeader 使用） */
export function useActiveHeaderSlots(): HeaderSlots {
  const { slotsMap, activePage } = useContext(StateContext)
  return slotsMap[activePage] ?? EMPTY_SLOTS
}

const EMPTY_SLOTS: HeaderSlots = {}

/**
 * 注册标题栏插槽 — 组件卸载时自动清理
 * 仅订阅 DispatchContext，不因 slotsMap/activePage 变化而重渲染
 * @param pageKey 页面标识（需与 App.tsx 的 activePage 一致）
 * @param slots 要渲染的左右内容（需外部 useMemo 稳定引用以避免无限循环）
 */
export function useRegisterHeaderSlots(pageKey: string, slots: HeaderSlots) {
  const { register, unregister } = useContext(DispatchContext)

  useEffect(() => {
    register(pageKey, slots)
  }, [pageKey, slots, register])

  useEffect(() => {
    return () => unregister(pageKey)
  }, [pageKey, unregister])
}
