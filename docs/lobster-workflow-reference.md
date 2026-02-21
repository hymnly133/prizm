# Lobster 工作流实现参考

本文档基于 OpenClaw Lobster 的源码与官方文档整理，用于和 Prizm 工作流引擎对照（DAG/并行扩展、审批与恢复等）。源码来源：<https://github.com/openclaw/lobster>，文档：<https://docs.openclaw.ai/tools/lobster>。

---

## 一、Lobster 是什么

- **定位**：OpenClaw 的“工作流 shell”，用类型化、本地优先的管道把技能/工具组合成可组合管线，带审批门控。
- **两种用法**：
  1. **Shell 管道**：一行命令如 `exec --json --shell 'cmd' | exec --stdin json --shell 'next' | approve --prompt '...' | json`，由 parser 拆成 stages，runtime 按序执行。
  2. **工作流文件（.lobster）**：YAML/JSON 定义 `name`、`args`、`steps`、`env`、`condition`、`approval`，通过 `lobster run path/to/file.lobster` 执行。

---

## 二、工作流文件格式与语义（与 Prizm 对照）

### 2.1 文件结构（Lobster）

```yaml
name: inbox-triage
args:
  tag: { default: "family" }
steps:
  - id: collect
    command: inbox list --json
  - id: categorize
    command: inbox categorize --json
    stdin: $collect.stdout
  - id: approve
    command: inbox apply --approve
    stdin: $categorize.stdout
    approval: required
  - id: execute
    command: inbox apply --execute
    stdin: $categorize.stdout
    condition: $approve.approved
```

- **steps**：数组，每步 `id`、`command`（ shell 字符串）、可选 `stdin`、`approval`、`condition`/`when`。
- **stdin**：引用前步输出，如 `$collect.stdout`、`$categorize.json`。
- **condition / when**：支持 `$stepId.approved`、`$stepId.skipped`，为 false 时该步记为 skipped，不执行 command。
- **approval**：`true` 或 `'required'` 表示该步为审批门控；在 tool 模式下会暂停并返回 `resumeToken`。

### 2.2 与 Prizm 的对应关系

| 能力           | Lobster                     | Prizm                          |
|----------------|-----------------------------|---------------------------------|
| 步骤顺序       | 严格按 `steps` 数组顺序      | 严格按 `steps` 数组顺序        |
| 步骤间数据     | `$stepId.stdout` / `.json`  | `$stepId.output` / `$stepId.data.xxx` |
| 条件跳过       | `condition` / `when`         | `condition`                     |
| 审批门控       | `approval: required`        | `type: approve` + `approvePrompt` |
| 恢复           | resumeToken + stateKey 存状态 | resumeToken + SQLite stepResults |
| 步骤类型       | 每步都是 shell command      | agent / approve / transform     |

结论：**Lobster 工作流文件也是线性执行**，没有在步骤层面做 DAG 或并行；与 Prizm 当前“线性 + condition + approve”的模型一致。

---

## 三、Lobster 源码中的执行路径

### 3.1 工作流文件执行（`src/workflows/file.ts`）

- **入口**：`runWorkflowFile({ filePath, args, ctx, resume, approved })`。
- **Resume**：若带 `resume`，从 `resume.stateKey` 或 payload 里恢复 `resumeAtIndex`、`steps`（各步结果）、`args`、`approvalStepId`；若本次是 resume 且带 `approved`，先写回 `results[approvalStepId].approved = approved`。
- **主循环**：`for (let idx = startIndex; idx < steps.length; idx++)`：
  1. 若 `evaluateCondition(step.when ?? step.condition, results)` 为 false → 写 `results[step.id] = { id, skipped: true }`，continue。
  2. 解析 `step.command`、`step.stdin`（引用 `$stepId.stdout`/`.json`）、env、cwd。
  3. `runShellCommand({ command, stdin, env, cwd })` 执行 shell，得到 stdout，再 `parseJson(stdout)` 得到 json。
  4. 写 `results[step.id] = { id, stdout, json }`。
  5. 若 `isApprovalStep(step.approval)` 且为 tool 模式（或非交互）：调用 `saveWorkflowResumeState` 存 `filePath`、`resumeAtIndex: idx + 1`、`steps: results`、`args`、`approvalStepId`；生成只含 `stateKey` 的 resumeToken；返回 `status: 'needs_approval'` + `requiresApproval.resumeToken`，**不执行后续步骤**。
  6. 若为交互模式则 TTY 读 y/N，未通过则抛错；通过则写 `results[step.id].approved = true` 并继续下一轮。
