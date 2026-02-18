import { createStyles } from 'antd-style'

export const useMemoryStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 16px;
  `,
  header: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `,
  querySection: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex-shrink: 0;
  `,
  queryRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  queryInput: css`
    flex: 1;
    min-width: 0;
  `,
  advancedRow: css`
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  `,
  advancedLabel: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  list: css`
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-right: 4px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    padding: 8px;
  `,
  item: css`
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 14px;
    background: ${token.colorFillQuaternary};
    border-radius: ${token.borderRadius}px;
    transition: background 0.2s;
    gap: 12px;
    flex-shrink: 0;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  content: css`
    flex: 1;
    min-width: 0;
    font-size: 14px;
    line-height: 1.5;
    color: ${token.colorText};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  meta: css`
    display: flex;
    gap: 8px;
    margin-top: 8px;
    font-size: 12px;
    color: ${token.colorTextDescription};
    align-items: center;
  `,
  actions: css`
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  `,
  empty: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 120px;
    color: ${token.colorTextQuaternary};
  `,
  partition: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
    margin: 0 -4px 0 0;
  `,
  partitionList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  emptySection: css`
    padding: 12px;
    font-size: 13px;
    color: ${token.colorTextQuaternary};
  `,
  subCollapse: css`
    .ant-collapse-item {
      border-bottom: none !important;
    }
    .ant-collapse-header {
      padding: 6px 0 6px 8px !important;
      min-height: auto !important;
    }
    .ant-collapse-content-box {
      padding: 6px 0 6px 16px !important;
    }
  `,
  subCategoryHeader: css`
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextTertiary};
  `,
  dedupItem: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    background: ${token.colorFillQuaternary};
    border-radius: ${token.borderRadius}px;
    transition: background 0.2s;
    flex-shrink: 0;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  dedupHeader: css`
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  `,
  dedupMemoryPair: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    line-height: 1.5;
  `,
  dedupLabel: css`
    font-size: 11px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
  dedupContent: css`
    color: ${token.colorText};
    word-break: break-word;
    white-space: pre-wrap;
    padding-left: 8px;
    border-left: 2px solid ${token.colorBorderSecondary};
  `,
  dedupMeta: css`
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12px;
    color: ${token.colorTextDescription};
    align-items: center;
  `,
  triggerButton: css`
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    padding: 10px 16px;
    width: 100%;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 10px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 8px;

    &:hover {
      border-color: ${token.colorPrimaryBorder};
      color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  drawerTitle: css`
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  `,
  tabsWrap: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    .ant-tabs-content-holder {
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    .ant-tabs-content {
      height: 100%;
    }

    .ant-tabs-tabpane-active {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
  `,
  tabLabel: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  summaryBar: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    font-size: 12px;
    color: ${token.colorTextDescription};
    flex-shrink: 0;
  `,
  smallTag: css`
    font-size: 11px;
  `,
  updatedAt: css`
    font-size: 11px;
    color: ${token.colorTextQuaternary};
  `,
  dedupHintText: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `,
  listSpin: css`
    &.ant-spin-nested-loading {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .ant-spin-container {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
  `,
  logItem: css`
    padding: 10px 14px;
    background: ${token.colorFillQuaternary};
    border-radius: ${token.borderRadius}px;
    transition: background 0.2s;
    flex-shrink: 0;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  logDetail: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorTextSecondary};
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    padding: 8px 12px;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
  `,
  logError: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorErrorText};
    background: ${token.colorErrorBg};
    border: 1px solid ${token.colorErrorBorder};
    border-radius: ${token.borderRadius}px;
    padding: 8px 12px;
    margin: 0;
    margin-top: 4px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
  `
}))
