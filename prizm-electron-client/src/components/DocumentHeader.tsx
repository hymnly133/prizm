/**
 * DocumentHeader - Notion 风格内联标题区
 * 大字号标题编辑 + 轻量标签 + 浮动操作按钮
 */
import { useCallback } from 'react'
import { Dropdown, type MenuProps } from 'antd'
import { ActionIcon, Flexbox, Tooltip } from '@lobehub/ui'
import { createStyles } from 'antd-style'
import { Save, Trash2, MoreHorizontal, History, Download, Lock, ExternalLink } from 'lucide-react'
import TagSelector from './ui/TagSelector'
import { useDocumentDetailSafe } from '../context/DocumentDetailContext'
import type { ResourceLockInfo } from '@prizm/client-core'

const useStyles = createStyles(({ css, token }) => ({
  wrapper: css`
    position: relative;
    padding: 32px 0 8px;
    flex-shrink: 0;
  `,
  titleInput: css`
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-size: 30px;
    font-weight: 700;
    line-height: 1.3;
    color: ${token.colorText};
    padding: 0;
    resize: none;
    font-family: inherit;

    &::placeholder {
      color: ${token.colorTextQuaternary};
    }

    &:focus {
      outline: none;
    }
  `,
  metaRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    min-height: 28px;
  `,
  tagArea: css`
    flex: 1;
    min-width: 0;
    max-width: 360px;
  `,
  time: css`
    font-size: 12px;
    color: ${token.colorTextQuaternary};
    white-space: nowrap;
    flex-shrink: 0;
  `,
  actions: css`
    position: absolute;
    top: 8px;
    right: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0.5;
    transition: opacity 0.15s;

    &:hover {
      opacity: 1;
    }
  `,
  lockBadge: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: ${token.borderRadius}px;
    background: ${token.colorWarningBg};
    border: 1px solid ${token.colorWarningBorder};
    color: ${token.colorWarningText};
    font-size: 11px;
    white-space: nowrap;
  `,
  lockSession: css`
    cursor: pointer;
    color: ${token.colorPrimary};
    font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
    font-size: 11px;

    &:hover {
      text-decoration: underline;
    }
  `,
  saveBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid ${token.colorBorder};
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      border-color: ${token.colorPrimary};
      color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }

    &:disabled {
      opacity: 0.4;
      cursor: default;
      &:hover {
        border-color: ${token.colorBorder};
        color: ${token.colorTextSecondary};
        background: transparent;
      }
    }
  `,
  saveBtnActive: css`
    border-color: ${token.colorPrimary};
    color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};

    &:hover {
      background: ${token.colorPrimaryBgHover};
    }
  `
}))

interface DocumentHeaderProps {
  title?: string
  tags?: string[]
  content?: string
  updatedAt?: number
  dirty?: boolean
  saving?: boolean
  onTitleChange?: (title: string) => void
  onTagsChange?: (tags: string[]) => void
  onSave?: () => void
  onDelete?: () => void
  onShowVersions?: () => void
  lockInfo?: ResourceLockInfo | null
  onNavigateToSession?: (sessionId: string) => void
  onForceRelease?: () => void
}

const NOOP = () => {}

export default function DocumentHeader(props: DocumentHeaderProps) {
  const ctx = useDocumentDetailSafe()

  const title = props.title ?? ctx?.title ?? ''
  const tags = props.tags ?? ctx?.tags ?? []
  const content = props.content ?? ctx?.content ?? ''
  const updatedAt = props.updatedAt ?? ctx?.document?.updatedAt
  const dirty = props.dirty ?? ctx?.dirty ?? false
  const saving = props.saving ?? ctx?.saving ?? false
  const onTitleChange = props.onTitleChange ?? ctx?.setTitle ?? NOOP
  const onTagsChange = props.onTagsChange ?? ctx?.setTags ?? NOOP
  const onSave =
    props.onSave ??
    (ctx
      ? async () => {
          await ctx.save()
        }
      : NOOP)
  const onDelete = props.onDelete ?? NOOP
  const onShowVersions = props.onShowVersions ?? ctx?.showVersions
  const lockInfo = props.lockInfo !== undefined ? props.lockInfo : ctx?.lockInfo ?? null
  const onNavigateToSession = props.onNavigateToSession ?? ctx?.navigateToSession
  const onForceRelease = props.onForceRelease ?? ctx?.forceReleaseLock
  const { styles, cx } = useStyles()

  const menuItems: MenuProps['items'] = [
    ...(onShowVersions
      ? [{ key: 'versions', icon: <History size={14} />, label: '版本历史' }]
      : []),
    { key: 'export', icon: <Download size={14} />, label: '导出 Markdown' },
    { type: 'divider' as const },
    { key: 'delete', icon: <Trash2 size={14} />, label: '删除文档', danger: true }
  ]

  const handleMenuClick = useCallback(
    ({ key }: { key: string }) => {
      switch (key) {
        case 'versions':
          onShowVersions?.()
          break
        case 'export': {
          const exportContent = `# ${title}\n\n${content}`
          const blob = new Blob([exportContent], { type: 'text/markdown' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${title || 'document'}.md`
          a.click()
          URL.revokeObjectURL(url)
          break
        }
        case 'delete':
          onDelete()
          break
      }
    },
    [title, content, onDelete, onShowVersions]
  )

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      ;(e.target as HTMLInputElement).blur()
    }
  }, [])

  return (
    <div className={styles.wrapper}>
      {/* Floating action buttons */}
      <div className={styles.actions}>
        {lockInfo && (
          <Tooltip
            title={
              <span>
                被会话 {lockInfo.sessionId.slice(0, 8)}… 签出
                {lockInfo.reason ? ` — ${lockInfo.reason}` : ''}
                <br />
                签出时间: {new Date(lockInfo.acquiredAt).toLocaleString('zh-CN')}
              </span>
            }
          >
            <span className={styles.lockBadge}>
              <Lock size={11} />
              <span
                className={styles.lockSession}
                onClick={() => onNavigateToSession?.(lockInfo.sessionId)}
                role={onNavigateToSession ? 'button' : undefined}
                tabIndex={onNavigateToSession ? 0 : undefined}
              >
                {lockInfo.sessionId.slice(0, 8)}
                {onNavigateToSession && (
                  <ExternalLink size={9} style={{ marginLeft: 2, verticalAlign: -1 }} />
                )}
              </span>
              {onForceRelease && (
                <ActionIcon
                  icon={Trash2}
                  size={{ blockSize: 16 }}
                  title="强制释放锁"
                  onClick={(e) => {
                    e.stopPropagation()
                    onForceRelease()
                  }}
                  style={{ marginLeft: 2 }}
                />
              )}
            </span>
          </Tooltip>
        )}

        <button
          type="button"
          className={cx(styles.saveBtn, dirty && styles.saveBtnActive)}
          disabled={!dirty && !saving}
          onClick={onSave}
        >
          <Save size={13} />
          {saving ? '保存中…' : dirty ? '保存' : '已保存'}
        </button>

        <Dropdown menu={{ items: menuItems, onClick: handleMenuClick }} trigger={['click']}>
          <div>
            <ActionIcon icon={MoreHorizontal} title="更多操作" size="small" />
          </div>
        </Dropdown>
      </div>

      {/* Notion-style large title */}
      <input
        className={styles.titleInput}
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={handleTitleKeyDown}
        placeholder="无标题"
        spellCheck={false}
        autoComplete="off"
      />

      {/* Meta row: tags + time */}
      <div className={styles.metaRow}>
        <div className={styles.tagArea}>
          <TagSelector value={tags} onChange={onTagsChange} placeholder="添加标签…" />
        </div>
        {updatedAt && (
          <span className={styles.time}>
            {new Date(updatedAt).toLocaleString('zh-CN', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
        )}
      </div>
    </div>
  )
}
