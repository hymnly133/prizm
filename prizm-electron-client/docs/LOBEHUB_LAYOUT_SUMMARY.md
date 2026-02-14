# LobeHub 页面布局总结

本文档总结 LobeHub 项目的页面布局结构，供 Prizm  Electron 客户端复用参考。

## 一、整体架构

```
RootLayout (layout.tsx)
├── html/body
├── GlobalProvider (主题、国际化、各种 Provider)
│   └── AuthProvider
│       └── children
└── page.tsx
    ├── isMobile ? MobileRouter : DesktopRouter
    └── MobileRouter
        └── MobileMainLayout (Outlet + NavBar)
    └── DesktopRouter
        └── DesktopMainLayout (main/_layout)
```

## 二、桌面端布局 (Desktop)

### 2.1 主布局结构 (DesktopMainLayout)

```
Flexbox horizontal (width: 100%, height: calc(100% - TITLE_BAR_HEIGHT))
├── NavPanel (左侧导航面板)
└── DesktopLayoutContainer (主内容区)
    ├── DesktopHomeLayout (首页时显示：侧栏 + 内容)
    └── Outlet (子路由内容)
```

**关键点：**

- 使用 `Flexbox` 水平布局，`width: 100%`，`height` 根据标题栏/横幅动态计算
- 左侧 `NavPanel` 固定宽度
- 右侧 `DesktopLayoutContainer` 为 `flex: 1` 占满剩余空间

### 2.2 DesktopLayoutContainer

**双层容器结构：**

```
outerContainer (外层)
├── padding: 8px (可动态调整)
├── background: transparent (桌面) / colorBgLayout (Web)
└── innerContainer (内层)
    ├── border: 1px solid (主题色)
    ├── border-radius (可平台适配，如 macOS 大圆角)
    └── background: colorBgContainer
```

**CSS 变量：**

- `--container-padding-left` / `--container-padding-top`
- `--container-border-color` / `--container-border-radius`
- `--container-border-bottom-right-radius` (平台适配)

### 2.3 DesktopHomeLayout（首页布局）

**结构：**

```
absoluteContainer (position: absolute, inset: 0)
├── Sidebar (左侧会话/项目列表)
├── Flexbox 内容区 (flex: 1)
│   └── content (children / Outlet)
└── 同步/水合组件
```

**样式：**

- `contentDark`: 深色模式渐变背景
- `contentLight`: 浅色模式背景 `var(--content-bg-secondary)`
- 使用 `Activity` 实现 keep-alive（离开首页时渲染到 offscreen）

### 2.4 Sidebar（侧栏通用结构）

**SideBarLayout 三区结构：**

```
├── Header (头部：Logo、导航、用户)
├── Body (主体：可滚动列表)
└── Footer (底部：设置、帮助等)
```

## 三、移动端布局 (Mobile)

### 3.1 MobileMainLayout

```
<>
  NavigatorRegistrar
  CloudBanner? (可选)
  MarketAuthProvider
    Outlet (主内容)
  NavBar (底部 TabBar，按路由显示)
</>
```

### 3.2 NavBar（底部 TabBar）

- 固定底部 `position: fixed; inset-block-end: 0`
- 使用 `@lobehub/ui/mobile` 的 `TabBar`
- 根据 `pathname` 决定是否显示

## 四、核心设计原则

1. **分层滚动**：主容器 `overflow: hidden`，各区域（侧栏、主内容）内部各自 `overflow-y: auto`
2. **flex 链**：根到叶子保持 `flex: 1; min-height: 0` 防止溢出
3. **主题变量**：使用 `cssVar` / `--ant-*` 实现深色/浅色
4. **平台适配**：桌面端 TitleBar 高度、macOS 圆角等通过 CSS 变量注入
5. **懒加载**：路由级 `dynamic()` 实现代码分割

## 五、关键样式变量

| 变量 | 用途 |
|------|------|
| `colorBgContainer` | 主内容区背景 |
| `colorBgContainerSecondary` | 次要背景（渐变等） |
| `colorBgLayout` | 布局背景 |
| `colorBorder` / `colorBorderSecondary` | 边框 |
| `colorPrimary` | 主题色 |
| `borderRadius` | 圆角 |

## 六、组件复用映射

| LobeHub 组件 | Prizm 复用组件 |
|-------------|----------------|
| DesktopLayoutContainer | `LayoutContainer` |
| DesktopMainLayout 主结构 | `MainLayout` |
| DesktopHomeLayout | `SidebarContentLayout` |
| SideBarLayout | `SidebarLayout` |
| NavBar | `BottomNavBar` |
| Flexbox 水平布局 | `FlexRow` / 原生 flex |
