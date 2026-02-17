/**
 * Embedding 模型状态、统计与调试面板
 * 展示本地向量模型的运行状态、推理统计、量化选择、相似度测试和记忆库管理
 */
import { Button, Form, Input, Modal, TextArea, toast } from '@lobehub/ui'
import { Select } from './ui/Select'
import { createStaticStyles } from 'antd-style'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Cpu,
  Loader,
  RefreshCw,
  Search,
  Trash2,
  Zap
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PrizmClient, EmbeddingStatus as EmbeddingStatusType } from '@prizm/client-core'

const styles = createStaticStyles(({ css, cssVar }) => ({
  sectionTitle: css`
    position: relative;
    display: flex;
    gap: ${cssVar.marginXS};
    align-items: center;
    height: 32px;
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    color: ${cssVar.colorTextHeading};
    &::after {
      content: '';
      flex: 1;
      height: 1px;
      margin-inline-start: ${cssVar.marginMD};
      background: linear-gradient(to right, ${cssVar.colorBorder}, transparent);
    }
  `,
  card: css`
    padding: ${cssVar.paddingMD};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillAlter};
    margin-bottom: ${cssVar.marginSM};
  `,
  statGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
    margin: 10px 0;
  `,
  statItem: css`
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border-radius: ${cssVar.borderRadiusSM};
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorderSecondary};
  `,
  statLabel: css`
    font-size: 11px;
    color: ${cssVar.colorTextDescription};
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  `,
  statValue: css`
    font-size: 18px;
    font-weight: 600;
    color: ${cssVar.colorText};
    font-variant-numeric: tabular-nums;
  `,
  statUnit: css`
    font-size: 11px;
    font-weight: 400;
    color: ${cssVar.colorTextSecondary};
    margin-left: 2px;
  `,
  statusBadge: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
  `,
  testResult: css`
    margin-top: 10px;
    padding: 12px;
    border-radius: ${cssVar.borderRadiusSM};
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorderSecondary};
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
  `,
  errorBox: css`
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: ${cssVar.borderRadiusSM};
    background: ${cssVar.colorErrorBg};
    border: 1px solid ${cssVar.colorErrorBorder};
    color: ${cssVar.colorErrorText};
    font-size: 12px;
  `,
  dangerCard: css`
    padding: ${cssVar.paddingMD};
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorErrorBg};
    margin-bottom: ${cssVar.marginSM};
  `,
  cardHeader: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `,
  statusRow: css`
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  `,
  modelInfo: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  errorTimestamp: css`
    opacity: 0.7;
  `,
  formHintSpaced: css`
    margin-top: 6px;
    margin-bottom: 10px;
  `,
  dangerButton: css`
    color: ${cssVar.colorError};
    border-color: ${cssVar.colorErrorBorder};
  `,
  modalWarning: css`
    margin-bottom: 12px;
    color: ${cssVar.colorError};
  `,
  modalHint: css`
    margin-bottom: 8px;
  `,
  modalInput: css`
    margin-bottom: 12px;
  `,
  modalFooter: css`
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  `,
  buttonGroup: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  statValueSmall: css`
    font-size: 14px;
  `
}))

interface Props {
  http: PrizmClient | null
  onLog?: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
}

const STATE_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: React.ReactNode }
> = {
  ready: {
    label: '运行中',
    color: 'var(--ant-color-success)',
    bg: 'var(--ant-color-success-bg)',
    icon: <CheckCircle size={13} />
  },
  loading: {
    label: '加载中',
    color: 'var(--ant-color-warning)',
    bg: 'var(--ant-color-warning-bg)',
    icon: <Loader size={13} />
  },
  error: {
    label: '错误',
    color: 'var(--ant-color-error)',
    bg: 'var(--ant-color-error-bg)',
    icon: <AlertTriangle size={13} />
  },
  idle: {
    label: '未启动',
    color: 'var(--ant-color-text-quaternary)',
    bg: 'var(--ant-color-fill-quaternary)',
    icon: <Clock size={13} />
  },
  disposing: {
    label: '释放中',
    color: 'var(--ant-color-warning)',
    bg: 'var(--ant-color-warning-bg)',
    icon: <Loader size={13} />
  }
}

const DTYPE_OPTIONS = [
  { label: 'Q4 — 4-bit（最小体积，质量略降）', value: 'q4' },
  { label: 'Q8 — 8-bit（推荐，平衡质量与体积）', value: 'q8' },
  { label: 'FP16 — 半精度浮点', value: 'fp16' },
  { label: 'FP32 — 全精度浮点（最大体积）', value: 'fp32' }
]

export function EmbeddingStatus({ http, onLog }: Props) {
  const [status, setStatus] = useState<EmbeddingStatusType | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [selectedDtype, setSelectedDtype] = useState('')
  const [testText, setTestText] = useState('')
  const [compareText, setCompareText] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [clearModalOpen, setClearModalOpen] = useState(false)
  const [clearConfirmText, setClearConfirmText] = useState('')
  const [clearing, setClearing] = useState(false)

  const initDtype = useRef(false)

  const loadStatus = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const s = await http.getEmbeddingStatus()
      setStatus(s)
      if (!initDtype.current && s.dtype) {
        setSelectedDtype(s.dtype)
        initDtype.current = true
      }
    } catch (e) {
      onLog?.(`加载 Embedding 状态失败: ${e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [http, onLog])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (!http) return
    const timer = setInterval(() => void loadStatus(), 15_000)
    return () => clearInterval(timer)
  }, [http, loadStatus])

  async function handleReload(dtype?: string) {
    if (!http) return
    setReloading(true)
    try {
      const result = await http.reloadEmbedding(dtype)
      toast.success(
        `模型已重载: ${result.modelName} ${result.dtype?.toUpperCase()} (${result.loadTimeMs}ms)`
      )
      onLog?.(`Embedding 模型重载成功: ${result.dtype} ${result.currentState}`, 'success')
      void loadStatus()
    } catch (e) {
      toast.error(`重载失败: ${e}`)
      onLog?.(`Embedding 重载失败: ${e}`, 'error')
    } finally {
      setReloading(false)
    }
  }

  async function handleDtypeChange(dtype: string) {
    setSelectedDtype(dtype)
    if (status?.dtype && dtype !== status.dtype) {
      await handleReload(dtype)
    }
  }

  async function handleTest() {
    if (!http || !testText.trim()) {
      toast.warning('请输入测试文本')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await http.testEmbedding(testText.trim(), compareText.trim() || undefined)
      const lines: string[] = [
        `维度: ${result.dimension}`,
        `推理延迟: ${result.latencyMs}ms`,
        `向量预览: [${result.vectorPreview.join(', ')}...]`
      ]
      if (result.similarity !== undefined) {
        lines.push(``)
        lines.push(`相似度: ${result.similarity}`)
        lines.push(`比较推理延迟: ${result.compareLatencyMs}ms`)
      }
      setTestResult(lines.join('\n'))
      void loadStatus()
    } catch (e) {
      setTestResult(`错误: ${e}`)
    } finally {
      setTesting(false)
    }
  }

  async function handleClearMemories() {
    if (!http || clearConfirmText !== 'DELETE ALL') return
    setClearing(true)
    try {
      const result = await http.clearAllMemories('DELETE ALL')
      toast.success(`已清空 ${result.deleted} 条记忆`)
      onLog?.(`记忆库已清空: ${result.deleted} 条记忆已删除`, 'success')
      setClearModalOpen(false)
      setClearConfirmText('')
    } catch (e) {
      toast.error(`清空失败: ${e}`)
      onLog?.(`清空记忆库失败: ${e}`, 'error')
    } finally {
      setClearing(false)
    }
  }

  if (loading && !status) {
    return (
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>向量模型</h2>
          <p className="form-hint">加载中...</p>
        </div>
      </div>
    )
  }

  const st = status
  const stateConf = STATE_CONFIG[st?.state ?? 'idle'] ?? STATE_CONFIG.idle

  const formatNum = (n: number | null | undefined) =>
    n == null || n === Infinity || n === -Infinity ? '-' : n.toLocaleString()

  const uptime = st?.upSinceMs ? Math.round((Date.now() - st.upSinceMs) / 1000) : null
  const uptimeStr =
    uptime !== null
      ? uptime >= 3600
        ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
        : uptime >= 60
        ? `${Math.floor(uptime / 60)}m ${uptime % 60}s`
        : `${uptime}s`
      : '-'

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>向量模型</h2>
        <p className="form-hint">本地 Embedding 模型状态与推理统计（{st?.modelName ?? '-'}）</p>
      </div>

      {/* 状态概览 */}
      <div className={styles.card} style={{ marginTop: 12 }}>
        <div className={styles.cardHeader}>
          <div className={styles.sectionTitle} style={{ flex: 1 }}>
            <Cpu size={16} />
            模型状态
          </div>
          <div className={styles.buttonGroup}>
            <Button size="small" onClick={() => void loadStatus()} disabled={loading}>
              <RefreshCw size={13} />
            </Button>
            <Button
              size="small"
              onClick={() => void handleReload()}
              loading={reloading}
              disabled={reloading}
            >
              重载模型
            </Button>
          </div>
        </div>

        <div className={styles.statusRow}>
          <span
            className={styles.statusBadge}
            style={{ color: stateConf.color, background: stateConf.bg }}
          >
            {stateConf.icon}
            {stateConf.label}
          </span>
          {st && (
            <span className={styles.modelInfo}>
              {st.modelName} &middot; {st.dtype?.toUpperCase()} &middot; {st.dimension} 维 &middot;
              {st.source === 'bundled' ? '内置' : '缓存'} &middot; 模型 {st.modelMemoryMb} MB / 进程{' '}
              {st.processMemoryMb} MB
            </span>
          )}
        </div>

        {/* 量化级别选择 */}
        <Form className="compact-form" gap={8} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            label="量化级别"
            extra="切换后自动重载模型。Q4 体积最小但质量略降，Q8 为推荐默认值"
          >
            <Select
              options={DTYPE_OPTIONS}
              value={selectedDtype || st?.dtype || 'q8'}
              onChange={(v) => void handleDtypeChange(v)}
              disabled={reloading}
            />
          </Form.Item>
        </Form>

        {st?.stats.lastError && (
          <div className={styles.errorBox}>
            <strong>最近错误:</strong> {st.stats.lastError.message}
            <br />
            <span className={styles.errorTimestamp}>
              {new Date(st.stats.lastError.timestamp).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* 推理统计 */}
      {st && (
        <div className={styles.card}>
          <div className={styles.sectionTitle}>
            <Activity size={16} />
            推理统计
          </div>
          <div className={styles.statGrid}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>总调用</span>
              <span className={styles.statValue}>{formatNum(st.stats.totalCalls)}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>总错误</span>
              <span className={styles.statValue}>{st.stats.totalErrors}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>处理字符</span>
              <span className={styles.statValue}>
                {st.stats.totalCharsProcessed >= 1000
                  ? `${(st.stats.totalCharsProcessed / 1000).toFixed(1)}`
                  : st.stats.totalCharsProcessed}
                <span className={styles.statUnit}>
                  {st.stats.totalCharsProcessed >= 1000 ? 'K' : ''}
                </span>
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>平均延迟</span>
              <span className={styles.statValue}>
                {st.stats.avgLatencyMs}
                <span className={styles.statUnit}>ms</span>
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>P95 延迟</span>
              <span className={styles.statValue}>
                {st.stats.p95LatencyMs}
                <span className={styles.statUnit}>ms</span>
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>最小 / 最大</span>
              <span className={`${styles.statValue} ${styles.statValueSmall}`}>
                {formatNum(st.stats.minLatencyMs)} / {formatNum(st.stats.maxLatencyMs)}
                <span className={styles.statUnit}>ms</span>
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>模型加载</span>
              <span className={styles.statValue}>
                {st.stats.modelLoadTimeMs}
                <span className={styles.statUnit}>ms</span>
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>运行时间</span>
              <span className={`${styles.statValue} ${styles.statValueSmall}`}>{uptimeStr}</span>
            </div>
          </div>
        </div>
      )}

      {/* 相似度测试 */}
      <div className={styles.card}>
        <div className={styles.sectionTitle}>
          <Search size={16} />
          相似度测试
        </div>
        <p className={`form-hint ${styles.formHintSpaced}`}>
          测试文本嵌入效果，可选填比较文本查看余弦相似度
        </p>
        <Form className="compact-form" gap={8} layout="vertical">
          <Form.Item label="测试文本">
            <TextArea
              value={testText}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTestText(e.target.value)}
              placeholder="输入要嵌入的文本..."
              rows={2}
              style={{ resize: 'vertical' }}
            />
          </Form.Item>
          <Form.Item label="比较文本（可选）" extra="填写后返回两段文本的余弦相似度">
            <TextArea
              value={compareText}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setCompareText(e.target.value)
              }
              placeholder="输入第二段文本用于比较..."
              rows={2}
              style={{ resize: 'vertical' }}
            />
          </Form.Item>
          <Form.Item>
            <Button
              onClick={() => void handleTest()}
              loading={testing}
              disabled={testing || st?.state !== 'ready'}
              type="primary"
              icon={<Zap size={14} />}
            >
              测试嵌入
            </Button>
          </Form.Item>
        </Form>
        {testResult && <div className={styles.testResult}>{testResult}</div>}
      </div>

      {/* 危险操作：清空记忆库 */}
      <div className={styles.dangerCard}>
        <div className={styles.sectionTitle}>
          <Trash2 size={16} />
          危险操作
        </div>
        <p className={`form-hint ${styles.formHintSpaced}`}>
          清空所有记忆数据，包括 SQLite 元数据和 LanceDB 向量索引。此操作不可逆。
        </p>
        <Button
          size="small"
          onClick={() => setClearModalOpen(true)}
          className={styles.dangerButton}
        >
          清空记忆库
        </Button>
      </div>

      {/* 确认对话框 */}
      <Modal
        open={clearModalOpen}
        title="确认清空所有记忆"
        onCancel={() => {
          setClearModalOpen(false)
          setClearConfirmText('')
        }}
        footer={null}
      >
        <p className={styles.modalWarning}>
          此操作将永久删除所有记忆数据（包括所有 scope 下的记忆和向量索引），且不可恢复。
        </p>
        <p className={styles.modalHint}>
          请输入 <strong>DELETE ALL</strong> 确认：
        </p>
        <Input
          value={clearConfirmText}
          onChange={(e) => setClearConfirmText(e.target.value)}
          placeholder="DELETE ALL"
          className={styles.modalInput}
        />
        <div className={styles.modalFooter}>
          <Button
            onClick={() => {
              setClearModalOpen(false)
              setClearConfirmText('')
            }}
          >
            取消
          </Button>
          <Button
            type="primary"
            danger
            onClick={() => void handleClearMemories()}
            loading={clearing}
            disabled={clearConfirmText !== 'DELETE ALL' || clearing}
          >
            确认清空
          </Button>
        </div>
      </Modal>
    </div>
  )
}
