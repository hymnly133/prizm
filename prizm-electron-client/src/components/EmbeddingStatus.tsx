/**
 * Embedding 模型状态、统计与调试面板
 * 展示本地向量模型的运行状态、推理统计、量化选择、相似度测试、基准评测和记忆库管理
 */
import { Button, Checkbox, Form, Input, Modal, TextArea, toast } from '@lobehub/ui'
import { Select } from './ui/Select'
import { LoadingPlaceholder } from './ui/LoadingPlaceholder'
import { createStaticStyles } from 'antd-style'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Cpu,
  FlaskConical,
  Loader,
  RefreshCw,
  Search,
  Trash2,
  Zap
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PrizmClient,
  EmbeddingStatus as EmbeddingStatusType,
  EmbeddingTestResult,
  EmbeddingBenchmarkResult,
  SimilarityLevel,
  VectorStats,
  ServerConfigEmbedding
} from '@prizm/client-core'

// ==================== 样式 ====================

const styles = createStaticStyles(({ css, cssVar }) => ({
  sectionTitle: css`
    position: relative;
    display: flex;
    gap: ${cssVar.marginXS};
    align-items: center;
    height: 28px;
    font-size: 13px;
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
  testResultCard: css`
    margin-top: 12px;
    padding: 14px;
    border-radius: ${cssVar.borderRadiusSM};
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorderSecondary};
    font-size: 13px;
    line-height: 1.7;
  `,
  testResultRow: css`
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 2px 0;
  `,
  testResultLabel: css`
    flex-shrink: 0;
    min-width: 80px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  testResultValue: css`
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 12px;
    color: ${cssVar.colorText};
    word-break: break-all;
  `,
  similarityBadge: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  `,
  divider: css`
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
    margin: 8px 0;
  `,
  vectorStatsGrid: css`
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
    margin-top: 4px;
  `,
  vectorStatCell: css`
    padding: 4px 8px;
    border-radius: ${cssVar.borderRadiusSM};
    background: ${cssVar.colorFillQuaternary};
    font-size: 11px;
    text-align: center;
  `,
  vectorStatCellLabel: css`
    color: ${cssVar.colorTextDescription};
    font-size: 10px;
  `,
  vectorStatCellValue: css`
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    color: ${cssVar.colorText};
  `,
  benchmarkRow: css`
    display: grid;
    grid-template-columns: 1fr 1fr 80px 60px 50px;
    gap: 8px;
    align-items: center;
    padding: 6px 10px;
    font-size: 12px;
    border-bottom: 1px solid ${cssVar.colorBorderSecondary};
    &:last-child {
      border-bottom: none;
    }
  `,
  benchmarkHeader: css`
    display: grid;
    grid-template-columns: 1fr 1fr 80px 60px 50px;
    gap: 8px;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    color: ${cssVar.colorTextDescription};
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-bottom: 2px solid ${cssVar.colorBorder};
  `,
  benchmarkText: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: ${cssVar.colorText};
  `,
  benchmarkPassBadge: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
  `,
  benchmarkSummaryGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
    margin-top: 10px;
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

// ==================== 常量 ====================

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

/** 相似度等级 → 颜色 */
const SIMILARITY_COLORS: Record<SimilarityLevel, { color: string; bg: string }> = {
  very_high: { color: 'var(--ant-color-success)', bg: 'var(--ant-color-success-bg)' },
  high: { color: 'var(--ant-green-6, #52c41a)', bg: 'var(--ant-green-1, #f6ffed)' },
  medium: { color: 'var(--ant-color-warning)', bg: 'var(--ant-color-warning-bg)' },
  low: { color: 'var(--ant-orange-6, #fa8c16)', bg: 'var(--ant-orange-1, #fff7e6)' },
  very_low: { color: 'var(--ant-color-error)', bg: 'var(--ant-color-error-bg)' }
}

// ==================== 子组件 ====================

/** 向量统计展示 */
function VectorStatsDisplay({ stats, label }: { stats: VectorStats; label?: string }) {
  return (
    <div>
      {label && (
        <span style={{ fontSize: 11, color: 'var(--ant-color-text-description)' }}>{label}</span>
      )}
      <div className={styles.vectorStatsGrid}>
        {(['mean', 'std', 'min', 'max', 'norm'] as const).map((key) => (
          <div key={key} className={styles.vectorStatCell}>
            <div className={styles.vectorStatCellLabel}>{key}</div>
            <div className={styles.vectorStatCellValue}>{stats[key]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 相似度徽章 */
function SimilarityBadge({
  score,
  level,
  label
}: {
  score: number
  level: SimilarityLevel
  label: string
}) {
  const colors = SIMILARITY_COLORS[level]
  return (
    <span className={styles.similarityBadge} style={{ color: colors.color, background: colors.bg }}>
      {score} ({label})
    </span>
  )
}

/** 结构化测试结果卡片 */
function TestResultCard({ result }: { result: EmbeddingTestResult }) {
  const hasSimilarity = result.similarity !== undefined && result.similarityLevel

  return (
    <div className={styles.testResultCard}>
      {/* 基本信息 */}
      <div className={styles.testResultRow}>
        <span className={styles.testResultLabel}>文本</span>
        <span className={styles.testResultValue}>
          {result.text.length > 120 ? result.text.slice(0, 120) + '...' : result.text}
        </span>
      </div>
      <div className={styles.testResultRow}>
        <span className={styles.testResultLabel}>字符数</span>
        <span className={styles.testResultValue}>{result.textLength}</span>
      </div>
      <div className={styles.testResultRow}>
        <span className={styles.testResultLabel}>维度</span>
        <span className={styles.testResultValue}>{result.dimension}</span>
      </div>
      <div className={styles.testResultRow}>
        <span className={styles.testResultLabel}>推理延迟</span>
        <span className={styles.testResultValue}>{result.latencyMs}ms</span>
      </div>
      <div className={styles.testResultRow}>
        <span className={styles.testResultLabel}>向量预览</span>
        <span className={styles.testResultValue}>[{result.vectorPreview.join(', ')}...]</span>
      </div>

      {/* 向量统计 */}
      {result.vectorStats && <VectorStatsDisplay stats={result.vectorStats} label="向量统计" />}

      {/* 相似度比较结果 */}
      {hasSimilarity && (
        <>
          <div className={styles.divider} />
          <div className={styles.testResultRow}>
            <span className={styles.testResultLabel}>比较文本</span>
            <span className={styles.testResultValue}>
              {result.compareWith && result.compareWith.length > 120
                ? result.compareWith.slice(0, 120) + '...'
                : result.compareWith}
            </span>
          </div>
          <div className={styles.testResultRow}>
            <span className={styles.testResultLabel}>比较字符数</span>
            <span className={styles.testResultValue}>{result.compareTextLength}</span>
          </div>
          <div className={styles.testResultRow}>
            <span className={styles.testResultLabel}>比较延迟</span>
            <span className={styles.testResultValue}>{result.compareLatencyMs}ms</span>
          </div>
          {result.compareVectorPreview && (
            <div className={styles.testResultRow}>
              <span className={styles.testResultLabel}>比较向量</span>
              <span className={styles.testResultValue}>
                [{result.compareVectorPreview.join(', ')}...]
              </span>
            </div>
          )}

          {result.compareVectorStats && (
            <VectorStatsDisplay stats={result.compareVectorStats} label="比较向量统计" />
          )}

          <div className={styles.divider} />
          <div className={styles.testResultRow}>
            <span className={styles.testResultLabel}>原始相似度</span>
            <span className={styles.testResultValue}>{result.similarity}</span>
          </div>
          {result.calibratedSimilarity !== undefined && (
            <div className={styles.testResultRow}>
              <span className={styles.testResultLabel}>校准相似度</span>
              <SimilarityBadge
                score={result.calibratedSimilarity}
                level={result.similarityLevel!}
                label={result.similarityLabel!}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 期望类型 → 中文标签 */
const EXPECTED_LABELS: Record<string, string> = {
  high: '高',
  low: '低',
  cross_lang: '跨语言',
  antonym: '反义'
}

/** 基准测试结果卡片 */
function BenchmarkResultCard({ result }: { result: EmbeddingBenchmarkResult }) {
  const { pairs, summary } = result
  const passRatePct = Math.round(summary.passRate * 100)

  return (
    <div style={{ marginTop: 12 }}>
      {/* 汇总统计 */}
      <div className={styles.benchmarkSummaryGrid}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>通过率</span>
          <span
            className={styles.statValue}
            style={{
              color: passRatePct >= 80 ? 'var(--ant-color-success)' : 'var(--ant-color-warning)'
            }}
          >
            {passRatePct}%
          </span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>通过/评分</span>
          <span className={`${styles.statValue} ${styles.statValueSmall}`}>
            {summary.passCount}/{summary.scorablePairs}
          </span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>统一阈值</span>
          <span className={`${styles.statValue} ${styles.statValueSmall}`}>
            {summary.threshold}
          </span>
        </div>
        {(summary.crossLangPairs > 0 || summary.antonymPairs > 0) && (
          <div className={styles.statItem}>
            <span className={styles.statLabel}>不计入评分</span>
            <span
              className={`${styles.statValue} ${styles.statValueSmall}`}
              style={{ color: 'var(--ant-color-text-secondary)' }}
            >
              {summary.crossLangPairs + summary.antonymPairs}
              <span className={styles.statUnit}>
                （跨语言{summary.crossLangPairs} + 反义{summary.antonymPairs}）
              </span>
            </span>
          </div>
        )}
        <div className={styles.statItem}>
          <span className={styles.statLabel}>高相似校准均值</span>
          <span className={`${styles.statValue} ${styles.statValueSmall}`}>
            {summary.avgHighCalibratedSimilarity}
          </span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>低相似校准均值</span>
          <span className={`${styles.statValue} ${styles.statValueSmall}`}>
            {summary.avgLowCalibratedSimilarity}
          </span>
        </div>
        {summary.crossLangPairs > 0 && (
          <div className={styles.statItem}>
            <span className={styles.statLabel}>跨语言校准均值</span>
            <span
              className={`${styles.statValue} ${styles.statValueSmall}`}
              style={{ color: 'var(--ant-color-text-secondary)' }}
            >
              {summary.avgCrossLangCalibratedSimilarity}
            </span>
          </div>
        )}
        <div className={styles.statItem}>
          <span className={styles.statLabel}>区分度</span>
          <span
            className={`${styles.statValue} ${styles.statValueSmall}`}
            style={{
              color:
                summary.discrimination >= 0.15
                  ? 'var(--ant-color-success)'
                  : 'var(--ant-color-error)'
            }}
          >
            {summary.discrimination}
          </span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>总耗时</span>
          <span className={`${styles.statValue} ${styles.statValueSmall}`}>
            {summary.totalLatencyMs}
            <span className={styles.statUnit}>ms</span>
          </span>
        </div>
      </div>

      {/* 详细对比表 */}
      <div style={{ marginTop: 12, overflowX: 'auto' }}>
        <div className={styles.benchmarkHeader}>
          <span>文本 A</span>
          <span>文本 B</span>
          <span>校准分</span>
          <span>期望</span>
          <span>结果</span>
        </div>
        {pairs.map((pair, idx) => {
          const simColors = SIMILARITY_COLORS[pair.similarityLevel]
          const isSkipped = pair.expected === 'antonym' || pair.expected === 'cross_lang'

          let passDisplay: { text: string; color: string; bg: string }
          if (isSkipped) {
            passDisplay = {
              text: 'SKIP',
              color: 'var(--ant-color-text-quaternary)',
              bg: 'var(--ant-color-fill-quaternary)'
            }
          } else if (pair.pass) {
            passDisplay = {
              text: 'PASS',
              color: 'var(--ant-color-success)',
              bg: 'var(--ant-color-success-bg)'
            }
          } else {
            passDisplay = {
              text: 'FAIL',
              color: 'var(--ant-color-error)',
              bg: 'var(--ant-color-error-bg)'
            }
          }

          return (
            <div
              key={idx}
              className={styles.benchmarkRow}
              style={isSkipped ? { opacity: 0.7 } : undefined}
            >
              <span className={styles.benchmarkText} title={pair.textA}>
                {pair.textA}
              </span>
              <span className={styles.benchmarkText} title={pair.textB}>
                {pair.textB}
              </span>
              <span
                style={{
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  color: simColors.color
                }}
                title={`原始: ${pair.similarity}`}
              >
                {pair.calibratedSimilarity}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)' }}>
                {EXPECTED_LABELS[pair.expected] ?? pair.expected} ({pair.category})
              </span>
              <span
                className={styles.benchmarkPassBadge}
                style={{ color: passDisplay.color, background: passDisplay.bg }}
              >
                {passDisplay.text}
              </span>
            </div>
          )
        })}
      </div>

      {/* SKIP 类型说明 */}
      {(summary.crossLangPairs > 0 || summary.antonymPairs > 0) && (
        <p
          style={{
            marginTop: 8,
            fontSize: 11,
            color: 'var(--ant-color-text-description)',
            lineHeight: 1.6
          }}
        >
          {summary.crossLangPairs > 0 && (
            <>
              * 跨语言对（SKIP）：小模型（{summary.modelName}
              ）跨语言能力不足，无法可靠匹配不同语言的同义文本，不计入通过率。
              <br />
            </>
          )}
          {summary.antonymPairs > 0 && (
            <>
              * 反义词对（SKIP）：嵌入模型通过词汇/结构相似度工作，无法区分语义对立（如"好用"
              vs"难用"），这是所有嵌入模型的已知限制，不计入通过率。
            </>
          )}
          <br />
          统一阈值 {summary.threshold}：calibrated &ge; {summary.threshold} 判定为相似，实际去重中由
          LLM 二次校验兜底。
        </p>
      )}
    </div>
  )
}

// ==================== 主组件 ====================

const EMBEDDING_DTYPE_OPTIONS = [
  { label: 'q4', value: 'q4' },
  { label: 'q8', value: 'q8' },
  { label: 'fp16', value: 'fp16' },
  { label: 'fp32', value: 'fp32' }
]

export function EmbeddingStatus({ http, onLog }: Props) {
  const [status, setStatus] = useState<EmbeddingStatusType | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [selectedDtype, setSelectedDtype] = useState('')
  const [testText, setTestText] = useState('')
  const [compareText, setCompareText] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<EmbeddingTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [benchmarking, setBenchmarking] = useState(false)
  const [benchmarkResult, setBenchmarkResult] = useState<EmbeddingBenchmarkResult | null>(null)
  const [clearModalOpen, setClearModalOpen] = useState(false)
  const [clearConfirmText, setClearConfirmText] = useState('')
  const [clearing, setClearing] = useState(false)

  const [embeddingConfig, setEmbeddingConfig] = useState<Partial<ServerConfigEmbedding>>({})
  const [embeddingConfigLoading, setEmbeddingConfigLoading] = useState(false)
  const [embeddingConfigSaving, setEmbeddingConfigSaving] = useState(false)

  const initDtype = useRef(false)

  const loadEmbeddingConfig = useCallback(async () => {
    if (!http) return
    setEmbeddingConfigLoading(true)
    try {
      const res = await http.getServerConfig()
      setEmbeddingConfig(res.embedding ?? {})
    } catch (e) {
      onLog?.(`加载 Embedding 配置失败: ${e}`, 'error')
    } finally {
      setEmbeddingConfigLoading(false)
    }
  }, [http, onLog])

  useEffect(() => {
    void loadEmbeddingConfig()
  }, [loadEmbeddingConfig])

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
    setTestError(null)
    try {
      const result = await http.testEmbedding(testText.trim(), compareText.trim() || undefined)
      setTestResult(result)
      void loadStatus()
    } catch (e) {
      setTestError(`测试失败: ${e}`)
    } finally {
      setTesting(false)
    }
  }

  async function handleBenchmark() {
    if (!http) return
    setBenchmarking(true)
    setBenchmarkResult(null)
    try {
      const result = await http.runEmbeddingBenchmark()
      setBenchmarkResult(result)
      const passRate = Math.round(result.summary.passRate * 100)
      toast.success(`基准测试完成: 通过率 ${passRate}%（${result.summary.totalLatencyMs}ms）`)
      void loadStatus()
    } catch (e) {
      toast.error(`基准测试失败: ${e}`)
      onLog?.(`基准测试失败: ${e}`, 'error')
    } finally {
      setBenchmarking(false)
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
        </div>
        <LoadingPlaceholder />
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

  async function handleSaveEmbeddingConfig() {
    if (!http) return
    setEmbeddingConfigSaving(true)
    try {
      await http.updateServerConfig({ embedding: embeddingConfig })
      toast.success('Embedding 配置已保存')
      onLog?.('Embedding 配置已保存', 'success')
      void loadEmbeddingConfig()
      void loadStatus()
    } catch (e) {
      toast.error(String(e))
      onLog?.(`保存 Embedding 配置失败: ${e}`, 'error')
    } finally {
      setEmbeddingConfigSaving(false)
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>向量模型</h2>
        <p className="form-hint">本地 Embedding 配置、状态与推理统计（{st?.modelName ?? '-'}）</p>
      </div>

      {/* Embedding 配置 */}
      <div className="settings-card">
        <div className={styles.sectionTitle}>
          <Cpu size={16} />
          Embedding 配置
        </div>
        <p className="form-hint" style={{ marginTop: 6, marginBottom: 10 }}>
          启用、模型、缓存目录与量化等；修改后保存，重载模型后生效。
        </p>
        {embeddingConfigLoading ? (
          <LoadingPlaceholder />
        ) : (
          <Form className="compact-form" gap={8} layout="vertical">
            <Form.Item label="启用本地 Embedding">
              <Checkbox
                checked={embeddingConfig.enabled !== false}
                onChange={(c) => setEmbeddingConfig((prev) => ({ ...prev, enabled: c as boolean }))}
              />
              <span style={{ marginLeft: 8 }}>启用</span>
            </Form.Item>
            <Form.Item label="模型" extra="HuggingFace 模型 ID">
              <Input
                value={embeddingConfig.model ?? ''}
                onChange={(e) =>
                  setEmbeddingConfig((c) => ({ ...c, model: e.target.value.trim() || undefined }))
                }
                placeholder="TaylorAI/bge-micro-v2"
              />
            </Form.Item>
            <Form.Item label="缓存目录">
              <Input
                value={embeddingConfig.cacheDir ?? ''}
                onChange={(e) =>
                  setEmbeddingConfig((c) => ({
                    ...c,
                    cacheDir: e.target.value.trim() || undefined
                  }))
                }
                placeholder="{dataDir}/models"
              />
            </Form.Item>
            <Form.Item label="量化类型">
              <Select
                options={EMBEDDING_DTYPE_OPTIONS}
                value={embeddingConfig.dtype ?? 'q8'}
                onChange={(v) =>
                  setEmbeddingConfig((c) => ({
                    ...c,
                    dtype: (v as 'q4' | 'q8' | 'fp16' | 'fp32') || undefined
                  }))
                }
              />
            </Form.Item>
            <Form.Item label="最大并发数">
              <Input
                type="number"
                min={1}
                value={embeddingConfig.maxConcurrency ?? ''}
                onChange={(e) =>
                  setEmbeddingConfig((c) => ({
                    ...c,
                    maxConcurrency: parseInt(e.target.value, 10) || undefined
                  }))
                }
                placeholder="1"
              />
            </Form.Item>
            <div style={{ marginTop: 8 }}>
              <Button
                type="primary"
                onClick={() => void handleSaveEmbeddingConfig()}
                loading={embeddingConfigSaving}
              >
                保存 Embedding 配置
              </Button>
            </div>
          </Form>
        )}
      </div>

      {/* 状态概览 */}
      <div className="settings-card">
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
        <div className="settings-card">
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
      <div className="settings-card">
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
          <Form.Item label="比较文本（可选）" extra="填写后返回两段文本的余弦相似度与等级判定">
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
        {testResult && <TestResultCard result={testResult} />}
        {testError && <div className={styles.errorBox}>{testError}</div>}
      </div>

      {/* 基准评测 */}
      <div className="settings-card">
        <div className={styles.cardHeader}>
          <div className={styles.sectionTitle} style={{ flex: 1 }}>
            <FlaskConical size={16} />
            基准评测
          </div>
          <Button
            size="small"
            onClick={() => void handleBenchmark()}
            loading={benchmarking}
            disabled={benchmarking || st?.state !== 'ready'}
            type="primary"
            icon={<Zap size={13} />}
          >
            运行基准测试
          </Button>
        </div>
        <p className={`form-hint ${styles.formHintSpaced}`}>
          使用内置语义对（同义改写、跨语言、不同主题、语义对立）评估模型的语义区分能力
        </p>
        {benchmarkResult && <BenchmarkResultCard result={benchmarkResult} />}
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
