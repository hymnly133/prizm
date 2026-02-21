# 贡献指南

感谢你对 Prizm 的关注。以下为参与开发与提交流程的简要说明。

## 开发环境

1. **安装依赖**

   ```bash
   yarn install
   ```

2. **构建**

   ```bash
   yarn build          # 全量构建（evermemos + server + electron）
   yarn build:server    # 仅服务端
   yarn build:electron  # 仅 Electron 客户端
   ```

3. **开发模式**

   ```bash
   yarn dev:server     # 服务端 watch
   yarn dev:electron   # Electron 客户端
   ```

4. **测试**

   ```bash
   yarn test           # 运行服务端测试（vitest）
   ```

服务端默认端口 4127，管理面板：`http://127.0.0.1:4127/dashboard/`。

## 代码规范

- TypeScript strict，优先 `interface`，适配器接口以 `I` 开头。
- 命名：文件 `camelCase` 或 `PascalCase`（组件/类），变量/函数 `camelCase`。
- 项目内约定见 [.cursor/rules](.cursor/rules)（若存在）及 [CLAUDE.md](CLAUDE.md) 中的架构与开发说明。

## 提交流程

- 在 fork 或分支上开发，提交前请在本地运行 `yarn build` 与 `yarn test`。
- 提交信息建议使用约定式说明（如 `feat: ...` / `fix: ...` / `docs: ...`）。
- 通过 GitHub 提交 Pull Request，在描述中说明改动目的与影响范围。

如有疑问，可在 [Issues](https://github.com/hymnly133/prizm/issues) 中提出。
