/**
 * ScheduleCreateModal — 创建日程对话框（完整表单）
 * 支持循环规则、提醒时间、关联项、标签、快捷时间按钮
 */
import { useState, useCallback } from 'react'
import { Button, Modal, toast } from '@lobehub/ui'
import {
  Form,
  Input,
  DatePicker,
  Switch,
  InputNumber,
  Checkbox,
  Space
} from 'antd'
import { Select } from '../ui/Select'
import { REMINDER_OPTIONS, DAY_LABELS } from './types'
import { useScheduleStore } from '../../store/scheduleStore'
import type { RecurrenceFrequency } from '@prizm/shared'
import dayjs from 'dayjs'

interface ScheduleCreateModalProps {
  open: boolean
  onClose: () => void
  initialDate?: number
}

export function ScheduleCreateModal({ open, onClose, initialDate }: ScheduleCreateModalProps) {
  const [form] = Form.useForm()
  const createSchedule = useScheduleStore((s) => s.createSchedule)
  const [submitting, setSubmitting] = useState(false)
  const [showRecurrence, setShowRecurrence] = useState(false)
  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceFrequency>('daily')

  const handleOk = useCallback(async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)

      const reminders = values.reminders?.length ? values.reminders : undefined
      const tags = values.tags
        ? values.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
        : undefined

      let recurrence = undefined
      if (showRecurrence) {
        recurrence = {
          frequency: recurrenceFreq,
          interval: values.recurrenceInterval ?? 1,
          ...(recurrenceFreq === 'weekly' && values.daysOfWeek?.length && {
            daysOfWeek: values.daysOfWeek
          }),
          ...(recurrenceFreq === 'monthly' && values.dayOfMonth && {
            dayOfMonth: values.dayOfMonth
          }),
          ...(values.recurrenceEndDate && {
            endDate: values.recurrenceEndDate.valueOf()
          })
        }
      }

      const result = await createSchedule({
        title: values.title,
        description: values.description,
        type: values.type || 'event',
        startTime: values.startTime.valueOf(),
        endTime: values.endTime?.valueOf(),
        allDay: values.allDay,
        reminders,
        tags,
        recurrence
      })

      if (result) {
        toast.success('日程已创建')
        form.resetFields()
        setShowRecurrence(false)
        onClose()
      }
    } catch {
      /* validation error */
    } finally {
      setSubmitting(false)
    }
  }, [form, createSchedule, onClose, showRecurrence, recurrenceFreq])

  const handleCancel = useCallback(() => {
    form.resetFields()
    setShowRecurrence(false)
    onClose()
  }, [form, onClose])

  const setQuickDate = useCallback(
    (offset: number) => {
      const d = dayjs().add(offset, 'day').startOf('day').hour(9)
      form.setFieldsValue({ startTime: d })
    },
    [form]
  )

  const initialStartTime = initialDate ? dayjs(initialDate).hour(9) : undefined

  return (
    <Modal
      title="创建日程"
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
        initialValues={{
          type: 'event',
          allDay: false,
          startTime: initialStartTime,
          recurrenceInterval: 1
        }}
        style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}
      >
        <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
          <Input placeholder="日程标题" />
        </Form.Item>

        <Form.Item name="type" label="类型">
          <Select
            options={[
              { value: 'event', label: '事件' },
              { value: 'reminder', label: '提醒' },
              { value: 'deadline', label: '截止日期' }
            ]}
          />
        </Form.Item>

        <div className="sc-create__quick-dates">
          <span className="sc-create__quick-label">快捷：</span>
          <Button size="small" type="text" onClick={() => setQuickDate(0)}>今天</Button>
          <Button size="small" type="text" onClick={() => setQuickDate(1)}>明天</Button>
          <Button size="small" type="text" onClick={() => {
            const now = dayjs()
            const nextMon = now.day() <= 1 ? now.day(1) : now.add(1, 'week').day(1)
            form.setFieldsValue({ startTime: nextMon.startOf('day').hour(9) })
          }}>下周一</Button>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item
            name="startTime"
            label="开始时间"
            rules={[{ required: true, message: '请选择时间' }]}
            style={{ flex: 1 }}
          >
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="endTime" label="结束时间" style={{ flex: 1 }}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <Form.Item name="allDay" label="全天事件" valuePropName="checked">
          <Switch size="small" />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="日程描述（可选）" />
        </Form.Item>

        <Form.Item name="reminders" label="提醒">
          <Checkbox.Group>
            <Space wrap>
              {REMINDER_OPTIONS.map((opt) => (
                <Checkbox key={opt.value} value={opt.value}>{opt.label}</Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </Form.Item>

        <Form.Item label="循环">
          <Switch
            size="small"
            checked={showRecurrence}
            onChange={setShowRecurrence}
            checkedChildren="开"
            unCheckedChildren="关"
          />
        </Form.Item>

        {showRecurrence && (
          <div className="sc-create__recurrence">
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <Select
                value={recurrenceFreq}
                onChange={(v) => setRecurrenceFreq(v as RecurrenceFrequency)}
                options={[
                  { value: 'daily', label: '每天' },
                  { value: 'weekly', label: '每周' },
                  { value: 'monthly', label: '每月' },
                  { value: 'yearly', label: '每年' }
                ]}
                style={{ width: 120 }}
              />
              <Form.Item name="recurrenceInterval" noStyle>
                <InputNumber min={1} max={99} style={{ width: 80 }} addonAfter="次" />
              </Form.Item>
            </div>

            {recurrenceFreq === 'weekly' && (
              <Form.Item name="daysOfWeek" label="重复日">
                <Checkbox.Group>
                  <Space>
                    {DAY_LABELS.map((label, i) => (
                      <Checkbox key={i} value={i}>{label}</Checkbox>
                    ))}
                  </Space>
                </Checkbox.Group>
              </Form.Item>
            )}

            {recurrenceFreq === 'monthly' && (
              <Form.Item name="dayOfMonth" label="每月第几天">
                <InputNumber min={1} max={31} style={{ width: 100 }} />
              </Form.Item>
            )}

            <Form.Item name="recurrenceEndDate" label="截止日期">
              <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} placeholder="不设置则无限循环" />
            </Form.Item>
          </div>
        )}

        <Form.Item name="tags" label="标签">
          <Input placeholder="用逗号分隔，如：工作,重要" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
