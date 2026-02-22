# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **反馈系统**：用户可对 Agent 回复、文档、工作流运行、后台任务等输出进行「喜欢/一般/不喜欢」评价并填写评语；反馈写入 SQLite、审计日志，并与偏好记忆（profile）联动；Electron 客户端提供行内/卡片反馈组件及首页反馈概览。详见 [docs/feedback-system.md](docs/feedback-system.md)。
- CONTRIBUTING.md、SECURITY.md、CHANGELOG.md
- 根 package.json 的 repository、homepage、bugs
- prizm/.env.example（环境变量示例）
- packages/evermemos 的 README.md、NOTICE 及原项目 EverMemOS（Apache-2.0）注明

### Changed

- .gitignore 增加 reference/、research/（仅从 Git 移除跟踪，本地可保留）

## [0.1.0]

- 初始 monorepo：服务端、Electron 客户端、MCP、Agent、工作流等能力。
