/**
 * Prizm API 客户端
 * 开发时通过 Vite proxy 转发，生产时同源请求
 */

const getBaseUrl = (): string => {
	if (import.meta.env.DEV) {
		return ""; // Vite proxy 会转发到 4127
	}
	return ""; // 同源
};

export interface RequestOptions extends RequestInit {
	scope?: string;
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
	const { scope, ...rest } = options ?? {};
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-Prizm-Panel": "true",
		...(rest.headers as Record<string, string>),
	};
	let url = `${getBaseUrl()}${path}`;
	let body = rest.body;
	if (scope) {
		const method = (rest.method ?? "GET").toUpperCase();
		if (method === "GET" || method === "DELETE") {
			url +=
				(path.includes("?") ? "&" : "?") + `scope=${encodeURIComponent(scope)}`;
		} else if (body && typeof body === "string") {
			try {
				const parsed = JSON.parse(body) as Record<string, unknown>;
				parsed.scope = scope;
				body = JSON.stringify(parsed);
			} catch {
				// ignore
			}
		} else {
			body = JSON.stringify({ scope });
		}
	}
	const res = await fetch(url, {
		...rest,
		body,
		headers,
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
	}
	if (res.status === 204) return undefined as T;
	return res.json();
}

// Health
export const getHealth = () => request<{ status: string }>("/health");

// Auth / Clients
export interface ClientInfo {
	clientId: string;
	name: string;
	allowedScopes: string[];
	createdAt: number;
}
export interface ScopeDescription {
	label: string;
	description: string;
}
export const getScopes = () =>
	request<{
		scopes: string[];
		descriptions?: Record<string, ScopeDescription>;
	}>("/auth/scopes");
export const getClients = () =>
	request<{ clients: ClientInfo[] }>("/auth/clients");
export const revokeClientById = (clientId: string) =>
	request<void>(`/auth/clients/${encodeURIComponent(clientId)}`, {
		method: "DELETE",
	});
export const regenerateClientApiKey = (clientId: string) =>
	request<{ apiKey: string }>(
		`/auth/clients/${encodeURIComponent(clientId)}/regenerate-key`,
		{
			method: "POST",
		}
	);
export const registerClient = (name: string, requestedScopes?: string[]) =>
	request<{ clientId: string; apiKey: string }>("/auth/register", {
		method: "POST",
		body: JSON.stringify({
			name,
			requestedScopes: requestedScopes ?? ["default"],
		}),
	});

// Notes（支持 scope）
export const getNotes = (scope?: string) =>
	request<{ notes: StickyNote[] }>("/notes", { scope });
export const getNote = (id: string, scope?: string) =>
	request<{ note: StickyNote }>(`/notes/${id}`, { scope });
export const createNote = (payload: CreateNotePayload, scope?: string) =>
	request<{ note: StickyNote }>("/notes", {
		method: "POST",
		body: JSON.stringify(payload),
		scope,
	});
export const updateNote = (
	id: string,
	payload: UpdateNotePayload,
	scope?: string
) =>
	request<{ note: StickyNote }>(`/notes/${id}`, {
		method: "PATCH",
		body: JSON.stringify(payload),
		scope,
	});
export const deleteNote = (id: string, scope?: string) =>
	request<void>(`/notes/${id}`, { method: "DELETE", scope });

// Notes Groups（支持 scope）
export const getGroups = (scope?: string) =>
	request<{ groups: StickyNoteGroup[] }>("/notes/groups", { scope });
export const createGroup = (name: string, scope?: string) =>
	request<{ group: StickyNoteGroup }>("/notes/groups", {
		method: "POST",
		body: JSON.stringify({ name }),
		scope,
	});
export const updateGroup = (id: string, name: string, scope?: string) =>
	request<{ group: StickyNoteGroup }>(`/notes/groups/${id}`, {
		method: "PATCH",
		body: JSON.stringify({ name }),
		scope,
	});
export const deleteGroup = (id: string, scope?: string) =>
	request<void>(`/notes/groups/${id}`, { method: "DELETE", scope });

// Notify
export const sendNotify = (title: string, body?: string) =>
	request<{ success: boolean }>("/notify", {
		method: "POST",
		body: JSON.stringify({ title, body }),
	});

// Types
export interface StickyNoteFileRef {
	path: string;
}

export interface StickyNote {
	id: string;
	content: string;
	imageUrls?: string[];
	createdAt: number;
	updatedAt: number;
	groupId?: string;
	fileRefs?: StickyNoteFileRef[];
}

export interface StickyNoteGroup {
	id: string;
	name: string;
}

export interface CreateNotePayload {
	content?: string;
	imageUrls?: string[];
	groupId?: string;
	fileRefs?: StickyNoteFileRef[];
}

export interface UpdateNotePayload {
	content?: string;
	imageUrls?: string[];
	groupId?: string;
	fileRefs?: StickyNoteFileRef[];
}
