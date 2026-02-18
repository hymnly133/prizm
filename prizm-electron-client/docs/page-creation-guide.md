# Prizm Electron Client — 页面创建手册

本文档基于实际开发实践总结，为在 Prizm Electron Client 中创建新页面提供完整指引。

---

## 目录

1. [架构概览](#架构概览)
2. [创建新页面的完整步骤](#创建新页面的完整步骤)
3. [页面导航系统](#页面导航系统)
4. [Keep-Alive 机制](#keep-alive-机制)
5. [Header Slots（标题栏插槽）](#header-slots标题栏插槽)
6. [侧边栏（ResizableSidebar）](#侧边栏resizablesidebar)
7. [样式规范](#样式规范)
8. [设置页模式](#设置页模式)
9. [跨页面导航与数据传递](#跨页面导航与数据传递)
10. [Dirty 保护（离开前确认）](#dirty-保护离开前确认)
11. [常用 Hooks 与 Context](#常用-hooks-与-context)
12. [Checklist](#checklist)

---

## 架构概览

```
src/
├── views/                    # 页面级组件（顶层路由单元）
│   ├── HomePage.tsx
│   ├── WorkPage.tsx
│   ├── DocumentEditorPage.tsx
│   ├── AgentPage.tsx
│   ├── UserPage.tsx
│   ├── SettingsPage.tsx
│   └── DevToolsPage.tsx
├── components/               # 可复用组件
│   ├── layout/               # 布局组件（AppHeader, ResizableSidebar）
│   ├── ui/                   # 基础 UI 组件（EmptyState, SectionHeader 等）
│   ├── editor/               # 编辑器组件
│   └── ...
├── context/                  # React Context
│   ├── NavigationContext.tsx  # 跨页面导航
│   ├── HeaderSlotsContext.tsx # 标题栏自定义插槽
│   ├── PrizmContext.tsx       # 服务端连接管理
│   ├── ScopeContext.tsx       # 工作区 Scope
│   └── ...
├── hooks/                    # 自定义 Hooks
│   ├── useHashRoute.ts       # Hash 路由
│   ├── useScope.ts           # 当前 Scope
│   └── ...
├── styles/                   # CSS 样式文件（按页面/功能划分）
│   ├── shell.css             # 全局壳层（app-layout, page-keep-alive）
│   ├── home.css
│   ├── work.css
│   ├── document.css
│   ├── agent.css
│   ├── settings.css
│   └── ...
└── App.tsx                   # 根组件：导航、keep-alive 挂载、Provider 树
```

**技术栈：**

| 层面       | 技术                                                         |
| ---------- | ------------------------------------------------------------ |
| UI 组件库  | `@lobehub/ui`（Button, Flexbox, ActionIcon, Segmented 等）   |
| 辅助 UI    | `antd`（Modal, Dropdown, Select, Tree）                      |
| CSS-in-JS  | `antd-style` 的 `createStyles` / `createStaticStyles`        |
| 动画       | `motion/react`（Framer Motion v12）                          |
| 状态管理   | React hooks + Zustand（agentSessionStore 等）                |
| 图标       | `lucide-react`                                               |

---

## 创建新页面的完整步骤

以添加一个名为 `'example'` 的新页面为例。

### Step 1: 创建页面组件

```tsx
// src/views/ExamplePage.tsx
import { memo } from 'react'

function ExamplePage() {
  return (
    <section className="example-page">
      <h1>Example</h1>
    </section>
  )
}

export default memo(ExamplePage)
```

> **约定**：页面组件用 `memo()` 包裹导出，减少 keep-alive 状态下不必要的重渲染。

### Step 2: 注册 PageKey

在以下 **三个文件** 中同步更新 `PageKey` 类型：

#### `src/App.tsx`

```tsx
type PageKey = 'home' | 'work' | 'docs' | 'agent' | 'user' | 'settings' | 'test' | 'example'
```

#### `src/hooks/useHashRoute.ts`

```tsx
type PageKey = 'home' | 'work' | 'docs' | 'agent' | 'user' | 'settings' | 'test' | 'example'

const VALID_PAGES = new Set<string>([
  'home', 'work', 'docs', 'agent', 'user', 'settings', 'test', 'example'
])
```

#### `src/components/CommandPalette.tsx`

```tsx
type PageKey = 'home' | 'work' | 'docs' | 'agent' | 'user' | 'settings' | 'test' | 'example'
```

> **注意**：这三处 `PageKey` 目前是各自独立定义的（非共享类型），修改时必须全部同步。

### Step 3: 添加顶部导航项（可选）

如果页面需要在顶部导航栏显示：

```tsx
// src/App.tsx
import { Beaker } from 'lucide-react' // 选择合适的图标

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: LucideIcon }> = [
  { key: 'home', label: '主页', icon: Home },
  { key: 'work', label: '工作', icon: LayoutDashboard },
  { key: 'docs', label: '文档', icon: FileText },
  { key: 'agent', label: 'Agent', icon: Bot },
  { key: 'user', label: '用户', icon: User },
  { key: 'example', label: '示例', icon: Beaker }  // ← 新增
]
```

不需要顶部导航的页面（如 `settings`、`test`）不加入 `NAV_ITEMS`，通过其他入口（ActionIcon、CommandPalette 等）导航。

### Step 4: 挂载到 Keep-Alive 系统

在 `App.tsx` 的 `<div className="app-main">` 中添加：

```tsx
{mounted.has('example') && (
  <div
    className={`page-keep-alive${
      activePage !== 'example' ? ' page-keep-alive--hidden' : ''
    }`}
  >
    <ExamplePage />
  </div>
)}
```

### Step 5: 配置预加载（可选）

高频访问的页面加入空闲预加载列表：

```tsx
const PRELOAD_PAGES: PageKey[] = ['work', 'docs', 'agent', 'example']
```

低频页面（如 `settings`、`test`）不加入预加载——首次访问时才挂载。

### Step 6: 添加样式文件

```css
/* src/styles/example.css */
.example-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
```

在 `src/styles/index.css` 中导入：

```css
@import './example.css';
```

---

## 页面导航系统

### Hash 路由

应用使用轻量的 hash-based 路由（`#/home`、`#/work`、`#/docs` 等），由 `useHashRoute` hook 管理：

- URL hash 和 `activePage` state 双向同步
- 支持浏览器前进/后退
- 支持 `PAGE_ALIASES` 做旧路由重定向

### 页面切换

所有页面切换必须通过 `setActivePageSafe()`，它提供：

- `startTransition` 包裹避免阻塞
- **Dirty 保护**：离开编辑中的页面时弹出确认对话框

```tsx
// 正确 ✅
const navigateToExample = useCallback(
  () => setActivePageSafe('example'),
  [setActivePageSafe]
)

// 错误 ❌ — 跳过了 dirty 保护
setActivePage('example')
```

### Segmented 导航高亮

`NAV_ITEMS` 中的页面自动高亮。不在 `NAV_ITEMS` 中的页面（如 `settings`）激活时导航栏不高亮任何选项：

```tsx
const segmentedValue = NAV_ITEMS.some((i) => i.key === activePage) ? activePage : ''
```

---

## Keep-Alive 机制

页面使用 **CSS 隐藏** 而非条件卸载来保持状态：

```
激活：  .page-keep-alive           → display: flex
隐藏：  .page-keep-alive--hidden   → display: none !important
```

**核心原则：**

| 做法             | 说明                                                     |
| ---------------- | -------------------------------------------------------- |
| 懒挂载           | 首次访问才创建 DOM，由 `mountedPagesRef` 追踪             |
| CSS 隐藏保活     | 切走后 `display: none`，组件树保持挂载，state/effect 不丢失 |
| 空闲预加载       | 高频页面在浏览器空闲时预挂载，首次切换零延迟               |

**注意事项：**

- 页面组件的 `useEffect` 在隐藏状态下仍然运行（WebSocket 监听、定时器等）
- 如果需要暂停后台活动，监听 `activePage` 或使用 `document.hidden` API
- 初始化 effect 如果依赖 prop 变化（如 `initialDocId`），需要用 ref 追踪变化而非依赖 mount-only effect

```tsx
// ❌ 错误：mount-only effect 在 keep-alive 下只执行一次
useEffect(() => {
  if (initialDocId) loadDocument(initialDocId)
}, [])

// ✅ 正确：响应 prop 变化，用 ref 防重复
const lastDocRef = useRef<string | null>(null)
useEffect(() => {
  if (initialDocId && initialDocId !== lastDocRef.current) {
    lastDocRef.current = initialDocId
    loadDocument(initialDocId)
  }
}, [initialDocId])
```

---

## Header Slots（标题栏插槽）

页面可通过 `useRegisterHeaderSlots` 向全局标题栏注入自定义按钮：

```tsx
import { useRegisterHeaderSlots } from '../context/HeaderSlotsContext'

function MyPage() {
  const headerSlots = useMemo(() => ({
    left: (
      <Flexbox horizontal align="center" gap={4}>
        <ActionIcon icon={ArrowLeft} size="small" title="返回" onClick={handleBack} />
        <ActionIcon
          icon={sidebarCollapsed ? PanelLeftOpen : PanelLeftClose}
          size="small"
          title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          onClick={() => setSidebarCollapsed(c => !c)}
        />
      </Flexbox>
    ),
    right: (
      <ActionIcon icon={Settings} size="small" title="设置" onClick={openSettings} />
    )
  }), [handleBack, sidebarCollapsed])

  // pageKey 必须与 App.tsx 中的 PageKey 一致
  useRegisterHeaderSlots('example', headerSlots)
}
```

**规则：**

- `pageKey` 必须与 `App.tsx` 中的 `PageKey` 一致（如 `'docs'`、`'agent'`）
- `slots` 对象必须用 `useMemo` 包裹，避免无限循环
- 组件卸载时自动清理

---

## 侧边栏（ResizableSidebar）

三栏布局的页面（如文档编辑器、Agent 页面）使用 `ResizableSidebar`：

```tsx
import { ResizableSidebar } from '../components/layout'

<section className="my-page">
  {/* 左侧边栏 */}
  <ResizableSidebar
    side="left"
    storageKey="my-sidebar"      // localStorage 持久化 key
    defaultWidth={240}
    collapsed={leftCollapsed}     // 受控折叠
    onCollapsedChange={setLeftCollapsed}
  >
    <MySidebarContent />
  </ResizableSidebar>

  {/* 中间主内容 */}
  <Flexbox flex={1} style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
    <MainContent />
  </Flexbox>

  {/* 右侧面板 */}
  <ResizableSidebar
    side="right"
    storageKey="my-right-panel"
    defaultWidth={260}
    collapsed={rightCollapsed}
    onCollapsedChange={setRightCollapsed}
  >
    <RightPanel />
  </ResizableSidebar>
</section>
```

**关键特性：**

| 特性             | 说明                                                         |
| ---------------- | ------------------------------------------------------------ |
| 宽度可拖拽       | 鼠标拖动边缘调整，实时更新，持久化到 localStorage             |
| CSS 折叠         | 折叠时 `width: 0` + `visibility: hidden`，**不卸载子组件**   |
| 平滑动画         | `transition: width 200ms ease`，拖拽时自动关闭 transition    |
| 受控/非受控      | 支持受控模式（传 `collapsed` + `onCollapsedChange`）         |

> **重要**：折叠时子组件保持挂载，这是为了避免展开时重新加载数据导致卡顿。如果组件树很重且折叠后不需要后台更新，可以在组件内部根据父级的 `collapsed` prop 跳过副作用。

---

## 样式规范

### 文件组织

- 每个页面一个 CSS 文件：`src/styles/{page-name}.css`
- 全局壳层样式：`src/styles/shell.css`
- 通用共享样式：`src/styles/shared.css`
- 在 `src/styles/index.css` 统一 `@import`

### 页面根容器

所有页面的根容器应包含以下基础样式（由 `.app-main > *` 规则自动提供 `flex: 1; min-height: 0`）：

```css
.my-page {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
```

- 纵向布局：加 `flex-direction: column`
- 三栏布局：默认 `flex-direction: row`（如文档编辑器、Agent 页面）

### CSS-in-JS（antd-style）

当需要访问主题变量或动态样式时使用 `antd-style`：

```tsx
import { createStyles } from 'antd-style'

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding: ${token.paddingMD}px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgElevated};
  `
}))

// 组件内
const { styles } = useStyles()
return <div className={styles.card}>...</div>
```

对于静态样式（不依赖组件实例），使用 `createStaticStyles`：

```tsx
import { createStaticStyles } from 'antd-style'

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    font-size: ${cssVar.fontSizeLG};
    color: ${cssVar.colorTextHeading};
  `
}))
```

### 卡片与容器层级

避免卡片嵌套（外层卡片包裹内层卡片）。遵循单层卡片原则：

```
❌ 错误：
settings-section（卡片背景+边框）
  └── serverCard（卡片背景+边框）  ← 嵌套！

✅ 正确：
settings-section（纯容器，无背景/边框）
  ├── settings-section-header（标题+描述）
  ├── settings-card（卡片 A）
  ├── settings-card（卡片 B）
  └── settings-card（卡片 C）
```

---

## 设置页模式

设置页使用侧边导航 + 内容区的双栏布局，内容区通过 `activeCategory` 切换渲染：

### 布局结构

```tsx
<section className="page settings-page">
  <div className="settings-layout">
    <nav className="settings-sidebar">
      {categories.map(cat => (
        <button
          className={`settings-sidebar-item${active === cat.key ? ' settings-sidebar-item--active' : ''}`}
          onClick={() => setActive(cat.key)}
        >
          {cat.icon}
          <span>{cat.label}</span>
        </button>
      ))}
    </nav>
    <div className="settings-content">
      {renderContent()}
    </div>
  </div>
</section>
```

### 内容区约定

**简单设置**（直接渲染表单）：

```tsx
<div className="settings-section">
  <div className="settings-section-header">
    <h2>标题</h2>
    <p className="form-hint">描述文字</p>
  </div>
  <div className="settings-card">
    <Form className="compact-form" layout="vertical">
      {/* 表单项 */}
    </Form>
  </div>
</div>
```

**复杂设置**（多个分组卡片）：

```tsx
<div className="settings-section">
  <div className="settings-section-header">
    <h2>标题</h2>
    <p className="form-hint">描述文字</p>
  </div>
  <div className="settings-card">
    <div className={styles.sectionTitle}>
      <Icon size={16} /> 子标题 A
    </div>
    <Form className="compact-form" layout="vertical">...</Form>
  </div>
  <div className="settings-card">
    <div className={styles.sectionTitle}>
      <Icon size={16} /> 子标题 B
    </div>
    <Form className="compact-form" layout="vertical">...</Form>
  </div>
</div>
```

关键 CSS 类：

| 类名                       | 用途                                         |
| -------------------------- | -------------------------------------------- |
| `.settings-section`        | 纯容器（flex column + gap 12px），无背景/边框 |
| `.settings-section-header` | 标题 + 描述                                   |
| `.settings-card`           | 内容卡片（bg-elevated + border + radius 12px）|
| `.compact-form`            | 紧凑表单（减小 gap 和 padding）               |
| `.config-actions`          | 按钮组（flex + gap 10px）                     |

---

## 跨页面导航与数据传递

通过 `NavigationContext` 实现跨页面导航和数据传递：

### 导航到文档编辑页（带文档 ID）

```tsx
import { useDocumentNavigation } from '../context/NavigationContext'

const { navigateToDocs } = useDocumentNavigation()

// 导航到文档编辑页并打开指定文档
navigateToDocs(documentId)
```

### 导航到工作页（带文件）

```tsx
import { useWorkNavigation } from '../context/WorkNavigationContext'

const { openFileAtWork } = useWorkNavigation()

// document 类型自动重定向到 docs 页
openFileAtWork('document', docId)
// todoList 类型导航到 work 页
openFileAtWork('todoList', todoId)
```

### 导航到 Agent 页（带上下文）

```tsx
import { useChatWithFile } from '../context/NavigationContext'

const { chatWith } = useChatWithFile()

chatWith({
  text: '请分析这个文档',
  files: [{ kind: 'document', id: docId, title: '文档标题' }]
})
```

### 在目标页消费传递的数据

```tsx
// 目标页面消费 pendingDocId
const { pendingDocId, consumePendingDoc } = useDocumentNavigation()

useEffect(() => {
  if (pendingDocId) {
    const id = consumePendingDoc()
    if (id) handleOpenDocument(id)
  }
}, [pendingDocId, consumePendingDoc])
```

---

## Dirty 保护（离开前确认）

对于有编辑状态的页面，使用 `dirtyRef` 模式：

### Step 1: 页面声明 dirtyRef prop

```tsx
export interface MyEditorPageProps {
  dirtyRef?: React.MutableRefObject<boolean>
}
```

### Step 2: App.tsx 传递 ref 并配置保护

```tsx
const myDirtyRef = useRef(false)

// 在 setActivePageSafe 中添加保护
const setActivePageSafe = useCallback((next: PageKey) => {
  if (activePageRef.current === 'example' && myDirtyRef.current && next !== 'example') {
    Modal.confirm({
      title: '未保存的更改',
      content: '有未保存的更改，确定离开吗？',
      okText: '离开',
      cancelText: '继续编辑',
      onOk: () => startTransition(() => setActivePage(next))
    })
  } else {
    startTransition(() => setActivePage(next))
  }
}, [])

// 挂载时传入
<MyEditorPage dirtyRef={myDirtyRef} />
```

### Step 3: 页面内同步 dirty 状态

```tsx
useEffect(() => {
  if (dirtyRef) dirtyRef.current = dirty
}, [dirty, dirtyRef])
```

---

## 常用 Hooks 与 Context

| Hook / Context             | 用途                                        | 导入路径                           |
| -------------------------- | ------------------------------------------- | ---------------------------------- |
| `usePrizmContext()`        | 服务端连接、manager、config                  | `context/PrizmContext`             |
| `useScope()`              | 当前 Scope、切换 Scope                       | `hooks/useScope`                   |
| `useLogsContext()`        | 应用日志                                     | `context/LogsContext`              |
| `useNavigation()`         | 完整导航上下文                                | `context/NavigationContext`        |
| `useDocumentNavigation()` | 文档导航（navigateToDocs, pendingDocId）     | `context/NavigationContext`        |
| `useWorkNavigation()`     | 工作页导航（openFileAtWork）                 | `context/WorkNavigationContext`    |
| `useChatWithFile()`       | Agent 对话导航                               | `context/NavigationContext`        |
| `useRegisterHeaderSlots()`| 注册标题栏自定义按钮                          | `context/HeaderSlotsContext`       |
| `useClientSettings()`     | 客户端设置（主题、发送方式）                  | `context/ClientSettingsContext`    |
| `useHashRoute()`          | Hash 路由同步                                | `hooks/useHashRoute`               |

---

## Checklist

创建新页面时的完整检查清单：

- [ ] 创建 `src/views/MyPage.tsx`，用 `memo()` 导出
- [ ] 三处同步更新 `PageKey` 类型（App.tsx、useHashRoute.ts、CommandPalette.tsx）
- [ ] 如果需要 QuickAction 支持，更新 `QuickActionHandler.tsx` 的 PageKey
- [ ] App.tsx 中导入页面组件
- [ ] App.tsx 的 `<div className="app-main">` 中添加 keep-alive 挂载块
- [ ] （可选）添加到 `NAV_ITEMS` 顶部导航
- [ ] （可选）添加到 `PRELOAD_PAGES` 预加载列表
- [ ] （可选）创建 `navigateToXxx` 回调并传给 `NavigationProvider`
- [ ] （可选）配置 dirty 保护（`dirtyRef` + `setActivePageSafe` 中的判断）
- [ ] （可选）注册 Header Slots
- [ ] 创建 `src/styles/my-page.css` 并在 `index.css` 中导入
- [ ] 页面根容器具备 `display: flex; flex: 1; min-height: 0; overflow: hidden`
