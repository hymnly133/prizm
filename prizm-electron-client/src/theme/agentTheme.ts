/**
 * Agent 页面主题 — design tokens + CSS-in-JS 样式
 * 使用 antd-style createStyles，与 LobeUI ThemeProvider 深度集成
 */
import { createStyles } from 'antd-style'

/* ── Design Tokens ── */
export const AGENT_TOKENS = {
  borderRadius: { sm: 8, md: 12, lg: 16 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,.04)',
    md: '0 4px 16px rgba(0,0,0,.06)',
    lg: '0 12px 32px rgba(0,0,0,.08)'
  },
  fontSize: { title: 18, body: 14, aux: 12, meta: 11 },
  sidebarWidth: { left: 220, right: 280 }
} as const

/* ── Agent 页面全局样式 ── */
export const useAgentPageStyles = createStyles(({ css, token, isDarkMode }) => {
  const cardBg = token.colorBgContainer
  const cardBorder = token.colorBorderSecondary
  const elevatedBg = isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)'

  return {
    /* ── 页面根布局 ── */
    page: css`
      display: flex;
      flex: 1;
      min-height: 0;
      height: 100%;
      overflow: hidden;
    `,

    /* ── 左侧会话列表 ── */
    sidebar: css`
      width: 100%;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `,
    sidebarHeader: css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid ${cardBorder};
      flex-shrink: 0;
    `,
    sidebarTitle: css`
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${token.colorTextSecondary};
    `,
    sessionsList: css`
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    `,
    overviewTab: css`
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      margin: 4px 8px 2px;
      border-radius: ${AGENT_TOKENS.borderRadius.sm}px;
      font-size: 13px;
      font-weight: 500;
      color: ${token.colorTextSecondary};
      cursor: pointer;
      transition: background 0.2s, color 0.2s;
      user-select: none;
      border: 1px solid transparent;

      &:hover {
        background: ${token.colorFillTertiary};
        color: ${token.colorText};
      }
    `,
    overviewTabActive: css`
      background: ${token.colorPrimaryBg};
      color: ${token.colorPrimary};
      border-color: ${token.colorPrimaryBorder};
    `,
    sessionItem: css`
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    `,
    sessionItemSummary: css`
      font-size: 13px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: block;
    `,
    sessionActions: css`
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.12s ease;
    `,
    interactBadge: css`
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${token.colorWarning};
      margin-right: 6px;
      vertical-align: middle;
      flex-shrink: 0;
      animation: agentInteractPulse 1s ease-in-out infinite;

      @keyframes agentInteractPulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.5;
          transform: scale(0.8);
        }
      }
    `,

    /* ── 中间内容区 ── */
    content: css`
      flex: 1;
      min-height: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `,
    main: css`
      flex: 1;
      min-height: 0;
      height: 100%;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: ${cardBg};
    `,
    messages: css`
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    `,
    empty: css`
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px;
      text-align: center;
      color: ${token.colorTextSecondary};
    `,
    inputWrap: css`
      width: 100%;
      flex-shrink: 0;
      max-height: 360px;
      padding: 8px 16px 16px;
      background: ${cardBg};
    `,
    errorBanner: css`
      padding: 8px 16px;
      background: ${token.colorErrorBg};
      border: 1px solid ${token.colorErrorBorder};
      border-radius: ${AGENT_TOKENS.borderRadius.sm}px;
      color: ${token.colorError};
      font-size: 13px;
      margin: 0 16px;
      flex-shrink: 0;
    `,

    /* ── 右侧栏 ── */
    rightSidebar: css`
      width: 100%;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `,
    rightSidebarHeader: css`
      padding: 10px 12px;
      border-bottom: 1px solid ${cardBorder};
      flex-shrink: 0;
    `,
    rightSidebarTitle: css`
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${token.colorTextSecondary};
    `,
    rightSidebarBody: css`
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    `,
    rightSection: css`
      flex-shrink: 0;
    `,
    rightSectionTitle: css`
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${token.colorTextSecondary};
      margin: 0 0 8px 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    `,

    /* ── 通用卡片 ── */
    card: css`
      display: flex;
      flex-direction: column;
      background: ${cardBg};
      border: 1px solid ${cardBorder};
      border-radius: ${AGENT_TOKENS.borderRadius.md}px;
      overflow: hidden;
      transition: box-shadow 0.2s, border-color 0.2s;

      &:hover {
        box-shadow: ${AGENT_TOKENS.shadow.md};
        border-color: ${token.colorBorder};
      }
    `,
    cardHead: css`
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      font-size: 13px;
      font-weight: 600;
      color: ${token.colorText};
      border-bottom: 1px solid ${cardBorder};
      background: ${elevatedBg};
      flex-shrink: 0;
    `,
    cardBody: css`
      padding: 16px;
      flex: 1;
      min-height: 0;
    `,
    cardBodyScroll: css`
      max-height: 340px;
      overflow-y: auto;
    `,
    cardAction: css`
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: ${token.colorTextTertiary};
      cursor: pointer;
      margin-left: auto;
      transition: all 0.15s;

      &:hover {
        background: ${token.colorFillSecondary};
        color: ${token.colorPrimary};
      }
      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    `,

    /* ── 总览面板 ── */
    overviewPanel: css`
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 24px 28px 32px;
      background: ${token.colorBgLayout};
    `,
    overviewHeader: css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      flex-shrink: 0;
    `,
    overviewTitle: css`
      font-size: ${AGENT_TOKENS.fontSize.title}px;
      font-weight: 600;
      margin: 0;
      color: ${token.colorText};
    `,
    overviewGrid: css`
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
      align-items: stretch;
    `,
    overviewFullWidth: css`
      grid-column: 1 / -1;
    `,

    /* ── 统计块 ── */
    statGrid: css`
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    `,
    statBlock: css`
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border-radius: ${AGENT_TOKENS.borderRadius.sm}px;
      background: ${token.colorFillQuaternary};
      transition: background 0.15s;

      &:hover {
        background: ${token.colorFillTertiary};
      }
    `,
    statValue: css`
      font-size: 20px;
      font-weight: 700;
      line-height: 1.1;
      color: ${token.colorText};
      font-variant-numeric: tabular-nums;
    `,
    statLabel: css`
      font-size: 12px;
      color: ${token.colorTextTertiary};
    `,

    /* ── 记忆面板 ── */
    memoryTiers: css`
      display: flex;
      flex-direction: column;
      gap: 10px;
    `,
    memoryRow: css`
      display: flex;
      align-items: center;
      gap: 10px;
    `,
    memoryLabel: css`
      font-size: 12px;
      font-weight: 500;
      color: ${token.colorTextSecondary};
      width: 52px;
      flex-shrink: 0;
    `,
    memoryBarBg: css`
      flex: 1;
      height: 8px;
      border-radius: 4px;
      background: ${token.colorFillSecondary};
      overflow: hidden;
    `,
    memoryBarFill: css`
      height: 100%;
      border-radius: 4px;
      transition: width 0.4s cubic-bezier(0.33, 1, 0.68, 1);
      min-width: 4px;
    `,
    memoryCount: css`
      font-size: 13px;
      font-weight: 600;
      color: ${token.colorText};
      width: 28px;
      text-align: right;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    `,

    /* ── Token 可视化 ── */
    tokenBar: css`
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: ${token.colorFillQuaternary};
      border-radius: ${AGENT_TOKENS.borderRadius.sm}px;
      font-size: 13px;
      transition: background 0.15s;

      &:hover {
        background: ${token.colorFillTertiary};
      }
    `,
    tokenLabel: css`
      color: ${token.colorTextSecondary};
      flex: 1;
    `,
    tokenValue: css`
      font-variant-numeric: tabular-nums;
      color: ${token.colorText};
      font-weight: 500;
    `,
    tokenBarChart: css`
      height: 6px;
      border-radius: 3px;
      background: ${token.colorFillSecondary};
      overflow: hidden;
      flex: 1;
      min-width: 40px;
    `,
    tokenBarChartFill: css`
      height: 100%;
      border-radius: 3px;
      transition: width 0.4s cubic-bezier(0.33, 1, 0.68, 1);
    `,

    /* ── 思考指示器 ── */
    thinkingIndicator: css`
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      margin: 4px 48px;
      font-size: 12px;
      color: ${token.colorTextTertiary};
    `,

    /* ── 消息额外信息 ── */
    messageExtra: css`
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    `,
    reasoningDetails: css`
      margin: 0;
      border: 1px solid ${cardBorder};
      border-radius: ${AGENT_TOKENS.borderRadius.sm}px;
      background: ${token.colorFillQuaternary};
    `,
    reasoningSummary: css`
      cursor: pointer;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 500;
      color: ${token.colorTextSecondary};

      &:hover {
        color: ${token.colorText};
      }
    `,
    reasoningContent: css`
      margin: 0;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
      color: ${token.colorTextSecondary};
      white-space: pre-wrap;
      word-break: break-word;
      border-top: 1px solid ${cardBorder};
      max-height: 200px;
      overflow-y: auto;
    `,

    /* ── 工具卡片 ── */
    toolCard: css`
      position: relative;
      border: 1px solid ${cardBorder};
      border-radius: 10px;
      overflow: hidden;
      background: ${cardBg};
      transition: border-color 0.2s, box-shadow 0.2s;

      &:hover {
        border-color: ${token.colorBorder};
        box-shadow: ${AGENT_TOKENS.shadow.sm};
      }
    `,
    toolCardError: css`
      border-color: ${token.colorErrorBorder};
      background: color-mix(in srgb, ${token.colorErrorBg} 40%, ${cardBg});
    `,
    toolCardHeader: css`
      cursor: pointer;
      padding: 10px 14px;
      user-select: none;
      transition: background 0.15s;

      &:hover {
        background: ${token.colorFillQuaternary};
      }
    `,
    toolCardBody: css`
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 0 14px 12px;
      border-top: 1px solid ${cardBorder};
      margin-top: 0;
      padding-top: 10px;
    `,

    /* ── 刷新按钮 ── */
    refreshBtn: css`
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: 1px solid ${token.colorBorder};
      border-radius: ${AGENT_TOKENS.borderRadius.sm}px;
      background: ${cardBg};
      color: ${token.colorTextSecondary};
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        border-color: ${token.colorPrimary};
        color: ${token.colorPrimary};
        background: ${token.colorPrimaryBg};
      }
    `,

    /* ── 空状态文字 ── */
    emptyText: css`
      margin: 0;
      font-size: 13px;
      color: ${token.colorTextQuaternary};
      text-align: center;
      padding: 12px 0;
    `
  }
})
