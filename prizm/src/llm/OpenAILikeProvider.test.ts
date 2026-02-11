import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenAILikeLLMProvider } from "./OpenAILikeProvider";

describe("OpenAILikeLLMProvider", () => {
	let provider: OpenAILikeLLMProvider;
	const origKey = process.env.OPENAI_API_KEY;

	beforeEach(() => {
		provider = new OpenAILikeLLMProvider();
		delete process.env.OPENAI_API_KEY;
	});

	afterEach(() => {
		if (origKey) process.env.OPENAI_API_KEY = origKey;
		vi.restoreAllMocks();
	});

	it("无 API Key 时返回占位回复", async () => {
		const chunks: string[] = [];
		for await (const c of provider.chat([{ role: "user", content: "hi" }])) {
			if (c.text) chunks.push(c.text);
		}
		expect(chunks.join("")).toContain("请配置");
	});

	it("有 API Key 时调用 fetch", async () => {
		process.env.OPENAI_API_KEY = "test-key";

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			body: {
				getReader: () => ({
					read: async () => ({
						done: true,
						value: new TextEncoder().encode("data: [DONE]\n\n"),
					}),
					releaseLock: () => {},
				}),
			},
		});

		vi.stubGlobal("fetch", mockFetch);

		const provider2 = new OpenAILikeLLMProvider();
		const chunks: string[] = [];
		for await (const c of provider2.chat([{ role: "user", content: "hi" }])) {
			if (c.text) chunks.push(c.text);
		}

		expect(mockFetch).toHaveBeenCalled();
		expect(mockFetch.mock.calls[0][0]).toContain("/chat/completions");
		expect(mockFetch.mock.calls[0][1]?.headers?.Authorization).toContain(
			"test-key"
		);
	});
});
