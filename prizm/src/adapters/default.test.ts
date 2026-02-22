import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DefaultAgentAdapter } from "./default";

describe("DefaultAgentAdapter", () => {
	let adapter: DefaultAgentAdapter;
	let testScope: string;

	beforeEach(() => {
		adapter = new DefaultAgentAdapter();
		testScope = `test-agent-${Date.now()}`;
	});

	afterEach(async () => {
		// 清理测试会话
		const list = await adapter.listSessions(testScope);
		for (const s of list) {
			await adapter.deleteSession(testScope, s.id);
		}
	});

	describe("createSession", () => {
		it("创建会话并返回", async () => {
			const session = await adapter.createSession(testScope);
			expect(session.id).toBeDefined();
			expect(session.scope).toBe(testScope);
			expect(session.messages).toEqual([]);
			expect(session.createdAt).toBeGreaterThan(0);
			expect(session.updatedAt).toBeGreaterThan(0);
		});
	});

	describe("listSessions", () => {
		it("空 scope 返回空数组", async () => {
			const list = await adapter.listSessions(testScope);
			expect(list).toEqual([]);
		});

		it("返回按 updatedAt 倒序的会话", async () => {
			const s1 = await adapter.createSession(testScope);
			const s2 = await adapter.createSession(testScope);
			const list = await adapter.listSessions(testScope);
			expect(list).toHaveLength(2);
			expect(list[0].id).toBe(s2.id);
			expect(list[1].id).toBe(s1.id);
		});
	});

	describe("getSession", () => {
		it("存在则返回", async () => {
			const created = await adapter.createSession(testScope);
			const session = await adapter.getSession(testScope, created.id);
			expect(session).not.toBeNull();
			expect(session?.id).toBe(created.id);
		});

		it("不存在返回 null", async () => {
			const session = await adapter.getSession(testScope, "nonexistent");
			expect(session).toBeNull();
		});
	});

	describe("deleteSession", () => {
		it("删除后 getSession 返回 null", async () => {
			const created = await adapter.createSession(testScope);
			await adapter.deleteSession(testScope, created.id);
			const session = await adapter.getSession(testScope, created.id);
			expect(session).toBeNull();
		});
	});

	describe("appendMessage", () => {
		it("追加消息到会话", async () => {
			const session = await adapter.createSession(testScope);
			const msg = await adapter.appendMessage(testScope, session.id, {
				role: "user",
				content: "hello",
			});
			expect(msg.id).toBeDefined();
			expect(msg.role).toBe("user");
			expect(msg.content).toBe("hello");

			const loaded = await adapter.getSession(testScope, session.id);
			expect(loaded?.messages).toHaveLength(1);
			expect(loaded?.messages[0].content).toBe("hello");
		});
	});

	describe("chat", () => {
		it("无 API Key 时返回占位回复", async () => {
			const orig = process.env.OPENAI_API_KEY;
			const origZhipu = process.env.ZHIPU_API_KEY;
			const origMimo = process.env.XIAOMIMIMO_API_KEY;
			delete process.env.OPENAI_API_KEY;
			delete process.env.ZHIPU_API_KEY;
			delete process.env.XIAOMIMIMO_API_KEY;

			const session = await adapter.createSession(testScope);
			const chunks: string[] = [];
			for await (const c of adapter.chat(testScope, session.id, [
				{ role: "user", content: "hi" },
			])) {
				if (c.text) chunks.push(c.text);
			}

			expect(chunks.join("")).toMatch(/请.*配置|API Key/);
			if (orig) process.env.OPENAI_API_KEY = orig;
			if (origZhipu) process.env.ZHIPU_API_KEY = origZhipu;
			if (origMimo) process.env.XIAOMIMIMO_API_KEY = origMimo;
		});
	});
});
