import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { ScopeStore, DEFAULT_SCOPE } from "./ScopeStore";

describe("ScopeStore", () => {
	let tempDir: string;
	let store: ScopeStore;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `prizm-test-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		store = new ScopeStore(tempDir);
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("getScopeData 返回空数据", () => {
		const data = store.getScopeData("default");
		expect(data.notes).toEqual([]);
		expect(data.groups).toEqual([]);
		expect(data.tasks).toEqual([]);
		expect(data.pomodoroSessions).toEqual([]);
		expect(data.clipboard).toEqual([]);
	});

	it("getScopeData 新建 scope 并持久化", () => {
		const data = store.getScopeData("test-scope");
		data.notes.push({
			id: "1",
			content: "hello",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		store.saveScope("test-scope");

		const filePath = path.join(tempDir, "scopes", "test-scope.json");
		expect(fs.existsSync(filePath)).toBe(true);
		const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		expect(content.notes).toHaveLength(1);
		expect(content.notes[0].content).toBe("hello");
	});

	it("ensureScope 等同于 getScopeData", () => {
		const data = store.ensureScope("demo");
		expect(data).toBeDefined();
		expect(store.getScopeData("demo")).toBe(data);
	});

	it("getAllScopes 包含 default", () => {
		const scopes = store.getAllScopes();
		expect(scopes).toContain(DEFAULT_SCOPE);
	});

	it("scope 名特殊字符被替换", () => {
		store.getScopeData("foo/bar");
		const scopesDir = path.join(tempDir, "scopes");
		const files = fs.readdirSync(scopesDir);
		expect(files.some((f) => f.includes("foo") && f.includes("bar"))).toBe(
			true
		);
	});
});
