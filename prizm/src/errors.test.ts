import { describe, it, expect } from "vitest";
import {
	getErrorMessage,
	toErrorResponse,
	PrizmError,
	NotFoundError,
	ValidationError,
	ServiceUnavailableError,
} from "./errors";

describe("getErrorMessage", () => {
	it("Error 返回 message", () => {
		expect(getErrorMessage(new Error("test"))).toBe("test");
	});

	it("string 原样返回", () => {
		expect(getErrorMessage("hello")).toBe("hello");
	});

	it("其它类型转 String", () => {
		expect(getErrorMessage(123)).toBe("123");
		expect(getErrorMessage(null)).toBe("null");
	});
});

describe("toErrorResponse", () => {
	it("PrizmError 使用其 httpStatus", () => {
		const err = new NotFoundError("not found");
		const res = toErrorResponse(err);
		expect(res.status).toBe(404);
		expect(res.body.error).toBe("not found");
	});

	it("ValidationError 返回 400", () => {
		const err = new ValidationError("invalid");
		const res = toErrorResponse(err);
		expect(res.status).toBe(400);
	});

	it("ServiceUnavailableError 返回 503", () => {
		const err = new ServiceUnavailableError("unavailable");
		const res = toErrorResponse(err);
		expect(res.status).toBe(503);
	});

	it("普通 Error 含 not found 返回 404", () => {
		const res = toErrorResponse(new Error("Task not found: xyz"));
		expect(res.status).toBe(404);
		expect(res.body.error).toContain("not found");
	});

	it("普通 Error 不含 not found 返回 500", () => {
		const res = toErrorResponse(new Error("something broke"));
		expect(res.status).toBe(500);
		expect(res.body.error).toBe("something broke");
	});

	it("string 错误返回 500", () => {
		const res = toErrorResponse("unknown");
		expect(res.status).toBe(500);
		expect(res.body.error).toBe("unknown");
	});
});

describe("PrizmError 子类", () => {
	it("NotFoundError 正确继承", () => {
		const err = new NotFoundError("x");
		expect(err.name).toBe("NotFoundError");
		expect(err.code).toBe("NOT_FOUND");
		expect(err.httpStatus).toBe(404);
	});

	it("ValidationError 正确继承", () => {
		const err = new ValidationError("x");
		expect(err.httpStatus).toBe(400);
	});

	it("ServiceUnavailableError 正确继承", () => {
		const err = new ServiceUnavailableError("x");
		expect(err.httpStatus).toBe(503);
	});
});
