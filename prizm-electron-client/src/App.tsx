import { Button, Layout, Tag } from "@lobehub/ui";
import type { NotificationPayload } from "@prizm/client-core";
import { useState, useEffect } from "react";
import { LogsProvider, useLogsContext } from "./context/LogsContext";
import { PrizmProvider, usePrizmContext } from "./context/PrizmContext";
import AgentPage from "./views/AgentPage";
import SettingsPage from "./views/SettingsPage";
import TestPage from "./views/TestPage";
import WorkPage from "./views/WorkPage";

const STATUS_LABELS: Record<
	"connected" | "disconnected" | "connecting" | "error",
	string
> = {
	connected: "已连接",
	disconnected: "断开",
	connecting: "连接中",
	error: "错误",
};

function AppContent() {
	const { status, loadConfig, initializePrizm, disconnect, setLastSyncEvent } =
		usePrizmContext();
	const { addLog } = useLogsContext();
	const [activePage, setActivePage] = useState<
		"work" | "settings" | "test" | "agent"
	>("work");

	useEffect(() => {
		addLog("Prizm Electron 通知客户端启动", "info");
		const unsubscribeClipboard = window.prizm.onClipboardItemAdded(() => {
			setLastSyncEvent("clipboard:itemAdded");
		});

		async function init() {
			const cfg = await loadConfig();
			if (!cfg) {
				addLog("请先配置服务器并注册客户端", "warning");
				setActivePage("settings");
				return;
			}
			if (!cfg.api_key?.length) {
				addLog("需要注册客户端获取 API Key", "warning");
				setActivePage("settings");
				return;
			}
			await initializePrizm(cfg, {
				onLog: addLog,
				onNotify: (p: NotificationPayload) =>
					addLog(`通知: ${p.title}`, "info"),
			});
		}

		void init();

		return () => {
			unsubscribeClipboard?.();
			disconnect();
		};
	}, [addLog, loadConfig, initializePrizm, disconnect, setLastSyncEvent]);

	const statusColor =
		status === "connected"
			? "green"
			: status === "connecting"
			? "blue"
			: status === "disconnected"
			? "gold"
			: "red";

	const header = (
		<div className="app-header-inner">
			<div className="app-brand">
				<Tag color={statusColor} size="small">
					{STATUS_LABELS[status]}
				</Tag>
				<h1>Prizm</h1>
			</div>
			<nav className="app-nav">
				<Button
					size="small"
					type={activePage === "work" ? "primary" : "default"}
					onClick={() => setActivePage("work")}
				>
					工作
				</Button>
				<Button
					size="small"
					type={activePage === "agent" ? "primary" : "default"}
					onClick={() => setActivePage("agent")}
				>
					Agent
				</Button>
				<Button
					size="small"
					type={activePage === "settings" ? "primary" : "default"}
					onClick={() => setActivePage("settings")}
				>
					设置
				</Button>
				<Button
					size="small"
					type={activePage === "test" ? "primary" : "default"}
					onClick={() => setActivePage("test")}
				>
					测试
				</Button>
			</nav>
		</div>
	);

	return (
		<Layout header={header} headerHeight={56}>
			<div className="app-main">
				{activePage === "work" && <WorkPage />}
				{activePage === "agent" && <AgentPage />}
				{activePage === "settings" && <SettingsPage />}
				{activePage === "test" && <TestPage />}
			</div>
		</Layout>
	);
}

export default function App() {
	return (
		<LogsProvider>
			<PrizmProvider>
				<AppContent />
			</PrizmProvider>
		</LogsProvider>
	);
}
