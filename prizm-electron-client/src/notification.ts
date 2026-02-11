/**
 * 通知窗口 - Vue 入口
 */
import { createApp } from "vue";
import NotificationApp from "./NotificationApp.vue";

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

createApp(NotificationApp).mount("#notification-app");
