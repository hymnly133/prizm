/**
 * ScopeSwitcher — 全局工作区选择器 + 就地创建
 *
 * 放置在标题栏 logo 右侧，提供 scope 快速切换和新建工作区入口。
 */
import { useState, useCallback, useMemo } from 'react'
import { Select } from 'antd'
import { Button, Form, Input, Modal, Icon, toast } from '@lobehub/ui'
import { FolderOpen, Plus } from 'lucide-react'
import { createStyles } from 'antd-style'
import { useScopeContext } from '../../context/ScopeContext'
import { DEFAULT_SCOPE, ONLINE_SCOPE } from '@prizm/client-core'

const useStyles = createStyles(({ css, token }) => ({
  wrapper: css`
    display: flex;
    align-items: center;
    gap: 4px;
  `,
  select: css`
    min-width: 130px;
    max-width: 200px;
    .ant-select-selector {
      border-radius: 6px !important;
      height: 26px !important;
      font-size: 12px;
    }
    .ant-select-selection-item {
      line-height: 24px !important;
    }
  `,
  optionLabel: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  `,
  builtinTag: css`
    font-size: 10px;
    padding: 0 4px;
    border-radius: 3px;
    background: ${token.colorPrimaryBg};
    color: ${token.colorPrimary};
    line-height: 16px;
  `,
  addOption: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: ${token.colorPrimary};
    font-size: 12px;
  `,
  folderRow: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  folderInput: css`
    flex: 1;
  `,
  folderPath: css`
    font-size: 11px;
    color: ${token.colorTextSecondary};
    margin-top: 4px;
    word-break: break-all;
  `
}))

const ADD_SCOPE_VALUE = '__add_scope__'

export default function ScopeSwitcher() {
  const {
    currentScope,
    scopes,
    scopeDetails,
    scopesLoading,
    getScopeLabel,
    setScope,
    createScope
  } = useScopeContext()

  const { styles } = useStyles()
  const [modalOpen, setModalOpen] = useState(false)
  const [folderPath, setFolderPath] = useState('')
  const [scopeId, setScopeId] = useState('')
  const [scopeLabel, setScopeLabel] = useState('')
  const [creating, setCreating] = useState(false)

  const selectOptions = useMemo(() => {
    const items = scopes.map((id) => {
      const detail = scopeDetails[id]
      const isBuiltin = detail?.builtin ?? (id === DEFAULT_SCOPE || id === ONLINE_SCOPE)
      return {
        value: id,
        label: (
          <span className={styles.optionLabel}>
            {detail?.label || getScopeLabel(id)}
            {isBuiltin && <span className={styles.builtinTag}>内置</span>}
          </span>
        )
      }
    })
    items.push({
      value: ADD_SCOPE_VALUE,
      label: (
        <span className={styles.addOption}>
          <Icon icon={Plus} size={12} />
          添加工作区…
        </span>
      )
    })
    return items
  }, [scopes, scopeDetails, getScopeLabel, styles])

  const handleChange = useCallback(
    (value: string) => {
      if (value === ADD_SCOPE_VALUE) {
        setModalOpen(true)
        return
      }
      setScope(value)
    },
    [setScope]
  )

  function deriveFromPath(path: string) {
    const name = path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
    const derivedId = name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    setScopeId(derivedId || '')
    setScopeLabel(name || '')
  }

  async function handleSelectFolder() {
    try {
      const path = await window.prizm.selectFolder()
      if (path) {
        setFolderPath(path)
        deriveFromPath(path)
      }
    } catch {
      toast.error('选择文件夹失败')
    }
  }

  function resetModal() {
    setFolderPath('')
    setScopeId('')
    setScopeLabel('')
    setCreating(false)
  }

  async function handleCreate() {
    if (!folderPath.trim()) {
      toast.error('请先选择文件夹')
      return
    }
    const trimmedId = scopeId.trim()
    if (!trimmedId) {
      toast.error('工作区 ID 不能为空')
      return
    }
    if (trimmedId === DEFAULT_SCOPE || trimmedId === ONLINE_SCOPE) {
      toast.error('不能使用内置工作区 ID')
      return
    }
    if (scopes.includes(trimmedId)) {
      toast.error('该工作区 ID 已存在')
      return
    }

    setCreating(true)
    const ok = await createScope(folderPath.trim(), trimmedId, scopeLabel.trim() || undefined)
    setCreating(false)
    if (ok) {
      toast.success(`已创建工作区: ${scopeLabel.trim() || trimmedId}`)
      setModalOpen(false)
      resetModal()
    } else {
      toast.error('创建工作区失败')
    }
  }

  return (
    <div className={styles.wrapper}>
      <Icon icon={FolderOpen} size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
      <Select
        size="small"
        className={styles.select}
        value={currentScope}
        loading={scopesLoading}
        options={selectOptions}
        onChange={handleChange}
        popupMatchSelectWidth={false}
        variant="borderless"
      />

      <Modal
        open={modalOpen}
        onCancel={() => { setModalOpen(false); resetModal() }}
        title="添加工作区"
        footer={null}
        width={460}
        mask={{ closable: true }}
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="文件夹" required>
            <div className={styles.folderRow}>
              <Input
                className={styles.folderInput}
                value={folderPath}
                readOnly
                placeholder="点击选择文件夹"
              />
              <Button onClick={handleSelectFolder} icon={<Icon icon={FolderOpen} size={14} />}>
                选择
              </Button>
            </div>
            {folderPath && <div className={styles.folderPath}>{folderPath}</div>}
          </Form.Item>
          <Form.Item label="工作区 ID" required>
            <Input
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder="自动从文件夹名生成"
            />
          </Form.Item>
          <Form.Item label="显示名称">
            <Input
              value={scopeLabel}
              onChange={(e) => setScopeLabel(e.target.value)}
              placeholder="可选，默认使用文件夹名"
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={handleCreate} loading={creating}>
              创建并切换
            </Button>
            <Button
              onClick={() => { setModalOpen(false); resetModal() }}
              style={{ marginLeft: 8 }}
            >
              取消
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
