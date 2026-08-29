import { loadLocalUsage, recordLocalUsage, type LocalUsageKey } from "../core/usage/local-usage.js";
import { type ApiHandler, methodNotAllowed, readJsonBody, sendInternalError, sendJson } from "./http.js";

const WORKSPACE_EVENTS = new Set<LocalUsageKey>([
	"workspace.overview", "workspace.explore.architecture", "workspace.explore.relations", "workspace.explore.api", "workspace.changes",
]);

export const handleLocalUsage: ApiHandler = async ({ req, res, url, root }) => {
	if (url === "/api/usage/v1/summary") {
		if (req.method !== "GET") { methodNotAllowed(res); return true; }
		try {
			sendJson(res, 200, loadLocalUsage(root));
		} catch (e) {
			sendInternalError(res, e, "usage summary failed");
		}
		return true;
	}
	if (url !== "/api/usage/v1/event") return false;
	if (req.method !== "POST") { methodNotAllowed(res, "POST"); return true; }
	const body = await readJsonBody(req);
	const event = typeof body.event === "string" ? body.event as LocalUsageKey : null;
	if (!event || !WORKSPACE_EVENTS.has(event)) {
		sendJson(res, 400, { code: "LOCAL_USAGE_EVENT_INVALID", error: "event must be an allowlisted workspace aggregate" });
		return true;
	}
	try {
		recordLocalUsage(root, event);
	} catch (e) {
		// 使用统计锁竞争/写失败不伪装成功。
		sendInternalError(res, e, "usage event record failed");
		return true;
	}
	res.statusCode = 204;
	res.end();
	return true;
};

export const usageHandlers: ApiHandler[] = [handleLocalUsage];
