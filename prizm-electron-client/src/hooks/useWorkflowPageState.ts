/**
 * useWorkflowPageState — 工作流页面内部导航/选择状态管理
 *
 * 管理定义选中、运行选中、Tab 切换、搜索等 UI 状态。
 * 采用 useReducer 避免多 useState 导致的批量更新问题。
 */
import { useReducer, useCallback, useMemo } from 'react'

export type WorkflowPageTab = 'overview' | 'runs' | 'workspace' | 'yaml'

export interface PendingInitialRunRef {
  runId: string
  label: string
}

export interface WorkflowPageState {
  selectedDefId: string | null
  selectedRunId: string | null
  /** 选中的工作流管理会话 ID（主区展示该会话聊天） */
  selectedManagementSessionId: string | null
  activeTab: WorkflowPageTab
  searchQuery: string
  /** 打开管理会话时预填的 run 引用（用于「在管理会话中打开此次 run」） */
  pendingInitialRunRef: PendingInitialRunRef | null
}

type Action =
  | { type: 'SELECT_DEF'; defId: string; sessionId?: string | null }
  | { type: 'SELECT_RUN'; runId: string }
  | { type: 'SELECT_MANAGEMENT_SESSION'; sessionId: string | null; defId?: string | null }
  | { type: 'GO_BACK' }
  | { type: 'SET_TAB'; tab: WorkflowPageTab }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_PENDING_INITIAL_RUN_REF'; payload: PendingInitialRunRef | null }
  | { type: 'CLEAR_PENDING_INITIAL_RUN_REF' }

function reducer(state: WorkflowPageState, action: Action): WorkflowPageState {
  switch (action.type) {
    case 'SELECT_DEF': {
      const wasInDefDetail = state.selectedDefId != null
      return {
        ...state,
        selectedDefId: action.defId,
        selectedRunId: null,
        selectedManagementSessionId: action.sessionId || null,
        // 从总览进入定义时切到 overview；侧栏切换不同工作流时保留当前 tab，避免重复播 tab 动画导致卡顿
        activeTab: wasInDefDetail ? state.activeTab : 'overview'
      }
    }
    case 'SELECT_RUN':
      return {
        ...state,
        selectedRunId: action.runId
      }
    case 'SELECT_MANAGEMENT_SESSION':
      // 当 defId 传 null（如对话创建）时，仅 session 选中，独占主区
      return {
        ...state,
        selectedManagementSessionId: action.sessionId,
        selectedRunId: null,
        selectedDefId: action.defId !== undefined ? action.defId || null : state.selectedDefId
      }
    case 'GO_BACK':
      if (state.selectedRunId) {
        return { ...state, selectedRunId: null, activeTab: 'runs' }
      }
      if (state.selectedManagementSessionId && !state.selectedDefId) {
        // if only session is open (pending session), close it
        return { ...state, selectedManagementSessionId: null }
      }
      return { ...state, selectedDefId: null, selectedRunId: null, activeTab: 'overview' }
    case 'SET_TAB':
      return { ...state, activeTab: action.tab }
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query }
    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedDefId: null,
        selectedRunId: null,
        selectedManagementSessionId: null,
        activeTab: 'overview',
        pendingInitialRunRef: null
      }
    case 'SET_PENDING_INITIAL_RUN_REF':
      return { ...state, pendingInitialRunRef: action.payload }
    case 'CLEAR_PENDING_INITIAL_RUN_REF':
      return { ...state, pendingInitialRunRef: null }
    default:
      return state
  }
}

const initialState: WorkflowPageState = {
  selectedDefId: null,
  selectedRunId: null,
  selectedManagementSessionId: null,
  activeTab: 'overview',
  searchQuery: '',
  pendingInitialRunRef: null
}

export function useWorkflowPageState() {
  const [state, dispatch] = useReducer(reducer, initialState)

  const selectDef = useCallback(
    (defId: string, sessionId?: string | null) =>
      dispatch({ type: 'SELECT_DEF', defId, sessionId }),
    []
  )
  const selectRun = useCallback((runId: string) => dispatch({ type: 'SELECT_RUN', runId }), [])
  const setPendingInitialRunRef = useCallback(
    (payload: PendingInitialRunRef | null) =>
      dispatch({ type: 'SET_PENDING_INITIAL_RUN_REF', payload }),
    []
  )
  const clearPendingInitialRunRef = useCallback(
    () => dispatch({ type: 'CLEAR_PENDING_INITIAL_RUN_REF' }),
    []
  )
  const selectManagementSession = useCallback(
    (sessionId: string | null, defId?: string | null) =>
      dispatch({ type: 'SELECT_MANAGEMENT_SESSION', sessionId, defId }),
    []
  )
  const goBack = useCallback(() => dispatch({ type: 'GO_BACK' }), [])
  const setTab = useCallback((tab: WorkflowPageTab) => dispatch({ type: 'SET_TAB', tab }), [])
  const setSearch = useCallback((query: string) => dispatch({ type: 'SET_SEARCH', query }), [])
  const clearSelection = useCallback(() => dispatch({ type: 'CLEAR_SELECTION' }), [])

  /** 当前视图模式（仅针对左侧主内容区） */
  const viewMode = useMemo<'overview' | 'def-detail' | 'run-detail' | 'management-session'>(() => {
    if (state.selectedRunId) return 'run-detail'
    if (state.selectedDefId) return 'def-detail'
    if (state.selectedManagementSessionId) return 'management-session'
    return 'overview'
  }, [state.selectedDefId, state.selectedRunId, state.selectedManagementSessionId])

  return {
    ...state,
    viewMode,
    selectDef,
    selectRun,
    selectManagementSession,
    setPendingInitialRunRef,
    clearPendingInitialRunRef,
    goBack,
    setTab,
    setSearch,
    clearSelection
  }
}

export type WorkflowPageActions = ReturnType<typeof useWorkflowPageState>
