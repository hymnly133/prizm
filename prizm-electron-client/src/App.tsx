import { useState, useEffect } from "react";
import WorkPage from "./views/WorkPage";
import SettingsPage from "./views/SettingsPage";
import TestPage from "./views/TestPage";
import AgentPage from "./views/AgentPage";
import { PrizmProvider, usePrizmContext } from "./context/PrizmContext";
import { LogsProvider, useLogsContext } from "./context/LogsContext";
import type { NotificationPayload } from "@prizm/client-core";

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

	return (
		<div className="app-shell">
			<header className="app-header">
				<div className="app-brand">
					<span
						className={`status-dot ${
							status === "connected"
								? "connected"
								: status === "disconnected"
								? "disconnected"
								: "error"
						}`}
					/>
					<h1>Prizm</h1>
				</div>
				<nav className="app-nav">
					<button
						className={`nav-btn ${activePage === "work" ? "active" : ""}`}
						onClick={() => setActivePage("work")}
					>
						工作
					</button>
					<button
						className={`nav-btn ${activePage === "agent" ? "active" : ""}`}
						onClick={() => setActivePage("agent")}
					>
						Agent
					</button>
					<button
						className={`nav-btn ${activePage === "settings" ? "active" : ""}`}
						onClick={() => setActivePage("settings")}
					>
						设置
					</button>
					<button
						className={`nav-btn ${activePage === "test" ? "active" : ""}`}
						onClick={() => setActivePage("test")}
					>
						测试
					</button>
				</nav>
			</header>

			<main className="app-main">
				{activePage === "work" && <WorkPage />}
				{activePage === "agent" && <AgentPage />}
				{activePage === "settings" && <SettingsPage />}
				{activePage === "test" && <TestPage />}
			</main>
		</div>
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
