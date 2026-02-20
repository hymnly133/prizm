/**
 * useWorkflowPageState — 工作流页面内部导航/选择状态管理
 *
 * 管理定义选中、运行选中、Tab 切换、搜索等 UI 状态。
 * 采用 useReducer 避免多 useState 导致的批量更新问题。
 */
import { useReducer, useCallback, useMemo } from 'react'

export type WorkflowPageTab = 'overview' | 'runs' | 'editor' | 'workspace' | 'yaml'

export interface WorkflowPageState {
  selectedDefId: string | null
  selectedRunId: string | null
  activeTab: WorkflowPageTab
  searchQuery: string
  statusFilter: string | null
}

type Action =
  | { type: 'SELECT_DEF'; defId: string }
  | { type: 'SELECT_RUN'; runId: string }
  | { type: 'GO_BACK' }
  | { type: 'SET_TAB'; tab: WorkflowPageTab }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'SET_STATUS_FILTER'; filter: string | null }
  | { type: 'CLEAR_SELECTION' }

function reducer(state: WorkflowPageState, action: Action): WorkflowPageState {
  switch (action.type) {
    case 'SELECT_DEF':
      return {
        ...state,
        selectedDefId: action.defId,
        selectedRunId: null,
        activeTab: 'overview'
      }
    case 'SELECT_RUN':
      return {
        ...state,
        selectedRunId: action.runId
      }
    case 'GO_BACK':
      if (state.selectedRunId) {
        return { ...state, selectedRunId: null, activeTab: 'runs' }
      }
      return { ...state, selectedDefId: null, selectedRunId: null, activeTab: 'overview' }
    case 'SET_TAB':
      return { ...state, activeTab: action.tab }
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query }
    case 'SET_STATUS_FILTER':
      return { ...state, statusFilter: action.filter }
    case 'CLEAR_SELECTION':
      return { ...state, selectedDefId: null, selectedRunId: null, activeTab: 'overview' }
    default:
      return state
  }
}

const initialState: WorkflowPageState = {
  selectedDefId: null,
  selectedRunId: null,
  activeTab: 'overview',
  searchQuery: '',
  statusFilter: null
}

export function useWorkflowPageState() {
  const [state, dispatch] = useReducer(reducer, initialState)

  const selectDef = useCallback((defId: string) => dispatch({ type: 'SELECT_DEF', defId }), [])
  const selectRun = useCallback((runId: string) => dispatch({ type: 'SELECT_RUN', runId }), [])
  const goBack = useCallback(() => dispatch({ type: 'GO_BACK' }), [])
  const setTab = useCallback((tab: WorkflowPageTab) => dispatch({ type: 'SET_TAB', tab }), [])
  const setSearch = useCallback((query: string) => dispatch({ type: 'SET_SEARCH', query }), [])
  const setStatusFilter = useCallback(
    (filter: string | null) => dispatch({ type: 'SET_STATUS_FILTER', filter }),
    []
  )
  const clearSelection = useCallback(() => dispatch({ type: 'CLEAR_SELECTION' }), [])

  /** 当前视图模式 */
  const viewMode = useMemo<'overview' | 'def-detail' | 'run-detail'>(() => {
    if (state.selectedRunId) return 'run-detail'
    if (state.selectedDefId) return 'def-detail'
    return 'overview'
  }, [state.selectedDefId, state.selectedRunId])

  return {
    ...state,
    viewMode,
    selectDef,
    selectRun,
    goBack,
    setTab,
    setSearch,
    setStatusFilter,
    clearSelection
  }
}

export type WorkflowPageActions = ReturnType<typeof useWorkflowPageState>
