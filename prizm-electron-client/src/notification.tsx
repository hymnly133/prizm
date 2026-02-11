/**
 * 通知窗口 - React 入口
 */
import { createRoot } from "react-dom/client";
import NotificationApp from "./NotificationApp";

declare global {
	interface Window {
		notificationApi?: {
			onNotification: (
				callback: (payload: { title: string; body?: string }) => void
			) => void;
			notifyPanelEmpty?: () => void;
			notifyReady?: () => void;
		};
	}
}

const root = createRoot(document.getElementById("notification-app")!);
root.render(<NotificationApp />);
