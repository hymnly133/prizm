/**
 * Agent 后台状态 store - 模块级轻量订阅，用于跨页面感知 agent 是否正在后台对话
 * 当 AgentPage 被隐藏但对话仍在进行时，导航栏可显示后台指示器
 */
import { useState, useEffect } from 'react'

type Listener = (sending: boolean) => void

let _sending = false
const _listeners = new Set<Listener>()

export function setAgentSending(sending: boolean): void {
  if (_sending === sending) return
  _sending = sending
  _listeners.forEach((fn) => fn(sending))
}

export function getAgentSending(): boolean {
  return _sending
}

export function subscribeAgentSending(listener: Listener): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

/** React hook：订阅 agent 后台发送状态 */
export function useAgentSending(): boolean {
  const [sending, setSending] = useState(_sending)
  useEffect(() => {
    setSending(_sending)
    _listeners.add(setSending)
    return () => {
      _listeners.delete(setSending)
    }
  }, [])
  return sending
}
