/**
 * Prizm 结构化错误类型
 * 统一错误码、HTTP 状态和消息格式
 */

export type PrizmErrorCode =
	| "NOT_FOUND"
	| "VALIDATION"
	| "SERVICE_UNAVAILABLE"
	| "INTERNAL";

export interface PrizmErrorResponse {
	/** HTTP 状态码 */
	status: number;
	/** 错误响应体 */
	body: { error: string };
}

/**
 * Prizm 业务错误基类
 */
export class PrizmError extends Error {
	readonly code: PrizmErrorCode;
	readonly httpStatus: number;

	constructor(
		message: string,
		options?: { code?: PrizmErrorCode; httpStatus?: number }
	) {
		super(message);
		this.name = "PrizmError";
		this.code = options?.code ?? "INTERNAL";
		this.httpStatus = options?.httpStatus ?? 500;
		Object.setPrototypeOf(this, PrizmError.prototype);
	}
}

/** 404 资源不存在 */
export class NotFoundError extends PrizmError {
	constructor(message: string) {
		super(message, { code: "NOT_FOUND", httpStatus: 404 });
		this.name = "NotFoundError";
	}
}

/** 400 参数校验失败 */
export class ValidationError extends PrizmError {
	constructor(message: string) {
		super(message, { code: "VALIDATION", httpStatus: 400 });
		this.name = "ValidationError";
	}
}

/** 503 服务不可用（如 adapter 未配置） */
export class ServiceUnavailableError extends PrizmError {
	constructor(message: string) {
		super(message, { code: "SERVICE_UNAVAILABLE", httpStatus: 503 });
		this.name = "ServiceUnavailableError";
	}
}

/**
 * 从 unknown 安全提取错误消息
 */
export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return String(error);
}

/**
 * 将任意错误转换为统一的 HTTP 响应格式
 * - PrizmError 及其子类：使用其 httpStatus
 * - 普通 Error 且 message 含 "not found"：返回 404
 * - 其他：返回 500
 */
export function toErrorResponse(error: unknown): PrizmErrorResponse {
	const message = getErrorMessage(error);

	if (error instanceof PrizmError) {
		return { status: error.httpStatus, body: { error: message } };
	}

	// 兼容 adapter 抛出的 new Error("xxx not found: id")
	if (/not found/i.test(message)) {
		return { status: 404, body: { error: message } };
	}

	return { status: 500, body: { error: message } };
}
