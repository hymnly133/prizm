import { Button, Form, Input, toast } from '@lobehub/ui'
import { Steps } from 'antd'
import { useState } from 'react'
import { CheckCircle, Globe, Key, FolderOpen, Rocket } from 'lucide-react'
import { buildServerUrl } from '@prizm/client-core'
import type { PrizmConfig } from '@prizm/client-core'

interface OnboardingWizardProps {
  onComplete: () => void
  testConnection: (serverUrl: string) => Promise<boolean>
  registerClient: (serverUrl: string, name: string, scopes: string[]) => Promise<string | null>
  saveConfig: (cfg: PrizmConfig) => Promise<boolean>
  loadConfig: () => Promise<PrizmConfig | null>
  setConfig: (cfg: PrizmConfig) => void
}

export function OnboardingWizard({
  onComplete,
  testConnection,
  registerClient,
  saveConfig,
  loadConfig,
  setConfig
}: OnboardingWizardProps) {
  const [step, setStep] = useState(0)
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('4127')
  const [clientName, setClientName] = useState('Prizm Electron Client')
  const [scopes, setScopes] = useState('default, online')
  const [testing, setTesting] = useState(false)
  const [connectionOk, setConnectionOk] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState(false)

  async function handleTestConnection() {
    if (!host.trim() || !port.trim()) {
      toast.error('请填写服务器地址和端口')
      return
    }
    setTesting(true)
    const serverUrl = buildServerUrl(host.trim(), port.trim())
    const ok = await testConnection(serverUrl)
    setTesting(false)
    setConnectionOk(ok)
    if (ok) {
      toast.success('连接成功')
      setStep(1)
    } else {
      toast.error('无法连接到服务器，请检查地址和端口')
    }
  }

  async function handleRegister() {
    if (!clientName.trim()) {
      toast.error('请填写客户端名称')
      return
    }
    const scopeList = scopes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (scopeList.length === 0) {
      toast.error('请至少填写一个 Scope')
      return
    }
    setRegistering(true)
    const serverUrl = buildServerUrl(host.trim(), port.trim())

    const baseCfg: PrizmConfig = {
      server: { host: host.trim(), port: port.trim() },
      client: {
        name: clientName.trim(),
        auto_register: 'true',
        requested_scopes: scopeList
      },
      api_key: '',
      tray: {
        enabled: 'true',
        minimize_to_tray: 'true',
        show_notification: 'true'
      },
      notify_events: ['notification', 'todo_list:updated']
    }
    await saveConfig(baseCfg)

    const apiKey = await registerClient(serverUrl, clientName.trim(), scopeList)
    setRegistering(false)
    if (apiKey) {
      setRegistered(true)
      toast.success('注册成功')
      setStep(2)
    } else {
      toast.error('注册失败，请检查服务器是否正常')
    }
  }

  async function handleFinish() {
    const cfg = await loadConfig()
    if (cfg) {
      setConfig(cfg)
    }
    onComplete()
    window.location.reload()
  }

  const inputVariant = 'filled' as const

  return (
    <div className="onboarding-wizard">
      <div className="onboarding-wizard__header">
        <Rocket size={28} style={{ color: 'var(--ant-color-primary)' }} />
        <h1 className="onboarding-wizard__title">欢迎使用 Prizm</h1>
        <p className="onboarding-wizard__subtitle">让我们完成初始配置，只需几步即可开始</p>
      </div>

      <Steps
        current={step}
        size="small"
        className="onboarding-wizard__steps"
        items={[
          { title: '连接服务器', icon: <Globe size={16} /> },
          { title: '注册客户端', icon: <Key size={16} /> },
          { title: '完成', icon: <CheckCircle size={16} /> }
        ]}
      />

      <div className="onboarding-wizard__content">
        {step === 0 && (
          <div className="onboarding-wizard__step">
            <h3>连接到 Prizm 服务器</h3>
            <p className="form-hint">请填写 Prizm 服务端的地址和端口（默认 127.0.0.1:4127）</p>
            <Form className="compact-form" gap={8} layout="vertical">
              <Form.Item label="服务器地址">
                <Input
                  variant={inputVariant}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="127.0.0.1"
                />
              </Form.Item>
              <Form.Item label="端口">
                <Input
                  variant={inputVariant}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="4127"
                />
              </Form.Item>
            </Form>
            <div className="onboarding-wizard__actions">
              <Button
                type="primary"
                onClick={handleTestConnection}
                disabled={testing}
                loading={testing}
              >
                {testing ? '测试中...' : '测试连接'}
              </Button>
              {connectionOk && <Button onClick={() => setStep(1)}>下一步</Button>}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-wizard__step">
            <h3>注册客户端</h3>
            <p className="form-hint">给这个客户端起个名字，并选择要访问的工作区</p>
            <Form className="compact-form" gap={8} layout="vertical">
              <Form.Item label="客户端名称">
                <Input
                  variant={inputVariant}
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Prizm Electron Client"
                />
              </Form.Item>
              <Form.Item
                label="工作区 Scopes（逗号分隔）"
                extra="default 为默认工作区，online 为实时上下文"
              >
                <Input
                  variant={inputVariant}
                  value={scopes}
                  onChange={(e) => setScopes(e.target.value)}
                  placeholder="default, online"
                />
              </Form.Item>
            </Form>
            <div className="onboarding-wizard__actions">
              <Button onClick={() => setStep(0)}>上一步</Button>
              <Button
                type="primary"
                onClick={handleRegister}
                disabled={registering}
                loading={registering}
              >
                {registering ? '注册中...' : '注册'}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-wizard__step onboarding-wizard__step--done">
            <CheckCircle size={48} style={{ color: 'var(--ant-color-success)' }} />
            <h3>配置完成</h3>
            <p className="form-hint">一切就绪，点击下方按钮开始使用 Prizm。</p>
            <div className="onboarding-wizard__actions">
              <Button type="primary" size="large" onClick={handleFinish}>
                开始使用
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
