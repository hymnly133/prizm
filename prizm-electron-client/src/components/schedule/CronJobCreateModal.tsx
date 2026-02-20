/**
 * CronJobCreateModal — 创建定时任务对话框
 */
import { useState, useCallback } from 'react'
import { Modal, toast } from '@lobehub/ui'
import { Form, Input } from 'antd'
import { Select } from '../ui/Select'
import { useScheduleStore } from '../../store/scheduleStore'

const CRON_PRESETS = [
  { value: '*/5 * * * *', label: '每 5 分钟' },
  { value: '*/30 * * * *', label: '每 30 分钟' },
  { value: '0 * * * *', label: '每小时' },
  { value: '0 9 * * *', label: '每天 9:00' },
  { value: '0 9 * * 1', label: '每周一 9:00' },
  { value: '0 0 1 * *', label: '每月 1 号' }
]

interface CronJobCreateModalProps {
  open: boolean
  onClose: () => void
}

export function CronJobCreateModal({ open, onClose }: CronJobCreateModalProps) {
  const [form] = Form.useForm()
  const createCronJob = useScheduleStore((s) => s.createCronJob)
  const [submitting, setSubmitting] = useState(false)

  const handleOk = useCallback(async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const result = await createCronJob({
        name: values.name,
        schedule: values.schedule,
        taskPrompt: values.taskPrompt,
        description: values.description || undefined,
        executionMode: values.executionMode || 'isolated'
      })
      if (result) {
        toast.success('定时任务已创建')
        form.resetFields()
        onClose()
      }
    } catch {
      /* validation */
    } finally {
      setSubmitting(false)
    }
  }, [form, createCronJob, onClose])

  const handleCancel = useCallback(() => {
    form.resetFields()
    onClose()
  }, [form, onClose])

  const handlePresetSelect = useCallback(
    (value: string) => {
      form.setFieldsValue({ schedule: value })
    },
    [form]
  )

  return (
    <Modal
      title="创建定时任务"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={submitting}
      destroyOnClose
      width={520}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ executionMode: 'isolated' }}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入任务名称' }]}>
          <Input placeholder="定时任务名称" />
        </Form.Item>

        <Form.Item label="快捷设置">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CRON_PRESETS.map((p) => (
              <button
                key={p.value}
                className="sc-cron-preset-btn"
                type="button"
                onClick={() => handlePresetSelect(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Form.Item>

        <Form.Item
          name="schedule"
          label="Cron 表达式"
          rules={[{ required: true, message: '请输入 cron 表达式' }]}
          extra="标准 5 段 cron：分 时 日 月 周"
        >
          <Input placeholder="*/30 * * * *" style={{ fontFamily: 'monospace' }} />
        </Form.Item>

        <Form.Item
          name="taskPrompt"
          label="任务描述 (Agent 提示词)"
          rules={[{ required: true, message: '请输入任务描述' }]}
        >
          <Input.TextArea rows={4} placeholder="Agent 执行此任务时的提示词" />
        </Form.Item>

        <Form.Item name="description" label="备注">
          <Input placeholder="可选备注" />
        </Form.Item>

        <Form.Item name="executionMode" label="执行模式">
          <Select
            options={[
              { value: 'isolated', label: '独立会话' },
              { value: 'main', label: '主会话' }
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