- **结束**：循环正常结束则取 `lastStepId` 对应结果的 json/stdout 作为 output，返回 `status: 'ok'`。

要点：**单线程、严格按数组下标顺序、无并行、无 DAG**；审批通过后从 `resumeAtIndex`（即审批步的下一项）继续。

### 3.2 Shell 管道执行（`src/runtime.ts`）

- **输入**：`pipeline` 为 stage 数组（每 stage 有 `name`、`args`），来自 parser 对管道字符串的解析（如 `exec | where | approve | json`）。
- **循环**：`for (let idx = 0; idx < pipeline.length; idx++)`，从 registry 取 command，`command.run({ input: stream, args, ctx })`。
- 若返回 `result?.halt`，则 `halted = true`，`haltedAt = { index, stage }`，用 `result.output` 作为 stream 并 break；否则用 `result.output` 作为下一阶段的输入 stream。
- **结论**：同样是**线性管道**，无分支、无并行；审批通过后由外部用 resume 再跑一遍或从保存的状态继续。

### 3.3 Resume Token（`src/resume.ts`、`src/token.ts`）

- Token 为 base64url(JSON)。
- 工作流文件模式 payload 示例：`{ protocolVersion: 1, v: 1, kind: 'workflow-file', stateKey }`；或内嵌 `filePath`、`resumeAtIndex`、`steps`、`args`、`approvalStepId`。
- 状态持久化：`stateKey` 指向外部 store（`writeStateJson`/`readStateJson`），存 `filePath`、`resumeAtIndex`、`steps`（每步结果）、`args`、`approvalStepId`、`createdAt`。
- Resume 时：解码 token → 用 stateKey 或内嵌数据加载状态 → 若带 `approved` 则写回对应 step 的 approved → 从 `resumeAtIndex` 继续 for 循环。

---

## 四、安全与策略（文档所述）

- **超时与输出上限**：`timeoutMs`、`maxStdoutBytes`（如 512000），在工具调用时传入，超时或超长即终止子进程。
- **沙箱**：文档称在沙箱环境下 Lobster 工具会被禁用；无 OAuth，由 OpenClaw 其他工具负责。
- **可执行路径**：固定用 `lobster` CLI 在 PATH 上，无用户可控路径执行。

---

## 五、对 Prizm 的启示

1. **Lobster 工作流文件 = 线性 + condition + approval + resume**，与 Prizm 现有模型高度一致；Lobster 并未在“步骤图”上做 DAG 或并行，报告中的“DAG 组合”更可能指管道式组合（多个 command 串成一条线），而非多分支 DAG。
2. **Resume 设计**：Lobster 把完整 step 结果和 `resumeAtIndex` 存到外部 state，token 只带 stateKey 或内嵌 payload；Prizm 用 SQLite 存 stepResults + currentStepIndex，语义等价，都是“从某下标继续 + 已有结果”。
3. **审批**：Lobster 在“执行完该步 command 后”再判断是否需要审批；Prizm 的 approve 是单独步骤类型，不执行 command。两者都是“暂停 → resume 时写入 approved → 继续”。
4. **DAG/并行**：若 Prizm 要做真正的 DAG/并行步骤，是在现有线性引擎上的**扩展**，Lobster 当前实现没有对应能力，可作对比参考而非照搬。

---

## 六、参考链接

- Lobster 仓库：<https://github.com/openclaw/lobster>
- 官方文档：<https://docs.openclaw.ai/tools/lobster>
- 工作流文件执行：`src/workflows/file.ts`
- 管道 runtime：`src/runtime.ts`
- Resume：`src/resume.ts`、`src/token.ts`、`src/state/store.js`
