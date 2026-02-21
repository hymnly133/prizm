# 布局组件库

复刻 LobeHub 页面布局的可复用组件。

## 组件列表

| 组件 | 用途 |
|------|------|
| `LayoutContainer` | 主内容区双层容器（padding + border） |
| `MainLayout` | 侧栏 + 内容区主布局 |
| `SidebarLayout` | 侧栏三区结构（header/body/footer） |
| `SidebarContentLayout` | 侧栏 + 内容区（如 Agent 页） |
| `AppHeader` | 顶部栏（brand + nav） |
| `BottomNavBar` | 底部 Tab 导航（mobile 风格） |

## 使用示例

### AppHeader

```tsx
import { AppHeader } from "./components/layout";

<AppHeader
  brand={
    <>
      <Tag color="green" size="small">已连接</Tag>
      <h1>Prizm</h1>
    </>
  }
  nav={
    <>
      <Button type="primary" onClick={() => setActivePage("work")}>工作</Button>
      <Button type="default" onClick={() => setActivePage("agent")}>Agent</Button>
      <Button type="default" onClick={() => setActivePage("settings")}>设置</Button>
    </>
  }
  height={56}
/>
```

### LayoutContainer

```tsx
import { LayoutContainer } from "./components/layout";

<LayoutContainer padding={8} borderRadius="12px">
  <YourContent />
</LayoutContainer>
```

### MainLayout（侧栏 + 主内容）

```tsx
import { MainLayout } from "./components/layout";

<MainLayout sidebar={<NavPanel />} useLayoutContainer height="100%">
  <Outlet />
</MainLayout>
```

### SidebarLayout（三区侧栏）

```tsx
import { SidebarLayout } from "./components/layout";

<SidebarLayout
  header={<LogoAndNav />}
  body={<SessionList />}
  footer={<UserMenu />}
  width={240}
/>
```

### SidebarContentLayout（侧栏 + 内容区）

```tsx
import { SidebarContentLayout } from "./components/layout";

<SidebarContentLayout
  sidebar={<SessionList />}
  sidebarWidth={220}
  isDark={isDarkMode}
>
  <ChatContent />
</SidebarContentLayout>
```

### BottomNavBar（底部导航）

```tsx
import { BottomNavBar } from "./components/layout";
import { MessageSquare, Settings, Briefcase } from "lucide-react";

<BottomNavBar
  activeKey={activePage}
  items={[
    { key: "work", title: "工作", icon: Briefcase, onClick: () => setPage("work") },
    { key: "agent", title: "Agent", icon: MessageSquare, onClick: () => setPage("agent") },
    { key: "settings", title: "设置", icon: Settings, onClick: () => setPage("settings") },
  ]}
  height={56}
/>
```
