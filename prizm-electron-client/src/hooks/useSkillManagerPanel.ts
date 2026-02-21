/**
 * useSkillManagerPanel — 会话内 Skill / MCP 管理（仅用 allowedSkills 全链路去重）
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from '@lobehub/ui'
import { usePrizmContext } from '../context/PrizmContext'
import { useAgentSessionStore } from '../store/agentSessionStore'

export interface SkillMeta {
  name: string
  description: string
  enabled: boolean
  source?: string
}

export interface McpServerItem {
  id: string
  name: string
}

export interface UseSkillManagerPanelOptions {
  sessionId: string
  scope: string
}

export interface UseSkillManagerPanelResult {
  allSkills: SkillMeta[]
  mcpServers: McpServerItem[]
  allowedSkills: string[]
  allowedMcpServerIds: string[]
  loading: boolean
  saving: boolean
  hasSession: boolean
  setAllowedSkills: (v: string[] | ((prev: string[]) => string[])) => void
  setAllowedMcpServerIds: (v: string[] | ((prev: string[]) => string[])) => void
  toggleSkillAllowed: (name: string, nowAllowed: boolean) => void
  toggleMcpAllowed: (id: string, nowAllowed: boolean) => void
  saveAllowlists: () => Promise<void>
  refetch: () => Promise<void>
}

export function useSkillManagerPanel({
  sessionId,
  scope
}: UseSkillManagerPanelOptions): UseSkillManagerPanelResult {
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient() ?? null

  const session = useAgentSessionStore((s) =>
    sessionId ? s.sessions.find((x) => x.id === sessionId) : undefined
  )

  const [allSkills, setAllSkills] = useState<SkillMeta[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([])
  const [allowedSkills, setAllowedSkills] = useState<string[]>([])
  const [allowedMcpServerIds, setAllowedMcpServerIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const hasSession = !!sessionId

  const loadData = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const skillsData = await http.listSkills()
      setAllSkills((skillsData.skills as SkillMeta[]) ?? [])
    } catch {
      toast.error('加载 Skills 列表失败，请检查服务连接')
    } finally {
      setLoading(false)
    }
  }, [http])

  const loadMcpServers = useCallback(async () => {
    if (!http) return
    try {
      const list = await http.listMcpServers()
      setMcpServers(list.map((s) => ({ id: s.id, name: s.name })))
    } catch {
      setMcpServers([])
    }
  }, [http])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    setAllowedSkills(session?.allowedSkills ?? [])
    setAllowedMcpServerIds(session?.allowedMcpServerIds ?? [])
  }, [session?.id, session?.allowedSkills, session?.allowedMcpServerIds])

  useEffect(() => {
    loadMcpServers()
  }, [loadMcpServers])

  const refetch = useCallback(async () => {
    await loadData()
    await loadMcpServers()
  }, [loadData, loadMcpServers])

  const toggleSkillAllowed = useCallback(
    (name: string, nowAllowed: boolean) => {
      setAllowedSkills((prev) => {
        if (nowAllowed) {
          const next = [...prev, name]
          return next.length === allSkills.length ? [] : next
        }
        return prev.length === 0
          ? allSkills.map((x) => x.name).filter((x) => x !== name)
          : prev.filter((x) => x !== name)
      })
    },
    [allSkills.length, allSkills]
  )

  const toggleMcpAllowed = useCallback(
    (id: string, nowAllowed: boolean) => {
      setAllowedMcpServerIds((prev) => {
        if (nowAllowed) {
          const next = [...prev, id]
          return next.length === mcpServers.length ? [] : next
        }
        return prev.length === 0
          ? mcpServers.map((x) => x.id).filter((x) => x !== id)
          : prev.filter((x) => x !== id)
      })
    },
    [mcpServers]
  )

  const saveAllowlists = useCallback(async () => {
    const updateSession = useAgentSessionStore.getState().updateSession
    if (!sessionId || !scope) return
    setSaving(true)
    try {
      await updateSession(sessionId, { allowedSkills, allowedMcpServerIds }, scope)
      toast.success('已保存到当前会话')
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }, [sessionId, scope, allowedSkills, allowedMcpServerIds])

  return {
    allSkills,
    mcpServers,
    allowedSkills,
    allowedMcpServerIds,
    loading,
    saving,
    hasSession,
    setAllowedSkills,
    setAllowedMcpServerIds,
    toggleSkillAllowed,
    toggleMcpAllowed,
    saveAllowlists,
    refetch
  }
}
