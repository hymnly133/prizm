/**
 * 小米 MiMo LLM 提供商
 * 环境变量：XIAOMIMIMO_API_KEY
 * API 文档：https://platform.xiaomimimo.com/
 */

import type { ILLMProvider, LLMStreamChunk } from "../adapters/interfaces";

const BASE_URL = "https://api.xiaomimimo.com/v1";

function getApiKey(): string | undefined {
	return process.env.XIAOMIMIMO_API_KEY?.trim();
}

export class XiaomiMiMoLLMProvider implements ILLMProvider {
	async *chat(
		messages: Array<{ role: string; content: string }>,
		options?: { model?: string; temperature?: number }
	): AsyncIterable<LLMStreamChunk> {
		const apiKey = getApiKey();
		if (!apiKey) {
			yield { text: "（请配置 XIAOMIMIMO_API_KEY 环境变量以使用小米 MiMo）" };
			yield { done: true };
			return;
		}

		const model =
			options?.model ?? process.env.XIAOMIMIMO_MODEL ?? "mimo-v2-flash";
		const url = `${BASE_URL}/chat/completions`;

		const body = {
			model,
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
			stream: true,
			temperature: options?.temperature ?? 0.7,
		};

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`小米 MiMo API 错误 ${response.status}: ${errText}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error("No response body");
		}

		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6);
						if (data === "[DONE]") {
							yield { done: true };
							return;
						}
						try {
							const parsed = JSON.parse(data) as {
								choices?: Array<{
									delta?: { content?: string };
									finish_reason?: string;
								}>;
							};
							const delta = parsed.choices?.[0]?.delta?.content;
							if (delta) {
								yield { text: delta };
							}
							if (parsed.choices?.[0]?.finish_reason) {
								yield { done: true };
							}
						} catch {
							// 忽略解析错误
						}
					}
				}
			}

			if (buffer.trim()) {
				const line = buffer.trim();
				if (line.startsWith("data: ") && line !== "data: [DONE]") {
					try {
						const parsed = JSON.parse(line.slice(6)) as {
							choices?: Array<{ delta?: { content?: string } }>;
						};
						const delta = parsed.choices?.[0]?.delta?.content;
						if (delta) yield { text: delta };
					} catch {
						// ignore
					}
				}
			}

			yield { done: true };
		} finally {
			reader.releaseLock();
		}
	}
}
