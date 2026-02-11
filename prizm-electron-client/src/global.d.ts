import type { PrizmConfig } from "@prizm/client-core";

declare global {
	interface Window {
		prizm: {
			loadConfig(): Promise<PrizmConfig | null>;
			saveConfig(config: PrizmConfig): Promise<boolean>;
			testConnection(serverUrl: string): Promise<boolean>;
			registerClient(
				serverUrl: string,
				clientName: string,
				scopes: string[]
			): Promise<string | null>;
			getAppVersion(): Promise<string>;
			openDashboard(serverUrl: string): Promise<boolean>;
			readClipboard(): Promise<string>;
			writeClipboard(text: string): Promise<boolean>;
			startClipboardSync(config: {
				serverUrl: string;
				apiKey: string;
				scope?: string;
			}): Promise<boolean>;
			stopClipboardSync(): Promise<boolean>;
			onClipboardItemAdded(callback: () => void): () => void;
			showNotification(payload: {
				title: string;
				body?: string;
				source?: string;
			}): Promise<boolean>;
		};
	}
}

export {};
