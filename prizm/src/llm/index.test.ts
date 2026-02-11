import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	getLLMProvider,
	resetLLMProvider,
	OpenAILikeLLMProvider,
	ZhipuLLMProvider,
	XiaomiMiMoLLMProvider,
} from "./index";

describe("getLLMProvider", () => {
	const origOpenAI = process.env.OPENAI_API_KEY;
	const origZhipu = process.env.ZHIPU_API_KEY;
	const origMimo = process.env.XIAOMIMIMO_API_KEY;

	afterEach(() => {
		resetLLMProvider();
		if (origOpenAI !== undefined) process.env.OPENAI_API_KEY = origOpenAI;
		else delete process.env.OPENAI_API_KEY;
		if (origZhipu !== undefined) process.env.ZHIPU_API_KEY = origZhipu;
		else delete process.env.ZHIPU_API_KEY;
		if (origMimo !== undefined) process.env.XIAOMIMIMO_API_KEY = origMimo;
		else delete process.env.XIAOMIMIMO_API_KEY;
	});

	it("仅 ZHIPU_API_KEY 时返回 ZhipuLLMProvider", () => {
		process.env.ZHIPU_API_KEY = "zhipu-key";
		delete process.env.XIAOMIMIMO_API_KEY;
		delete process.env.OPENAI_API_KEY;

		const provider = getLLMProvider();
		expect(provider).toBeInstanceOf(ZhipuLLMProvider);
	});

	it("XIAOMIMIMO 优先于 ZHIPU（多个 key 时）", () => {
		process.env.XIAOMIMIMO_API_KEY = "mimo-key";
		process.env.ZHIPU_API_KEY = "zhipu-key";
		delete process.env.OPENAI_API_KEY;

		const provider = getLLMProvider();
		expect(provider).toBeInstanceOf(XiaomiMiMoLLMProvider);
	});

	it("仅 XIAOMIMIMO_API_KEY 时返回 XiaomiMiMoLLMProvider", () => {
		delete process.env.ZHIPU_API_KEY;
		process.env.XIAOMIMIMO_API_KEY = "mimo-key";
		delete process.env.OPENAI_API_KEY;

		const provider = getLLMProvider();
		expect(provider).toBeInstanceOf(XiaomiMiMoLLMProvider);
	});

	it("仅 OPENAI_API_KEY 时返回 OpenAILikeLLMProvider", () => {
		delete process.env.ZHIPU_API_KEY;
		delete process.env.XIAOMIMIMO_API_KEY;
		process.env.OPENAI_API_KEY = "openai-key";

		const provider = getLLMProvider();
		expect(provider).toBeInstanceOf(OpenAILikeLLMProvider);
	});

	it("无任何 key 时返回 OpenAILikeLLMProvider", () => {
		delete process.env.ZHIPU_API_KEY;
		delete process.env.XIAOMIMIMO_API_KEY;
		delete process.env.OPENAI_API_KEY;

		const provider = getLLMProvider();
		expect(provider).toBeInstanceOf(OpenAILikeLLMProvider);
	});

	it("返回单例", () => {
		process.env.OPENAI_API_KEY = "key";
		const p1 = getLLMProvider();
		const p2 = getLLMProvider();
		expect(p1).toBe(p2);
	});

	it("resetLLMProvider 后重新选择", () => {
		process.env.ZHIPU_API_KEY = "zhipu";
		const p1 = getLLMProvider();
		expect(p1).toBeInstanceOf(ZhipuLLMProvider);

		resetLLMProvider();
		delete process.env.ZHIPU_API_KEY;
		process.env.OPENAI_API_KEY = "openai";
		const p2 = getLLMProvider();
		expect(p2).toBeInstanceOf(OpenAILikeLLMProvider);
	});
});
