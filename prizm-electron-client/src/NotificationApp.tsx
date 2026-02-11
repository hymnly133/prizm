import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

interface NotifItem {
	id: string;
	title: string;
	body?: string;
	source?: string;
	createdAt: number;
}

const AUTO_DISMISS_MS = 8000;
const MAX_VISIBLE = 12;

function formatTime(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const isToday =
		d.getDate() === now.getDate() &&
		d.getMonth() === now.getMonth() &&
		d.getFullYear() === now.getFullYear();
	if (isToday) {
		return d.toLocaleTimeString("zh-CN", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	}
	return d.toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function nextId() {
	return "notif-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
}

export default function NotificationApp() {
	const [items, setItems] = useState<NotifItem[]>([]);

	function remove(id: string) {
		const t = timers.get(id);
		if (t) {
			clearTimeout(t);
			timers.delete(id);
		}
		setItems((prev) => prev.filter((x) => x.id !== id));
	}

	const prevLenRef = useRef(0);
	useEffect(() => {
		const prev = prevLenRef.current;
		prevLenRef.current = items.length;
		if (prev > 0 && items.length === 0) {
			window.notificationApi?.notifyPanelEmpty?.();
		}
	}, [items.length]);

	useEffect(() => {
		function show(payload: {
			title?: string;
			body?: string;
			source?: string;
			[key: string]: unknown;
		}) {
			const item: NotifItem = {
				id: nextId(),
				title: payload.title || "通知",
				body: payload.body,
				source: payload.source as string | undefined,
				createdAt: Date.now(),
			};
			setItems((prev) => {
				const next = [...prev, item];
				if (next.length > MAX_VISIBLE) {
					const oldest = next[0];
					const t = timers.get(oldest.id);
					if (t) {
						clearTimeout(t);
						timers.delete(oldest.id);
					}
					return next.slice(1);
				}
				return next;
			});

			const timer = setTimeout(() => {
				timers.delete(item.id);
				remove(item.id);
			}, AUTO_DISMISS_MS);
			timers.set(item.id, timer);
		}

		window.notificationApi?.onNotification?.(show);
		window.notificationApi?.notifyReady?.();
	}, []);

	return (
		<div className="notification-panel">
			{items.map((item) => (
				<div
					key={item.id}
					className="notification-item"
					role="alert"
					aria-live="polite"
					onClick={() => remove(item.id)}
				>
					<div className="notification-item__content">
						<div className="notification-item__title">
							<ReactMarkdown>{item.title || "通知"}</ReactMarkdown>
						</div>
						{item.body && (
							<div className="notification-item__body">
								<ReactMarkdown>{item.body}</ReactMarkdown>
							</div>
						)}
						<div className="notification-item__meta">
							{formatTime(item.createdAt)}
							{item.source && (
								<span className="notification-item__source">
									· {item.source}
								</span>
							)}
						</div>
					</div>
					<button
						className="notification-item__close"
						type="button"
						aria-label="关闭"
						onClick={(e) => {
							e.stopPropagation();
							remove(item.id);
						}}
					>
						×
					</button>
				</div>
			))}
		</div>
	);
}
