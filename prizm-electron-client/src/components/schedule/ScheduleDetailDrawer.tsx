/**
 * ScheduleDetailDrawer — 日程详情查看 + 编辑抽屉
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import { Button, Icon, toast } from '@lobehub/ui'
import { Modal, Drawer, Tag, Form, Input, DatePicker, Switch, Descriptions, Divider, Space } from 'antd'
import {
  Calendar,
  Check,
  Clock,
  Edit3,
  Link2,
  Repeat,
  Save,
  Trash2,
  X,
  AlertTriangle,
  Bell
} from 'lucide-react'
import { Select } from '../ui/Select'
import {
  SCHEDULE_TYPE_META,
  SCHEDULE_STATUS_META,
  REMINDER_OPTIONS,
  getRecurrenceLabel
} from './types'
import { useScheduleStore } from '../../store/scheduleStore'
import type { ScheduleItem } from '@prizm/shared'
import dayjs from 'dayjs'

interface ScheduleDetailDrawerProps {
  open: boolean
  scheduleId: string | null
  onClose: () => void
}

export function ScheduleDetailDrawer({ open, scheduleId, onClose }: ScheduleDetailDrawerProps) {
  const schedules = useScheduleStore((s) => s.schedules)
  const updateSchedule = useScheduleStore((s) => s.updateSchedule)
  const deleteSchedule = useScheduleStore((s) => s.deleteSchedule)
  const [editing, setEditing] = useState(false)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  const item = useMemo(
    () => (scheduleId ? schedules.find((s) => s.id === scheduleId) : null) ?? null,
    [scheduleId, schedules]
  )

  useEffect(() => {
    if (!open) {
      setEditing(false)
    }
  }, [open])

  const handleEdit = useCallback(() => {
    if (!item) return
    form.setFieldsValue({
      title: item.title,
      description: item.description ?? '',
      type: item.type,
      startTime: dayjs(item.startTime),
      endTime: item.endTime ? dayjs(item.endTime) : undefined,
      allDay: item.allDay ?? false,
      status: item.status,
      tags: item.tags?.join(', ') ?? ''
    })
    setEditing(true)
  }, [item, form])

  const handleSave = useCallback(async () => {
    if (!item) return
    try {
      const values = await form.validateFields()
      setSaving(true)
      const tags = values.tags
        ? values.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
        : undefined
      await updateSchedule(item.id, {
        title: values.title,
        description: values.description || undefined,
        type: values.type,
        startTime: values.startTime.valueOf(),
        endTime: values.endTime?.valueOf() ?? null,
        allDay: values.allDay,
        status: values.status,
        tags
      })
      toast.success('日程已更新')
      setEditing(false)
    } catch {
      /* validation */
    } finally {
      setSaving(false)
    }
  }, [item, form, updateSchedule])

  const handleComplete = useCallback(async () => {
    if (!item) return
    await updateSchedule(item.id, { status: 'completed' })
    toast.success('已标记完成')
  }, [item, updateSchedule])

  const handleDelete = useCallback(() => {
    if (!item) return
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除「${item.title}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteSchedule(item.id)
        toast.success('已删除')
        onClose()
      }
    })
  }, [item, deleteSchedule, onClose])

  const handleCancelEdit = useCallback(() => {
    setEditing(false)
  }, [])

  if (!item) {
    return (
      <Drawer open={open} onClose={onClose} title="日程详情" size={420}>
        <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>日程不存在</div>
      </Drawer>
    )
  }

  const typeMeta = SCHEDULE_TYPE_META[item.type] ?? { color: 'default', label: item.type }
  const statusMeta = SCHEDULE_STATUS_META[item.status] ?? { color: 'default', label: item.status }
  const isFinished = item.status === 'completed' || item.status === 'cancelled'
  const recLabel = getRecurrenceLabel(item)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div className="sc-drawer__title-row">
          <Icon icon={Calendar} size={18} />
          <span>{editing ? '编辑日程' : '日程详情'}</span>
        </div>
      }
      size={420}
      extra={
        editing ? (
          <Space>
            <Button size="small" onClick={handleCancelEdit}>取消</Button>
            <Button size="small" type="primary" loading={saving} onClick={handleSave}>
              <Icon icon={Save} size={12} /> 保存
            </Button>
          </Space>
        ) : (
          <Space>
            {!isFinished && (
              <Button size="small" onClick={handleComplete}>
                <Icon icon={Check} size={12} /> 完成
              </Button>
            )}
            <Button size="small" onClick={handleEdit}>
              <Icon icon={Edit3} size={12} /> 编辑
            </Button>
            <Button size="small" danger onClick={handleDelete}>
              <Icon icon={Trash2} size={12} />
            </Button>
          </Space>
        )
      }
    >
      {editing ? (
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
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
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'upcoming', label: '即将到来' },
                { value: 'active', label: '进行中' },
                { value: 'completed', label: '已完成' },
                { value: 'cancelled', label: '已取消' }
              ]}
            />
          </Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="startTime" label="开始" rules={[{ required: true }]} style={{ flex: 1 }}>
              <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="endTime" label="结束" style={{ flex: 1 }}>
              <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="allDay" label="全天" valuePropName="checked">
            <Switch size="small" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input placeholder="逗号分隔" />
          </Form.Item>
        </Form>
      ) : (
        <div className="sc-drawer__view">
          <h3 className="sc-drawer__item-title">{item.title}</h3>

          <div className="sc-drawer__tag-row">
            <Tag color={typeMeta.color}>{typeMeta.label}</Tag>
            <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
            {recLabel && <Tag color="purple"><Icon icon={Repeat} size={10} /> {recLabel}</Tag>}
          </div>

          <Descriptions column={1} size="small" className="sc-drawer__desc-table">
            <Descriptions.Item label="开始时间">
              {item.allDay
                ? dayjs(item.startTime).format('YYYY-MM-DD (全天)')
                : dayjs(item.startTime).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
            {item.endTime && (
              <Descriptions.Item label="结束时间">
                {item.allDay
                  ? dayjs(item.endTime).format('YYYY-MM-DD')
                  : dayjs(item.endTime).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            )}
            {item.endTime && !item.allDay && (
              <Descriptions.Item label="时长">
                {Math.round((item.endTime - item.startTime) / 60000)} 分钟
              </Descriptions.Item>
            )}
            {item.completedAt && (
              <Descriptions.Item label="完成时间">
                {dayjs(item.completedAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="创建时间">
              {dayjs(item.createdAt).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
          </Descriptions>

          {item.description && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <div className="sc-drawer__description">{item.description}</div>
            </>
          )}

          {item.reminders && item.reminders.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <div className="sc-drawer__section">
                <div className="sc-drawer__section-title">
                  <Icon icon={Bell} size={14} /> 提醒
                </div>
                <div className="sc-drawer__reminder-list">
                  {item.reminders.map((m) => {
                    const opt = REMINDER_OPTIONS.find((o) => o.value === m)
                    return (
                      <Tag key={m} style={{ margin: '2px 4px 2px 0' }}>
                        {opt?.label ?? `${m} 分钟前`}
                      </Tag>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {item.linkedItems && item.linkedItems.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <div className="sc-drawer__section">
                <div className="sc-drawer__section-title">
                  <Icon icon={Link2} size={14} /> 关联项
                </div>
                <div className="sc-drawer__linked-list">
                  {item.linkedItems.map((link) => (
                    <Tag key={`${link.type}-${link.id}`}>
                      {link.type === 'todo' ? '待办' : '文档'}: {link.title || link.id}
                    </Tag>
                  ))}
                </div>
              </div>
            </>
          )}

          {item.tags && item.tags.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <div className="sc-drawer__section">
                <div className="sc-drawer__section-title">标签</div>
                <div>
                  {item.tags.map((t) => <Tag key={t} style={{ margin: '2px 4px 2px 0' }}>{t}</Tag>)}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  )
}
