# 服务端依赖升级待办

本文档记录依赖升级过程中遗留或待处理的服务端相关事项。

## 已完成

- [x] 使用 `npm-check-updates` 将各 workspace 依赖升级到最新
- [x] Express 4 → 5 类型兼容：添加 `ensureStringParam` 处理 `req.params` / `req.query` 的 `string | string[]` 类型
- [x] Express 5 路径语法：将 `/dashboard/*` 改为 `/dashboard/*splat`（path-to-regexp 要求通配符必须有名称）

## 待办

### 1. uuid ESM 警告

**现象**：启动时出现 `ExperimentalWarning: CommonJS module ... is loading ES Module ... uuid ... using require()`

**原因**：uuid v11+ 为纯 ESM 包，而 prizm 服务端为 CommonJS（`require()`），Node 对 `require()` 加载 ESM 支持仍为实验性。

**可选方案**：

- **方案 A**：将 uuid 降级到 v9（仍支持 CommonJS）
- **方案 B**：将 prizm 服务端迁移为 ESM（`"type": "module"`、`import` 等）
- **方案 C**：使用 `import()` 动态导入 uuid（需改造调用处）

### 2. Electron 40 安装失败

**现象**：`yarn install` 时 electron@40.4.1 构建失败，报错 `ETIMEDOUT`（网络超时）

**原因**：Electron 安装需从 GitHub 下载二进制，当前网络环境导致超时。

**建议**：网络稳定后重试 `yarn install`，或保持 <electron@33.x> 使用。

### 3. Vue Router 5 / Vite 7 等前端升级

panel 与 prizm-electron-client 已升级到 Vue Router 5、Vite 7 等，建议在本地完整跑一遍相关功能，确认无破坏性变更。

---

*生成于依赖升级会话*
