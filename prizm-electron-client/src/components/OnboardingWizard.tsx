import { Button, Form, Input, toast } from '@lobehub/ui'
import { Segmented } from 'antd'
import { Steps } from 'antd'
import { useState, useEffect } from 'react'
import { CheckCircle, Globe, Key, Rocket, User, Zap } from 'lucide-react'
import { buildServerUrl } from '@prizm/client-core'
import type { PrizmConfig } from '@prizm/client-core'

export interface UserProfilePatch {
  displayName?: string
  preferredTone?: string
}

interface OnboardingWizardProps {
  onComplete: () => void
  testConnection: (serverUrl: string) => Promise<boolean>
  registerClient: (serverUrl: string, name: string, scopes: string[]) => Promise<string | null>
  saveConfig: (cfg: PrizmConfig) => Promise<boolean>
  loadConfig: () => Promise<PrizmConfig | null>
  setConfig: (cfg: PrizmConfig) => void
  /** 更新用户画像（显示名称、语气），完成注册后可用 */
  updateUserProfile?: (patch: UserProfilePatch) => Promise<void>
  /** 已连接用户直接进入「认识你」步骤时传入 2 */
  initialStep?: number
}

const TONE_PRESETS = ['简洁专业', '友好随意', '中性克制'] as const

export function OnboardingWizard({
  onComplete,
  testConnection,
  registerClient,
  saveConfig,
  loadConfig,
  setConfig,
  updateUserProfile,
  initialStep
}: OnboardingWizardProps) {
  const [step, setStep] = useState(initialStep ?? 0)
  useEffect(() => {
    if (initialStep !== undefined) setStep(initialStep)
  }, [initialStep])
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('4127')
  const [clientName, setClientName] = useState('Prizm Electron Client')
  const [scopes, setScopes] = useState('default, online')
  const [testing, setTesting] = useState(false)
  const [connectionOk, setConnectionOk] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [autoDetecting, setAutoDetecting] = useState(true)
  const [profileDisplayName, setProfileDisplayName] = useState('')
  const [profileTone, setProfileTone] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)

  // 第一步挂载时自动检测当前地址是否已有服务端
  useEffect(() => {
    if (step !== 0 || !host?.trim() || !port?.trim()) {
      setAutoDetecting(false)
      return
    }
    const url = buildServerUrl(host.trim(), port.trim())
    testConnection(url).then((ok) => {
      setAutoDetecting(false)
      if (ok) {
        setConnectionOk(true)
        toast.success('已检测到本机服务端，可点击「下一步」或使用一键连接')
      }
    })
  }, [step, host, port, testConnection])

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
      toast.info('请确认 Prizm 服务端已启动（在本机可运行 yarn dev:server 或 yarn start）')
    }
  }

  async function handleRegister(): Promise<boolean> {
    if (!clientName.trim()) {
      toast.error('请填写客户端名称')
      return false
    }
    const scopeList = scopes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (scopeList.length === 0) {
      toast.error('请至少填写一个 Scope')
      return false
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
      const updatedCfg = { ...baseCfg, api_key: apiKey }
      await saveConfig(updatedCfg)
      const loaded = await loadConfig()
      setConfig(loaded ?? updatedCfg)
      setStep(2)
      return true
    }
    toast.error('注册失败，请检查服务器是否正常')
    return false
  }

  /** 一键：测试连接 → 注册 → 进入「认识你」步骤（检测到服务端时可用） */
  async function handleOneClick() {
    const serverUrl = buildServerUrl(host.trim(), port.trim())
    if (!host.trim() || !port.trim()) {
      toast.error('请填写服务器地址和端口')
      return
    }
    setTesting(true)
    const ok = await testConnection(serverUrl)
    setTesting(false)
    if (!ok) {
      setConnectionOk(false)
      toast.error('无法连接到服务器，请检查地址和端口')
      toast.info('请确认 Prizm 服务端已启动（在本机可运行 yarn dev:server 或 yarn start）')
      return
    }
    setConnectionOk(true)
    await handleRegister()
  }

  async function handleProfileNext() {
    if (updateUserProfile && (profileDisplayName.trim() || profileTone.trim())) {
      setProfileSaving(true)
      try {
        await updateUserProfile({
          displayName: profileDisplayName.trim() || undefined,
          preferredTone: profileTone.trim() || undefined
        })
        toast.success('已记住你的偏好')
      } catch {
        toast.error('保存偏好失败，可稍后在设置中修改')
      } finally {
        setProfileSaving(false)
      }
    }
    setStep(3)
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
          { title: '认识你', icon: <User size={16} /> },
          { title: '完成', icon: <CheckCircle size={16} /> }
        ]}
      />

      <div className="onboarding-wizard__content">
        {step === 0 && (
          <div className="onboarding-wizard__step">
            <h3>连接到 Prizm 服务器</h3>
            <p className="form-hint">
              请填写 Prizm 服务端的地址和端口（默认 127.0.0.1:4127）
              {autoDetecting && ' · 正在检测本机服务端…'}
            </p>
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
            {connectionOk && (
              <p className="form-hint" style={{ marginBottom: 8 }}>
                已检测到服务端，可使用「一键连接并注册」跳过后续步骤。
              </p>
            )}
            <div className="onboarding-wizard__actions">
              <Button
                type="primary"
                onClick={handleTestConnection}
                disabled={testing || registering}
                loading={testing}
              >
                {testing ? '测试中...' : '测试连接'}
              </Button>
              {connectionOk && (
                <>
                  <Button onClick={() => setStep(1)}>下一步</Button>
                  <Button
                    type="primary"
                    icon={<Zap size={14} />}
                    onClick={handleOneClick}
                    disabled={registering}
                    loading={registering}
                  >
                    {registering ? '注册中...' : '一键连接并注册'}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-wizard__step">
            <h3>注册客户端</h3>
            <p className="form-hint">给这个设备起个名字（可选），并选择要访问的工作区；称呼与语气在下一步设置</p>
            <Form className="compact-form" gap={8} layout="vertical">
              <Form.Item label="设备名称（可选）" extra="用于区分多设备">
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
          <div className="onboarding-wizard__step">
            <h3>认识你</h3>
            <p className="form-hint">你希望助手怎么称呼你？希望我用什么语气回复？（可跳过，稍后在设置中修改）</p>
            <Form className="compact-form" gap={8} layout="vertical">
              <Form.Item label="怎么称呼你">
                <Input
                  variant={inputVariant}
                  value={profileDisplayName}
                  onChange={(e) => setProfileDisplayName(e.target.value)}
                  placeholder="如：小明、Alex"
                />
              </Form.Item>
              <Form.Item label="希望的语气">
                <Segmented
                  value={TONE_PRESETS.includes(profileTone as (typeof TONE_PRESETS)[number]) ? profileTone : undefined}
                  onChange={(v) => setProfileTone(v as string)}
                  options={TONE_PRESETS.map((t) => ({ label: t, value: t }))}
                />
                <Input
                  variant={inputVariant}
                  value={TONE_PRESETS.includes(profileTone as (typeof TONE_PRESETS)[number]) ? '' : profileTone}
                  onChange={(e) => setProfileTone(e.target.value)}
                  placeholder="或输入自定义语气"
                  style={{ marginTop: 8 }}
                />
              </Form.Item>
            </Form>
            <div className="onboarding-wizard__actions">
              <Button onClick={() => setStep(1)}>上一步</Button>
              <Button
                type="primary"
                onClick={handleProfileNext}
                loading={profileSaving}
                disabled={profileSaving}
              >
                {profileSaving ? '保存中...' : '下一步'}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
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
