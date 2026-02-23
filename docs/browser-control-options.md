# 浏览器控制方案（Playwright 直接代理）

**当前实现**：服务端 **直接代理 Playwright**，无自定义语义、无语义包装。经 CDP relay 连接客户端浏览器，工具暴露：goto / snapshot / click / fill / select_option / get_text / close。

## 动作与返回

`prizm_browser` 仅做 Playwright 代理，共 7 个 action。

### 动作列表

| 动作 | 参数 | 说明 | 返回 |
|------|------|------|------|
| **goto** | url（必填） | `page.goto(url)` | `ok: navigated to ${url}` |
| **snapshot** | — | 可操作元素列表（ref, role, name） | JSON 数组 |
| **click** | ref（必填） | 按 snapshot 的 ref 点击 | `ok: clicked ref ${ref}` |
| **fill** | ref, value（必填） | 按 ref 填写 | `ok: filled ref ${ref}` |
| **select_option** | ref, value（必填） | 按 ref 选择选项 | `ok: selected ref ${ref} = ${value}` |
| **get_text** | — | 整页可见文本 | 字符串 |
| **close** | — | 关闭会话 | `ok: browser session closed` |

ref 为 snapshot 返回数组的下标（0-based）。先调用 snapshot，再根据返回的 ref/role/name 决定 click/fill/select_option 的 ref。

---

## 现状与实现

- **约束**：不引入新浏览器，仅使用现有 Relay（Electron/本地浏览器）经 CDP 连接。
- **实现**：**直接代理 Playwright**，无自定义语义、无 LLM 调用。服务端 `chromium.connectOverCDP(relayUrl)` 连接 relay；snapshot 用 `page.evaluate` 取可操作元素；click/fill/select_option 按 ref 用 `page.locator(selector).nth(ref)` 执行。

**模块：**

- **prizm/src/llm/playwrightBrowserSession.ts**：CDP 连接、快照、按 ref 执行 click/fill/select、整页文本。
- **prizm/src/llm/builtinTools/browserTools.ts**：`prizm_browser` 工具入参透传，仅做会话复用、超时与错误返回（`error: ...`）。

---

## 超时与错误

- **超时**：连接 `BROWSER_CONNECT_TIMEOUT_MS`，单次操作 `BROWSER_ACTION_TIMEOUT_MS`。
- **错误**：返回 `error: ${message}`；executor 将 `error:` 开头的 result 视为 isError。

---

## 参考

- Relay：`prizm/src/websocket/BrowserRelayServer.ts`
- 浏览器工具：`prizm/src/llm/builtinTools/browserTools.ts`
- Playwright 会话：`prizm/src/llm/playwrightBrowserSession.ts`
