/**
 * WebSocket 桥接事件处理器
 *
 * 将内部领域事件映射为客户端 WebSocket 通知事件。
 * 统一管理所有从 EventBus → WebSocket 的广播，
 * 替代原来分散在 server.ts 和各路由中的 builtinToolEvents 桥接逻辑。
 */

import { subscribe } from '../eventBus'
import { EVENT_TYPES_OBJ, type EventType } from '@prizm/shared'
import type { WebSocketServer } from '../../../websocket/WebSocketServer'
import { createLogger } from '../../../logger'

const log = createLogger('WSBridge')

/** WebSocket 服务器引用（延迟注入，因为 WS 在 listen 后才创建） */
let wsServer: WebSocketServer | undefined

/**
 * 设置 WebSocket 服务器引用。
 * 在 server.start() 中 WebSocket 初始化后调用。
 */
export function setWebSocketServer(ws: WebSocketServer | undefined): void {
  wsServer = ws
}

/**
 * 注册 WebSocket 桥接事件订阅。
 * 在 server 启动时调用一次。
 */
export function registerWSBridgeHandlers(): void {
  // 文件操作 → 客户端通知
  subscribe(
    'file:operation',
    (data) => {
      if (!wsServer) return
      const eventTypeMap: Record<string, string> = {
        created: EVENT_TYPES_OBJ.FILE_CREATED,
        moved: EVENT_TYPES_OBJ.FILE_MOVED,
        deleted: EVENT_TYPES_OBJ.FILE_DELETED
      }
      const wsEventType = eventTypeMap[data.action]
      if (wsEventType) {
        wsServer.broadcast(
          wsEventType as EventType,
          {
            relativePath: data.relativePath,
            fromPath: data.fromPath,
            scope: data.scope
          },
          data.scope
        )
      }
    },
    'wsBridge.file'
  )

  // 资源锁变更 → 客户端通知
  subscribe(
    'resource:lock.changed',
    (data) => {
      if (!wsServer) return
      const eventType =
        data.action === 'locked'
          ? EVENT_TYPES_OBJ.RESOURCE_LOCKED
          : EVENT_TYPES_OBJ.RESOURCE_UNLOCKED
      wsServer.broadcast(
        eventType as EventType,
        {
          resourceType: data.resourceType,
          resourceId: data.resourceId,
          sessionId: data.sessionId,
          reason: data.reason,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.lock'
  )

  // 文档保存 → 客户端通知（区分创建/更新）
  subscribe(
    'document:saved',
    (data) => {
      if (!wsServer) return
      // 判断是创建还是更新：有 previousContent 或 version>1 视为更新
      const isUpdate =
        data.previousContent !== undefined || (data.version !== undefined && data.version > 1)
      const eventType = isUpdate
        ? EVENT_TYPES_OBJ.DOCUMENT_UPDATED
        : EVENT_TYPES_OBJ.DOCUMENT_CREATED
      wsServer.broadcast(
        eventType as EventType,
        {
          id: data.documentId,
          scope: data.scope,
          title: data.title,
          sourceClientId: data.actor?.clientId
        },
        data.scope
      )
    },
    'wsBridge.documentSaved'
  )

  // 文档删除 → 客户端通知
  subscribe(
    'document:deleted',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.DOCUMENT_DELETED as EventType,
        {
          id: data.documentId,
          scope: data.scope,
          sourceClientId: data.actor?.clientId
        },
        data.scope
      )
    },
    'wsBridge.documentDeleted'
  )

  // Todo 变更 → 客户端通知
  subscribe(
    'todo:mutated',
    (data) => {
      if (!wsServer) return
      const eventTypeMap: Record<string, Record<string, string | undefined>> = {
        list: {
          created: EVENT_TYPES_OBJ.TODO_LIST_CREATED,
          updated: EVENT_TYPES_OBJ.TODO_LIST_UPDATED,
          deleted: EVENT_TYPES_OBJ.TODO_LIST_DELETED
        },
        item: {
          created: EVENT_TYPES_OBJ.TODO_ITEM_CREATED,
          updated: EVENT_TYPES_OBJ.TODO_ITEM_UPDATED,
          deleted: EVENT_TYPES_OBJ.TODO_ITEM_DELETED
        }
      }
      const wsEventType = eventTypeMap[data.resourceType]?.[data.action]
      if (wsEventType) {
        wsServer.broadcast(
          wsEventType as EventType,
          {
            listId: data.listId,
            itemId: data.itemId,
            scope: data.scope,
            sourceClientId: data.actor?.clientId,
            title: data.title,
            status: data.status,
            description: data.description,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt
          },
          data.scope
        )
      }
    },
    'wsBridge.todoMutated'
  )

  // Clipboard 变更 → 客户端通知
  subscribe(
    'clipboard:mutated',
    (data) => {
      if (!wsServer) return
      const eventType =
        data.action === 'added'
          ? EVENT_TYPES_OBJ.CLIPBOARD_ITEM_ADDED
          : EVENT_TYPES_OBJ.CLIPBOARD_ITEM_DELETED
      wsServer.broadcast(
        eventType as EventType,
        {
          id: data.itemId,
          scope: data.scope,
          sourceClientId: data.actor?.clientId,
          type: data.itemType,
          content: data.content,
          sourceApp: data.sourceApp,
          createdAt: data.createdAt
        },
        data.scope
      )
    },
    'wsBridge.clipboardMutated'
  )

  // Agent 会话创建 → 客户端通知
  subscribe(
    'agent:session.created',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.AGENT_SESSION_CREATED as EventType,
        {
          sessionId: data.sessionId,
          scope: data.scope,
          sourceClientId: data.actor?.clientId
        },
        data.scope
      )
    },
    'wsBridge.agentSessionCreated'
  )

  // Agent 会话删除 → 客户端通知
  subscribe(
    'agent:session.deleted',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.AGENT_SESSION_DELETED as EventType,
        {
          sessionId: data.sessionId,
          scope: data.scope,
          sourceClientId: data.actor?.clientId
        },
        data.scope
      )
    },
    'wsBridge.agentSessionDeleted'
  )

  // Agent 会话回退 → 客户端通知
  subscribe(
    'agent:session.rolledBack',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.AGENT_SESSION_ROLLED_BACK as EventType,
        {
          sessionId: data.sessionId,
          scope: data.scope,
          checkpointId: data.checkpointId,
          remainingMessageCount: data.remainingMessageCount,
          sourceClientId: data.actor?.clientId
        },
        data.scope
      )
    },
    'wsBridge.agentSessionRolledBack'
  )

  // Agent 会话对话状态变更 → 客户端通知
  subscribe(
    'agent:session.chatStatusChanged',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.AGENT_SESSION_CHAT_STATUS_CHANGED as EventType,
        {
          sessionId: data.sessionId,
          chatStatus: data.chatStatus,
          scope: data.scope,
          sourceClientId: data.actor?.clientId
        },
        data.scope
      )
    },
    'wsBridge.agentSessionChatStatusChanged'
  )

  // Agent 消息完成 → 客户端通知
  subscribe(
    'agent:message.completed',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.AGENT_MESSAGE_COMPLETED as EventType,
        {
          sessionId: data.sessionId,
          scope: data.scope,
          sourceClientId: data.actor?.clientId
        },
        data.scope
      )
    },
    'wsBridge.agentMessageCompleted'
  )

  // BG Session 生命周期 → 客户端通知
  const bgEvents = [
    'bg:session.completed',
    'bg:session.failed',
    'bg:session.timeout',
    'bg:session.cancelled'
  ] as const

  for (const eventName of bgEvents) {
    subscribe(
      eventName,
      (data) => {
        if (!wsServer) return
        const wsEventName =
          EVENT_TYPES_OBJ[
            eventName.replace(/[:.]/g, '_').toUpperCase() as keyof typeof EVENT_TYPES_OBJ
          ]
        if (wsEventName) {
          wsServer.broadcast(wsEventName as EventType, { ...data }, data.scope)
        }
      },
      `wsBridge.${eventName}`
    )
  }

  // Schedule 事件 → 客户端通知
  subscribe(
    'schedule:created',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.SCHEDULE_CREATED as EventType,
        {
          scheduleId: data.scheduleId,
          title: data.title,
          type: data.type,
          startTime: data.startTime,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.scheduleCreated'
  )

  subscribe(
    'schedule:updated',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.SCHEDULE_UPDATED as EventType,
        {
          scheduleId: data.scheduleId,
          title: data.title,
          status: data.status,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.scheduleUpdated'
  )

  subscribe(
    'schedule:deleted',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.SCHEDULE_DELETED as EventType,
        { scheduleId: data.scheduleId, scope: data.scope },
        data.scope
      )
    },
    'wsBridge.scheduleDeleted'
  )

  subscribe(
    'schedule:reminded',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.SCHEDULE_REMINDED as EventType,
        {
          scheduleId: data.scheduleId,
          title: data.title,
          startTime: data.startTime,
          reminderMinutes: data.reminderMinutes,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.scheduleReminded'
  )

  // Cron Job 创建 → 客户端通知
  subscribe(
    'cron:job.created',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.CRON_JOB_CREATED as EventType,
        {
          jobId: data.jobId,
          name: data.name,
          schedule: data.schedule,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.cronJobCreated'
  )

  // Cron Job 执行 → 客户端通知
  subscribe(
    'cron:job.executed',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.CRON_JOB_EXECUTED as EventType,
        {
          jobId: data.jobId,
          sessionId: data.sessionId,
          status: data.status,
          durationMs: data.durationMs,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.cronJobExecuted'
  )

  // Cron Job 失败 → 客户端通知
  subscribe(
    'cron:job.failed',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.CRON_JOB_FAILED as EventType,
        {
          jobId: data.jobId,
          error: data.error,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.cronJobFailed'
  )

  // 文档记忆更新 → 客户端通知
  subscribe(
    'document:memory.updated',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.DOCUMENT_MEMORY_UPDATED as EventType,
        {
          documentId: data.documentId,
          title: data.title,
          updatedSubTypes: data.updatedSubTypes,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.documentMemoryUpdated'
  )

  // ─── Workflow 事件 → 客户端实时更新 ───

  subscribe(
    'workflow:started',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.WORKFLOW_STARTED as EventType,
        { runId: data.runId, workflowName: data.workflowName, scope: data.scope },
        data.scope
      )
    },
    'wsBridge.workflowStarted'
  )

  subscribe(
    'workflow:step.completed',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.WORKFLOW_STEP_COMPLETED as EventType,
        {
          runId: data.runId,
          stepId: data.stepId,
          stepStatus: data.stepStatus,
          outputPreview: data.outputPreview,
          approved: data.approved,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.workflowStepCompleted'
  )

  subscribe(
    'workflow:paused',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.WORKFLOW_PAUSED as EventType,
        {
          runId: data.runId,
          workflowName: data.workflowName,
          stepId: data.stepId,
          approvePrompt: data.approvePrompt,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.workflowPaused'
  )

  subscribe(
    'workflow:completed',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.WORKFLOW_COMPLETED as EventType,
        {
          runId: data.runId,
          workflowName: data.workflowName,
          finalOutput: data.finalOutput,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.workflowCompleted'
  )

  subscribe(
    'workflow:failed',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.WORKFLOW_FAILED as EventType,
        {
          runId: data.runId,
          workflowName: data.workflowName,
          error: data.error,
          scope: data.scope
        },
        data.scope
      )
    },
    'wsBridge.workflowFailed'
  )

  // ─── Task 事件 ───

  subscribe(
    'task:started',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.TASK_STARTED as EventType,
        { taskId: data.taskId, label: data.label, scope: data.scope },
        data.scope
      )
    },
    'wsBridge.taskStarted'
  )

  subscribe(
    'task:completed',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.TASK_COMPLETED as EventType,
        { taskId: data.taskId, label: data.label, durationMs: data.durationMs, scope: data.scope },
        data.scope
      )
    },
    'wsBridge.taskCompleted'
  )

  subscribe(
    'task:failed',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.TASK_FAILED as EventType,
        { taskId: data.taskId, label: data.label, error: data.error, scope: data.scope },
        data.scope
      )
    },
    'wsBridge.taskFailed'
  )

  subscribe(
    'task:cancelled',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        EVENT_TYPES_OBJ.TASK_CANCELLED as EventType,
        { taskId: data.taskId, label: data.label, scope: data.scope },
        data.scope
      )
    },
    'wsBridge.taskCancelled'
  )

  // ─── Notification 事件 ───

  subscribe(
    'notification:requested',
    (data) => {
      if (!wsServer) return
      wsServer.broadcast(
        'notification' as EventType,
        { title: data.title, body: data.body, source: data.source, scope: data.scope },
        data.scope
      )
    },
    'wsBridge.notificationRequested'
  )

  log.info('WebSocket bridge event handlers registered')
}
