import { useState, useEffect } from "react";
import { EVENT_TYPES, getEventLabel, buildServerUrl } from "@prizm/client-core";
import { usePrizmContext } from "../context/PrizmContext";
import { useLogsContext } from "../context/LogsContext";
import type { PrizmConfig, EventType } from "@prizm/client-core";

export default function SettingsPage() {
	const {
		config,
		loadConfig,
		saveConfig: saveConfigApi,
		testConnection: testConnectionApi,
		registerClient: registerClientApi,
		initializePrizm,
		setConfig,
	} = usePrizmContext();
	const { logs, addLog } = useLogsContext();

	const [testing, setTesting] = useState(false);
	const [registering, setRegistering] = useState(false);
	const [reconnecting, setReconnecting] = useState(false);
	const [form, setForm] = useState({
		host: "127.0.0.1",
		port: "4127",
		clientName: "Prizm Electron Client",
		scopesText: "default, online",
		notifyEvents: ["notification"] as string[],
	});

	useEffect(() => {
		if (config) {
			setForm({
				host: config.server.host,
				port: config.server.port,
				clientName: config.client.name,
				scopesText: config.client.requested_scopes.join(", "),
				notifyEvents: [...(config.notify_events ?? ["notification"])],
			});
		}
	}, [config]);

	async function saveConfig() {
		const scopes = form.scopesText
			? form.scopesText
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: ["default", "online"];
		const base = config ?? {
			server: { host: "", port: "", is_dev: "true" },
			client: {
				name: "",
				auto_register: "true",
				requested_scopes: ["default", "online"],
			},
			api_key: "",
			tray: {
				enabled: "true",
				minimize_to_tray: "true",
				show_notification: "true",
			},
			notify_events: ["notification"],
		};
		const cfg: PrizmConfig = { ...base };
		cfg.server = { ...cfg.server, host: form.host, port: form.port };
		cfg.client = {
			...cfg.client,
			name: form.clientName,
			requested_scopes: scopes,
		};
		cfg.notify_events = form.notifyEvents as EventType[];
		const ok = await saveConfigApi(cfg);
		if (ok) {
			setConfig(cfg);
			addLog("配置已保存", "success");
		}
	}

	async function testConnection() {
		const serverUrl = buildServerUrl(form.host.trim(), form.port.trim());
		if (!form.host.trim() || !form.port.trim()) {
			addLog("请填写服务器地址和端口", "error");
			return;
		}
		setTesting(true);
		const success = await testConnectionApi(serverUrl);
		setTesting(false);
		addLog(
			success ? "服务器连接成功" : "无法连接到服务器",
			success ? "success" : "error"
		);
	}

	async function registerClient() {
		const serverUrl = buildServerUrl(form.host.trim(), form.port.trim());
		if (!form.host.trim() || !form.port.trim()) {
			addLog("请填写服务器地址和端口", "error");
			return;
		}
		if (!form.clientName.trim()) {
			addLog("请填写客户端名称", "error");
			return;
		}
		const scopes = form.scopesText
			? form.scopesText
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: ["default", "online"];
		setRegistering(true);
		const apiKey = await registerClientApi(
			serverUrl,
			form.clientName.trim(),
			scopes
		);
		setRegistering(false);
		if (apiKey) {
			const cfg = await loadConfig();
			if (cfg) {
				setConfig(cfg);
				addLog("注册成功，正在重新加载...", "success");
				window.location.reload();
			}
		}
	}

	async function reconnect() {
		const c = config;
		if (!c) {
			addLog("没有配置可用的服务器", "error");
			return;
		}
		setReconnecting(true);
		try {
			await initializePrizm(c, {
				onLog: addLog,
				onNotify: (p) => addLog(`通知: ${p.title}`, "info"),
			});
		} finally {
			setReconnecting(false);
		}
	}

	async function openDashboard() {
		const c = config;
		if (!c) {
			addLog("没有配置可用的服务器", "error");
			return;
		}
		try {
			await window.prizm.openDashboard(
				buildServerUrl(c.server.host, c.server.port)
			);
			addLog("已打开仪表板", "success");
		} catch (e) {
			addLog(`打开仪表板失败: ${String(e)}`, "error");
		}
	}

	useEffect(() => {
		if (!config) {
			setForm({
				host: "127.0.0.1",
				port: "4127",
				clientName: "Prizm Electron Client",
				scopesText: "default, online",
				notifyEvents: ["notification"],
			});
		}
	}, []);

	return (
		<section className="page settings-page">
			<div className="settings-section">
				<h2>服务器配置</h2>
				<div className="form-group">
					<label>服务器地址</label>
					<input
						value={form.host}
						onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
						type="text"
						placeholder="127.0.0.1"
					/>
				</div>
				<div className="form-group">
					<label>端口</label>
					<input
						value={form.port}
						onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
						type="number"
						placeholder="4127"
					/>
					<p className="form-hint">默认端口: 4127</p>
				</div>
				<div className="form-group">
					<label>客户端名称</label>
					<input
						value={form.clientName}
						onChange={(e) =>
							setForm((f) => ({ ...f, clientName: e.target.value }))
						}
						type="text"
						placeholder="Prizm Electron Client"
					/>
				</div>
				<div className="form-group">
					<label>请求的 Scopes (逗号分隔)</label>
					<input
						value={form.scopesText}
						onChange={(e) =>
							setForm((f) => ({ ...f, scopesText: e.target.value }))
						}
						type="text"
						placeholder="default, online"
					/>
					<p className="form-hint">
						例如: default, online（online 为实时上下文）
					</p>
				</div>
				<div className="form-group">
					<label>接收通知的事件</label>
					<p className="form-hint">勾选后，对应事件发生时将弹出应用内通知</p>
					<div className="notify-events-grid">
						{EVENT_TYPES.map((ev) => (
							<label key={ev}>
								<input
									type="checkbox"
									value={ev}
									checked={form.notifyEvents.includes(ev)}
									onChange={(e) => {
										if (e.target.checked) {
											setForm((f) => ({
												...f,
												notifyEvents: [...f.notifyEvents, ev],
											}));
										} else {
											setForm((f) => ({
												...f,
												notifyEvents: f.notifyEvents.filter((x) => x !== ev),
											}));
										}
									}}
								/>
								{getEventLabel(ev)}
							</label>
						))}
					</div>
				</div>
				<div className="config-actions">
					<button
						className="btn-secondary"
						onClick={testConnection}
						disabled={testing}
					>
						{testing ? "测试中..." : "测试连接"}
					</button>
					<button className="btn-secondary" onClick={saveConfig}>
						保存配置
					</button>
					<button
						className="btn-primary"
						onClick={registerClient}
						disabled={registering}
					>
						{registering ? "注册中..." : "注册客户端"}
					</button>
				</div>
			</div>

			<div className="settings-section">
				<h2>快捷操作</h2>
				<div className="config-actions">
					<button
						className="btn-secondary"
						onClick={reconnect}
						disabled={reconnecting}
					>
						{reconnecting ? "重新连接中..." : "重新连接"}
					</button>
					<button className="btn-secondary" onClick={openDashboard}>
						打开仪表板
					</button>
				</div>
			</div>

			<div className="settings-section logs-section">
				<h2>日志</h2>
				<div className="logs">
					{logs.length === 0 ? (
						<div className="log-placeholder">等待连接...</div>
					) : (
						logs.map((log, i) => (
							<div key={i} className={`log-item ${log.type}`}>
								<span className="log-time">[{log.timestamp}]</span>
								<span className="log-msg">{log.message}</span>
							</div>
						))
					)}
				</div>
			</div>
		</section>
	);
}
