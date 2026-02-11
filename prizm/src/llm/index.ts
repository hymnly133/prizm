/**
 * LLM 提供商工厂与选择逻辑
 * 默认优先：XIAOMIMIMO_API_KEY > ZHIPU_API_KEY > OPENAI_API_KEY
 */

import type { ILLMProvider } from "../adapters/interfaces";
import { OpenAILikeLLMProvider } from "./OpenAILikeProvider";
import { ZhipuLLMProvider } from "./ZhipuProvider";
import { XiaomiMiMoLLMProvider } from "./XiaomiMiMoProvider";

let _defaultProvider: ILLMProvider | null = null;

/**
 * 根据环境变量选择 LLM 提供商
 * - XIAOMIMIMO_API_KEY: 小米 MiMo（默认优先）
 * - ZHIPU_API_KEY: 智谱 AI (GLM)
 * - OPENAI_API_KEY: OpenAI 或兼容 API
 */
export function getLLMProvider(): ILLMProvider {
	if (_defaultProvider) return _defaultProvider;

	if (process.env.XIAOMIMIMO_API_KEY?.trim()) {
		_defaultProvider = new XiaomiMiMoLLMProvider();
	} else if (process.env.ZHIPU_API_KEY?.trim()) {
		_defaultProvider = new ZhipuLLMProvider();
	} else {
		_defaultProvider = new OpenAILikeLLMProvider();
	}

	return _defaultProvider;
}

/**
 * 重置默认提供商（用于测试）
 */
export function resetLLMProvider(): void {
	_defaultProvider = null;
}

export { OpenAILikeLLMProvider } from "./OpenAILikeProvider";
export { ZhipuLLMProvider } from "./ZhipuProvider";
export { XiaomiMiMoLLMProvider } from "./XiaomiMiMoProvider";
