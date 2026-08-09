import { toast } from "../components/common/Toast";

export interface ApiFeedbackOptions {
	notify?: boolean;
	context?: string;
	acceptStatuses?: readonly number[];
}

type ApiErrorBody = Record<string, unknown> | unknown[] | string | null;

export class ApiError extends Error {
	constructor(public status: number, message: string, public body?: ApiErrorBody) {
		super(message);
		this.name = "ApiError";
	}
}

function statusMessage(status: number): string {
	if (status === 401 || status === 403) return "\u{6ca1}\u{6709}\u{6743}\u{9650}\u{6267}\u{884c}\u{6b64}\u{64cd}\u{4f5c}";
	if (status === 404) return "\u{8bf7}\u{6c42}\u{7684}\u{8d44}\u{6e90}\u{4e0d}\u{5b58}\u{5728}";
	if (status === 409) return "\u{5185}\u{5bb9}\u{5df2}\u{88ab}\u{5176}\u{4ed6}\u{64cd}\u{4f5c}\u{4fee}\u{6539}\u{ff0c}\u{8bf7}\u{5237}\u{65b0}\u{540e}\u{91cd}\u{8bd5}";
	if (status >= 500) return "\u{670d}\u{52a1}\u{6682}\u{65f6}\u{4e0d}\u{53ef}\u{7528}\u{ff0c}\u{8bf7}\u{7a0d}\u{540e}\u{91cd}\u{8bd5}";
	return `\u{8bf7}\u{6c42}\u{5931}\u{8d25}\u{ff08}${status}\u{ff09}`;
}

function errorMessage(body: ApiErrorBody, fallback: string): string {
	if (body && !Array.isArray(body) && typeof body === "object") {
		const message = body.error ?? body.message;
		if (typeof message === "string" && message.trim()) return message;
	}
	if (typeof body === "string" && body.trim()) return body.slice(0, 180);
	return fallback;
}

/** All viewer requests cross this transport/status/conflict boundary. */
export async function apiFetch(
	url: string,
	options?: RequestInit,
	feedback: ApiFeedbackOptions = {},
): Promise<Response> {
	const notify = feedback.notify !== false;
	let response: Response;
	try {
		const headers = new Headers(options?.headers);
		// 本机标记头：服务端对带 Origin 的写请求强制要求（跨域预检因无 CORS 头被浏览器
		// 拦截，攻击域名无法携带；同源页面统一在此注入）。无 Origin 的 CLI/hook 不受影响。
		headers.set("X-GraphBrain-Local", "1");
		response = await fetch(url, { ...options, headers });
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") throw error;
		const message = `${feedback.context ? `${feedback.context}\u{ff1a}` : ""}\u{7f51}\u{7edc}\u{8fde}\u{63a5}\u{5931}\u{8d25}`;
		if (notify) toast(message, "error");
		throw error;
	}

	if (response.ok || feedback.acceptStatuses?.includes(response.status)) return response;

	let body: ApiErrorBody = null;
	try {
		const raw = await response.clone().text();
		if (raw) {
			try {
				body = JSON.parse(raw) as ApiErrorBody;
			} catch {
				body = raw;
			}
		}
	} catch {
		// Status still provides a deterministic fallback when a body is unreadable.
	}
	const message = errorMessage(body, statusMessage(response.status));
	if (notify) toast(message, "error");
	throw new ApiError(response.status, message, body);
}

export async function apiFetchJson<T = unknown>(
	url: string,
	options?: RequestInit,
	feedback?: ApiFeedbackOptions,
): Promise<T> {
	const response = await apiFetch(url, options, feedback);
	try {
		return await response.json() as T;
	} catch {
		const message = "\u{670d}\u{52a1}\u{8fd4}\u{56de}\u{4e86}\u{65e0}\u{6cd5}\u{8bc6}\u{522b}\u{7684}\u{6570}\u{636e}";
		if (feedback?.notify !== false) toast(message, "error");
		throw new ApiError(response.status, message);
	}
}

export async function apiFetchText(
	url: string,
	options?: RequestInit,
	feedback?: ApiFeedbackOptions,
): Promise<string> {
	return (await apiFetch(url, options, feedback)).text();
}
