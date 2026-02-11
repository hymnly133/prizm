import { Button, Input } from "@lobehub/ui";
import { useState } from "react";
import { useLogsContext } from "../context/LogsContext";
import { usePrizmContext } from "../context/PrizmContext";

export default function TestPage() {
	const { manager, lastSyncEvent, setLastSyncEvent } = usePrizmContext();
	const { addLog } = useLogsContext();

	const [localNotif, setLocalNotif] = useState({
		title: "测试通知",
		body: "支持 **Markdown** 渲染",
	});
	const [serverNotif, setServerNotif] = useState({
		title: "服务器通知",
		body: "来自 WebSocket",
	});
	const [serverNotifResult, setServerNotifResult] = useState<{
		ok: boolean;
		msg: string;
	} | null>(null);
	const [mockNote, setMockNote] = useState("测试便签内容");
	const [mockTask, setMockTask] = useState("测试任务");
	const [mockClipboard, setMockClipboard] = useState("测试剪贴板内容");
	const [mockResult, setMockResult] = useState<{
		ok: boolean;
		msg: string;
	} | null>(null);

	function sendLocalNotif() {
		if (!localNotif.title.trim()) return;
		window.prizm.showNotification({
			title: localNotif.title.trim(),
			body: localNotif.body.trim() || undefined,
		});
		addLog("已发送本地通知", "success");
	}

	async function sendServerNotif() {
		if (!serverNotif.title.trim() || !manager) return;
		setServerNotifResult(null);
		try {
			const http = manager.getHttpClient();
			await http.sendNotify(
				serverNotif.title.trim(),
				serverNotif.body.trim() || undefined
			);
			setServerNotifResult({
				ok: true,
				msg: "已发送，若已连接 WebSocket 将收到通知",
			});
			addLog("已发送服务器通知", "success");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setServerNotifResult({ ok: false, msg });
			addLog(`服务器通知失败: ${msg}`, "error");
		}
	}

	async function mockCreateNote() {
		if (!mockNote.trim() || !manager) return;
		setMockResult(null);
		try {
			const http = manager.getHttpClient();
			await http.createNote({ content: mockNote.trim() });
			setLastSyncEvent("note:created");
			setMockResult({ ok: true, msg: "已创建便签，便签 Tab 将刷新" });
			addLog("已创建测试便签", "success");
		} catch (e) {
			setMockResult({
				ok: false,
				msg: e instanceof Error ? e.message : String(e),
			});
			addLog(`创建便签失败: ${String(e)}`, "error");
		}
	}

	async function mockCreateTask() {
		if (!mockTask.trim() || !manager) return;
		setMockResult(null);
		try {
			const http = manager.getHttpClient();
			await http.createTask({
				title: mockTask.trim(),
				description: "",
				status: "todo",
				priority: "medium",
				dueAt: undefined,
				noteId: undefined,
			});
			setLastSyncEvent("task:created");
			setMockResult({ ok: true, msg: "已创建任务，任务 Tab 将刷新" });
			addLog("已创建测试任务", "success");
		} catch (e) {
			setMockResult({
				ok: false,
				msg: e instanceof Error ? e.message : String(e),
			});
			addLog(`创建任务失败: ${String(e)}`, "error");
		}
	}

	async function mockAddClipboard() {
		if (!mockClipboard.trim() || !manager) return;
		setMockResult(null);
		try {
			const http = manager.getHttpClient();
			await http.addClipboardItem({
				type: "text",
				content: mockClipboard.trim(),
				createdAt: Date.now(),
			});
			setLastSyncEvent("clipboard:itemAdded");
			setMockResult({ ok: true, msg: "已添加剪贴板项，剪贴板 Tab 将刷新" });
			addLog("已添加测试剪贴板", "success");
		} catch (e) {
			setMockResult({
				ok: false,
				msg: e instanceof Error ? e.message : String(e),
			});
			addLog(`添加剪贴板失败: ${String(e)}`, "error");
		}
	}

	function triggerRefresh(eventType: string) {
		setLastSyncEvent(eventType);
		addLog(`已触发刷新: ${eventType}`, "info");
	}

	return (
		<section className="page settings-page">
			<div className="settings-section">
				<h2>本地通知测试</h2>
				<p className="form-hint">直接弹出应用内通知窗口，无需服务器</p>
				<div className="test-row">
					<Input
						value={localNotif.title}
						onChange={(e) =>
							setLocalNotif((f) => ({ ...f, title: e.target.value }))
						}
						placeholder="标题"
						className="test-input"
					/>
					<Input
						value={localNotif.body}
						onChange={(e) =>
							setLocalNotif((f) => ({ ...f, body: e.target.value }))
						}
						placeholder="内容（可选）"
						className="test-input"
					/>
					<Button
						type="primary"
						onClick={sendLocalNotif}
						disabled={!localNotif.title.trim()}
					>
						发送本地通知
					</Button>
				</div>
			</div>

			<div className="settings-section">
				<h2>服务器通知测试</h2>
				<p className="form-hint">
					通过 POST /notify 发送，会经 WebSocket 推送给已连接的客户端
				</p>
				<div className="test-row">
					<Input
						value={serverNotif.title}
						onChange={(e) =>
							setServerNotif((f) => ({ ...f, title: e.target.value }))
						}
						placeholder="标题"
						className="test-input"
					/>
					<Input
						value={serverNotif.body}
						onChange={(e) =>
							setServerNotif((f) => ({ ...f, body: e.target.value }))
						}
						placeholder="内容（可选）"
						className="test-input"
					/>
					<Button
						type="primary"
						onClick={sendServerNotif}
						disabled={!serverNotif.title.trim() || !manager}
					>
						发送服务器通知
					</Button>
				</div>
				{serverNotifResult && (
					<p
						className={`form-hint ${
							serverNotifResult.ok ? "text-success" : "text-error"
						}`}
					>
						{serverNotifResult.msg}
					</p>
				)}
			</div>

			<div className="settings-section">
				<h2>模拟数据</h2>
				<p className="form-hint">
					通过 API 创建数据，触发 WebSocket 同步，各 Tab 会自动刷新
				</p>
				<div className="test-actions">
					<div className="test-action">
						<Input
							value={mockNote}
							onChange={(e) => setMockNote(e.target.value)}
							placeholder="便签内容"
							className="test-input"
						/>
						<Button
							onClick={mockCreateNote}
							disabled={!mockNote.trim() || !manager}
						>
							创建便签
						</Button>
					</div>
					<div className="test-action">
						<Input
							value={mockTask}
							onChange={(e) => setMockTask(e.target.value)}
							placeholder="任务标题"
							className="test-input"
						/>
						<Button
							onClick={mockCreateTask}
							disabled={!mockTask.trim() || !manager}
						>
							创建任务
						</Button>
					</div>
					<div className="test-action">
						<Input
							value={mockClipboard}
							onChange={(e) => setMockClipboard(e.target.value)}
							placeholder="剪贴板内容"
							className="test-input"
						/>
						<Button
							onClick={mockAddClipboard}
							disabled={!mockClipboard.trim() || !manager}
						>
							添加剪贴板
						</Button>
					</div>
				</div>
				{mockResult && (
					<p
						className={`form-hint ${
							mockResult.ok ? "text-success" : "text-error"
						}`}
					>
						{mockResult.msg}
					</p>
				)}
			</div>

			<div className="settings-section">
				<h2>手动刷新</h2>
				<p className="form-hint">强制触发各 Tab 列表刷新（用于测试数据同步）</p>
				<div className="config-actions">
					<Button onClick={() => triggerRefresh("note:created")}>
						刷新便签
					</Button>
					<Button onClick={() => triggerRefresh("task:created")}>
						刷新任务
					</Button>
					<Button onClick={() => triggerRefresh("clipboard:itemAdded")}>
						刷新剪贴板
					</Button>
				</div>
			</div>
		</section>
	);
}
