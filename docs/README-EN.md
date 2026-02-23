<div align="center">

# Prizm: Agent Collaborative Environment

**Finally, Agents *WORK WITH* you.**

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-blue.svg)](../LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](../CONTRIBUTING.md)

[**中文**](../README.md) · [**Docs**](USER_GUIDE.md) · [**Report a Bug**](https://github.com/hymnly133/prizm/issues) · [**Request Feature**](https://github.com/hymnly133/prizm/issues)

</div>

---

## 📖 Table of Contents

- [Why Prizm?](#-why-prizm)
- [Core Features Overview](#-core-features-overview)
  - [User Experience Features](#-user-experience-features)
  - [Technical Details for Developers](#-technical-details-for-developers)
- [Quick Start](#-quick-start)
- [Ecosystem Integration (MCP)](#-ecosystem-integration-mcp)
- [Project Structure](#-project-structure)
- [Tech Stack](#-tech-stack)
- [Documentation & Guides](#-documentation--guides)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🤔 Why Prizm?

**Prizm** is an **Agent Collaborative Environment** designed for desktop productivity and knowledge management. Its core philosophy is to bridge the gap between traditional productivity tools and AI automation capabilities:

* 🧠 **Agentic Obsidian**: Allow Agents to act as peers, co-managing your personal knowledge base (documents, todos, sticky notes, clipboard, etc.), truly realizing they *WORK WITH* you.
* 🛠️ **Universal Personal AI Workspace**: Extend beyond coding assistance to cover daily efficiency tasks, document restructuring, memory retrieval, and workflow automation.
* 🔄 **Knowledge-Closed Automation Pipeline**: Chain atomic actions like "saving a document," "web interaction," or "completing a todo" into highly reusable Agentic automation workflows via an event-driven mechanism.

**For You**: A single, unified desktop entry point to compile resources, break down tasks, and customize flexible, seamless workflows.
**For Agents**: A highly integrated context environment—native documents, todos, clipboard, system resources, terminal, browser, and more—empowering Large Language Models (LLMs) with precise action and service capabilities.

---

## ✨ Core Features Overview

Our core design principles are **Local-First**, **Highly Extensible**, and **Production-Ready**. We divide our feature set into User Experience capabilities and Developer Technical specifications so different audiences can quickly understand its value.

### 🌟 User Experience Features

| Feature Category | Highlight Description |
| :--- | :--- |
| 🛡️ **Absolute Data Sovereignty** | Data strictly lands in your local `.prizm-data` hidden directory. All your digital assets remain accessible completely offline with one-click workspace backups. |
| 🧠 **Tri-Layer Intelligent Memory** | Eliminate rigid context-loss issues. Your preferences and knowledge graphs are dynamically divided into `Short-term Context` / `Mid-term Semantic Flow` / `Global Persistent DB`, helping agents understand you better over time. |
| 💬 **Seamless Global Capabilities** | When chatting with the most powerful LLMs, they can "act". They can browse the live web, edit local private docs, auto-resolve to-dos, and silently manipulate your clipboard. |
| ⚡ **No-Code Workflow Engine** | Have a chore you repeat 1,000 times? Use the intuitive visual node editor on the desktop client to configure an always-on "digital employee" handling cron-jobs and automations. |
| 🔎 **Radar-Like Global Search** | Powered by an optimized lightweight local vector store, you can achieve lightning-fast sub-second semantic queries across massive projects and fragmented notes, even with blurry descriptions. |

### 🛠️ Technical Details for Developers

| Technical Module | Architecture Specifics |
| :--- | :--- |
| 🔌 **Zero-Cost MCP Gateway** | Built-in highly mature Model Context Protocol (MCP) bridge. Expose your knowledge directly to modern environments like Cursor IDE or LobeChat via standard HTTP/Stdio sockets. |
| 🏢 **Scope Isolation & Optimistic Locks** | Enterprise-grade `Scope` mechanism. Radically isolate Work, Personal, and Sandbox states both in memory and on disk. State flows rely on strict optimistic resource locking resolving collisions. |
| 🌐 **Full-Duplex WebSocket Terminal** | Features an embedded I/O penetrating terminal subsystem. Send realtime CLI commands from Agents with zero-latency duplex WebSocket pipelines pushing direct echo buffers to the React frontend. |
| 🧩 **Polymorphic Adapters & EventBus** | Decoupled core. Business actions broadcast via a lightweight robust EventBus, allowing horizontally extending future Storage Engines (beyond SQLite/LanceDB) and external AI SDK providers smoothly. |
| 📈 **Granular Audits & Token Baselines** | Production-ready telemetry. Pinpoint rollback checkpoints initiated by tools, unified fine-grained Token metering across multiple streaming models, yielding maximum transparency over system cost and data traversal. |

---

## 🚀 Quick Start

### 1. Prerequisites and Installation

Please ensure your local development environment has Node.js (>= 20) and Yarn installed.

```bash
# 1. Clone the repository
git clone https://github.com/hymnly133/prizm.git
cd prizm

# 2. Install all dependencies
yarn install

# 3. (Optional) Configure environment variables
cp prizm/.env.example prizm/.env
# Modify service ports, persistent storage paths, and core key credentials in .env as needed
```

### 2. Run Server (Web Dashboard)

For users who only need to manage their knowledge base, documents, and historical clipboard conveniently via a browser, loading the full client is not required:

```bash
yarn dev:server
```

> **Access**: Once the service starts successfully, you can view the Web dashboard by default at [http://127.0.0.1:4127/dashboard/](http://127.0.0.1:4127/dashboard/). (For a minimal initial experience, binding a `.env` file is not strictly necessary).

### 3. Run Desktop Client (Recommended! Full Experience)

To achieve an uncompromised, top-tier efficiency experience (including global Agent streaming chats, workflow configuration wizards, real-time message dispatching, Token monitoring dashboards, etc.):

```bash
yarn dev:electron
```

> ⚠️ **Note**: Before experiencing the intelligent features of **Agent Chat** and workflow planning, you must go to the control center or client system settings to enable and configure at least one **LLM model setup** (i.e., input API Key and matching Base URL).

---

## 🔌 Ecosystem Integration (MCP)

Prizm does not build walled gardens; it acts as an open personal hub. It allows direct exposure of local data and built-in instruction contexts as **MCP (Model Context Protocol)** sources to empower leading AI tool clients, ensuring data connectivity mechanisms under secure authorization.

*   **Cursor**: Relies on standard pipeline communication mounting. Navigate to Cursor's remote options and specify the mounting command as `node [absolute-path-to-project]/prizm/dist/mcp/stdio-bridge.js`, followed by necessary environment variables (corresponding to `PRIZM_URL`, etc.). Read more details [here](../prizm/MCP-CONFIG.md).
*   **LobeChat / Generic SSE Support**: Directly input the server address to expose the protocol interface `http://127.0.0.1:4127/mcp` (pass isolation domain identity via URL Query parameters, e.g., appending `?scope=example` to differentiate independent workflows and contexts). For authenticated services, further pass the API Key via Header Token.

---

## 📁 Project Structure

The project is structured as a loosely coupled but highly collaborative **Monorepo** based on Yarn Workspace:

```text
prizm/
├── prizm/                       # @prizm/server — Core HTTP/WS process server
│   ├── src/                     # Core server logic (Routes / MCP Hub / Workflow Engine / Vector Search Layer)
│   └── panel/                   # Dashboard Web interface layer (Vue 3 based)
├── prizm-shared/                # @prizm/shared — Abstractions across layers (Domain types, Interfaces, Enums)
├── prizm-client-core/           # @prizm/client-core — Stateless client SDK business flow, HTTP/WebSocket wrappers
├── prizm-electron-client/       # @prizm/electron-client — Native desktop application frontend (Electron + React)
├── packages/
│   ├── evermemos/               # @prizm/evermemos — Optimized adaptive memory engine (LanceDB vector + SQLite local store)
│   └── prizm-stagehand/         # @prizm/stagehand — Specialized intelligent web control system (Playwright-based automation)
├── website/                     # Prizm ecosystem marketing site and official landing page (Vite built)
└── docs/                        # Normative instructions, best practices, and low-level design documents
```

---

## 🛠️ Tech Stack

We adopt modern development baselines without limits to ensure continuous evolution and performance:

*   **Server Architecture**: Node.js / Express 5 / WebSocket protocol control / Full TypeScript validation
*   **Frontend & Desktop**: Electron 40 / React 19 / Ant Design / Vite build system / Zustand state topology
*   **Data Plane**: LanceDB for high-performance vector operations / SQLite for high-speed lightweight relational persistence / Local true File System mapping
*   **Architecture Design**: High-dimensional Scope multi-tenant business isolation / Standardized Adapter proxy patterns / Aggregated EventBus core communication decoupling

---

## 📖 Documentation & Guides

If you desire deep control or even self-hosted platform components, the following documents are crucial:

| Module Category | Quick Links |
| :--- | :--- |
| **Getting Started** | [System User Guide](USER_GUIDE.md) · [Env & Config Overview](configuration.md) |
| **Core Architecture** | [Workflow Engine Concepts](workflow-system.md) · [Offline Embedding Setup](local-embedding.md) · [Memory Feedback Architecture](feedback-system.md) · [Browser Control Options](browser-control-options.md) |
| **Development & Protocols** | [Developer Requirements (CLAUDE.md)](../CLAUDE.md) · [Architecture Overview](ARCHITECTURE.md) · [Glossary](glossary.md) |
| **Multi-Language** | [Chinese README](../README.md) |

---

## 🤝 Contributing

**Thank you for your interest in Prizm! We highly expect to build this powerful hybrid workspace together with you.**
- If you encounter anomalies or unexpected behavior during daily use, please throw the issues you find into the [Issue Trackers](https://github.com/hymnly133/prizm/issues).
- Have bold and forward-thinking development ideas you hope to realize? Before raising a PR code merge request, please take a moment to read the project's [Developer Guidelines](../CLAUDE.md), which covers key information on standard building and quality control detection.

---

## 📄 License

All logic content explicitly open-sourced in this project defaults to complying with the **[PolyForm Noncommercial 1.0.0](../LICENSE)** license terms.
This means the source code and derivative products of the entire solution are open and *strictly* for independent personal research, testing, evaluation, and non-commercial independent application. **If you or your organization involves closed-source distribution, distribution for profit, or packaging as part of a commercialized service, please contact the author team in advance to negotiate and confirm authorization forms.**
