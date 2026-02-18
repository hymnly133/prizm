/**
 * 工作区 (Scope) 管理 - 从文件夹添加、删除
 */
import { Button, Form, Input, Modal } from '@lobehub/ui'
import type { ListItemProps } from '@lobehub/ui'
import { AccentList } from './ui/AccentList'
import { useState, useCallback, useEffect } from 'react'
import { buildServerUrl } from '@prizm/client-core'
import { DEFAULT_SCOPE, ONLINE_SCOPE } from '@prizm/client-core'

interface ScopeDetail {
  path: string | null
  label: string
  builtin: boolean
}

interface ScopeManagementProps {
  http: {
    listScopesWithInfo(): Promise<{
      scopes: string[]
      descriptions: Record<string, { label: string; description: string }>
      scopeDetails?: Record<string, ScopeDetail>
    }>
    registerScope(payload: { id: string; path: string; label?: string }): Promise<unknown>
    unregisterScope(id: string): Promise<void>
  } | null
  onLog: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
}

export function ScopeManagement({ http, onLog }: ScopeManagementProps) {
  const [scopes, setScopes] = useState<string[]>([])
  const [scopeDetails, setScopeDetails] = useState<Record<string, ScopeDetail>>({})
  const [loading, setLoading] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addForm, setAddForm] = useState({ id: '', label: '', folderPath: '' })
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const { scopes: list, scopeDetails: details } = await http.listScopesWithInfo()
      setScopes(list ?? [])
      setScopeDetails(details ?? {})
    } catch (e) {
      onLog(`加载工作区列表失败: ${String(e)}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [http, onLog])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleSelectFolder() {
    try {
      const path = await window.prizm.selectFolder()
      if (path) setAddForm((f) => ({ ...f, folderPath: path }))
    } catch (e) {
      onLog(`选择文件夹失败: ${String(e)}`, 'error')
    }
  }

  async function handleAddScope() {
    if (!http) return
    const { id, label, folderPath } = addForm
    const trimmedId = id.trim()
    if (!trimmedId) {
      onLog('请输入工作区 ID', 'error')
      return
    }
    if (trimmedId === DEFAULT_SCOPE || trimmedId === ONLINE_SCOPE) {
      onLog('不能使用 default 或 online 作为自定义工作区 ID', 'error')
      return
    }
    if (!folderPath.trim()) {
      onLog('请选择文件夹', 'error')
      return
    }
    setAdding(true)
    try {
      await http.registerScope({
        id: trimmedId,
        path: folderPath.trim(),
        label: label.trim() || undefined
      })
      onLog(`已添加工作区: ${trimmedId}`, 'success')
      setAddModalOpen(false)
      setAddForm({ id: '', label: '', folderPath: '' })
      await refresh()
      window.dispatchEvent(new CustomEvent('prizm-scopes-changed'))
    } catch (e) {
      onLog(`添加工作区失败: ${String(e)}`, 'error')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(id: string) {
    if (!http) return
    const detail = scopeDetails[id]
    if (detail?.builtin) {
      onLog('内置工作区不可删除', 'error')
      return
    }
    try {
      await http.unregisterScope(id)
      onLog(`已移除工作区: ${id}`, 'success')
      await refresh()
      window.dispatchEvent(new CustomEvent('prizm-scopes-changed'))
    } catch (e) {
      onLog(`移除工作区失败: ${String(e)}`, 'error')
    }
  }

  if (!http) return null

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>工作区管理</h2>
        <p className="form-hint">
          添加文件夹作为工作区，或移除自定义工作区（内置 default、online 不可删除）
        </p>
      </div>
      <div className="scope-list">
        {loading ? (
          <div className="scope-list-placeholder">加载中...</div>
        ) : scopes.length === 0 ? (
          <div className="scope-list-placeholder">暂无工作区</div>
        ) : (
          <AccentList
            items={scopes.map((id) => {
              const detail = scopeDetails[id]
              const builtin = detail?.builtin ?? (id === DEFAULT_SCOPE || id === ONLINE_SCOPE)
              const item: ListItemProps = {
                key: id,
                title: (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {detail?.label ?? id}
                    {builtin && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: 'var(--ant-color-primary-bg)',
                          color: 'var(--ant-color-primary)'
                        }}
                      >
                        内置
                      </span>
                    )}
                  </span>
                ),
                description: detail?.path || undefined,
                actions: !builtin ? (
                  <Button size="small" type="text" danger onClick={() => handleRemove(id)}>
                    移除
                  </Button>
                ) : undefined,
                showAction: !builtin
              }
              return item
            })}
          />
        )}
      </div>
      <div className="config-actions" style={{ marginTop: 8 }}>
        <Button onClick={() => setAddModalOpen(true)}>从文件夹添加工作区</Button>
      </div>

      <Modal
        open={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        title="添加工作区"
        footer={null}
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="工作区 ID" required>
            <Input
              value={addForm.id}
              onChange={(e) => setAddForm((f) => ({ ...f, id: e.target.value }))}
              placeholder="例如: my-project"
            />
          </Form.Item>
          <Form.Item label="显示名称">
            <Input
              value={addForm.label}
              onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="可选"
            />
          </Form.Item>
          <Form.Item label="文件夹路径" required>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={addForm.folderPath}
                readOnly
                placeholder="点击选择文件夹"
                style={{ flex: 1 }}
              />
              <Button onClick={handleSelectFolder}>选择</Button>
            </div>
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={handleAddScope} loading={adding}>
              添加
            </Button>
            <Button onClick={() => setAddModalOpen(false)} style={{ marginLeft: 8 }}>
              取消
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
