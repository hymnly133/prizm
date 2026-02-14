/**
 * 同步事件发射器 - 用于 useFileList 等在不受 lastSyncEvent 上下文更新影响下监听数据变更
 * 避免每次 WebSocket 事件都导致 WorkPage 重渲染
 */
type Listener = (eventType: string) => void;

const listeners = new Set<Listener>();

export function subscribeSyncEvents(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function emitSyncEvent(eventType: string): void {
	listeners.forEach((fn) => fn(eventType));
}
