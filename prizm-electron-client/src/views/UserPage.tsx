/**
 * 用户页 - 当前用户 Token 用量、记忆查询等
 */
import { memo } from 'react'
import { TokenUsagePanel } from '../components/agent/TokenUsagePanel'
import { MemoryInspector } from '../components/agent/MemoryInspector'

function UserPage() {
  return (
    <section className="page settings-page user-page">
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>Token 用量</h2>
          <p className="form-hint">按功能统计的 LLM Token 消耗（对话、记忆、摘要等）</p>
        </div>
        <div className="user-token-usage-wrap">
          <TokenUsagePanel />
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-header">
          <h2>记忆查询</h2>
          <p className="form-hint">查看与搜索当前用户的长期记忆，支持关键词/向量/混合检索</p>
        </div>
        <div className="user-memory-inspector-wrap">
          <MemoryInspector />
        </div>
      </div>
    </section>
  )
}

export default memo(UserPage)
