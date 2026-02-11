import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig, resetConfig } from "./config";

describe("config", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		resetConfig();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("返回默认配置", () => {
		const cfg = getConfig();
		expect(cfg.port).toBe(4127);
		expect(cfg.host).toBe("127.0.0.1");
		expect(cfg.dataDir).toContain(".prizm-data");
		expect(cfg.authEnabled).toBe(true);
		expect(cfg.enableCors).toBe(true);
		expect(cfg.enableWebSocket).toBe(true);
		expect(cfg.websocketPath).toBe("/ws");
		expect(cfg.logLevel).toBe("info");
	});

	it("PRIZM_PORT 覆盖端口", () => {
		process.env.PRIZM_PORT = "5000";
		const cfg = getConfig();
		expect(cfg.port).toBe(5000);
	});

	it("PRIZM_HOST 覆盖地址", () => {
		process.env.PRIZM_HOST = "0.0.0.0";
		const cfg = getConfig();
		expect(cfg.host).toBe("0.0.0.0");
	});

	it("PRIZM_AUTH_DISABLED=1 关闭鉴权", () => {
		process.env.PRIZM_AUTH_DISABLED = "1";
		const cfg = getConfig();
		expect(cfg.authEnabled).toBe(false);
	});

	it("PRIZM_LOG_LEVEL 支持 warn/error", () => {
		process.env.PRIZM_LOG_LEVEL = "warn";
		const cfg = getConfig();
		expect(cfg.logLevel).toBe("warn");

		resetConfig();
		process.env.PRIZM_LOG_LEVEL = "error";
		const cfg2 = getConfig();
		expect(cfg2.logLevel).toBe("error");
	});

	it("resetConfig 后重新读取环境变量", () => {
		process.env.PRIZM_PORT = "3000";
		const cfg1 = getConfig();
		expect(cfg1.port).toBe(3000);

		process.env.PRIZM_PORT = "4000";
		expect(getConfig().port).toBe(3000); // 缓存

		resetConfig();
		const cfg2 = getConfig();
		expect(cfg2.port).toBe(4000);
	});
});
