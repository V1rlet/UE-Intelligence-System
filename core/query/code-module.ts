// Canonical structural resolver for the owning UE code module.
// Explicit extractor output wins; path inference is deterministic and never guesses product intent.

/**
 * 无模块归属时的统一呈现标签。三处消费关系（同一事实只有一个所有者）：
 * 1. `core/query/change-report.ts`：已发布报告的 modules[].module 持久化字段——
 *    值已被数据格式冻结为 `"(unassigned)"`，改字符串即破坏旧报告兼容，禁止；
 * 2. `core/query/analysis.ts`：耦合/影响/闭包报告的运行时/CLI 分组呈现——引用本常量；
 * 3. `core/evidence/query.ts`：evidence API 的 `module` 字段是类型化可空
 *    （`string | null`），不使用字符串标签，null 即"无归属"，由消费方决定呈现。
 */
export const UNASSIGNED_MODULE_LABEL = "(unassigned)";

export function resolveCodeModule(data: Record<string, unknown>): string | null {
	if (typeof data.module === "string" && data.module.trim()) return data.module.trim();

	const candidates = [data.source_path, data.path, data.id];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const segments = candidate
			.replace(/^(?:file|dir):/i, "")
			.replace(/\\/g, "/")
			.split("/")
			.filter(Boolean);
		if (segments.length === 0) continue;

		const sourceIndex = segments.lastIndexOf("Source");
		if (sourceIndex >= 0 && segments[sourceIndex + 1]) {
			const sourceRoot = segments[sourceIndex + 1];
			if (["Runtime", "Developer", "Editor", "Programs", "ThirdParty"].includes(sourceRoot) && segments[sourceIndex + 2]) {
				return segments[sourceIndex + 2];
			}
			return sourceRoot;
		}

		const runtimeIndex = segments.indexOf("Runtime");
		if (runtimeIndex >= 0 && segments[runtimeIndex + 1]) return segments[runtimeIndex + 1];

		const developerIndex = segments.indexOf("Developer");
		if (developerIndex >= 0 && segments[developerIndex + 1]) return segments[developerIndex + 1];

		const editorIndex = segments.indexOf("Editor");
		if (editorIndex >= 0 && segments[editorIndex + 1]) return segments[editorIndex + 1];

		// Extracted source paths are rooted at their module (for example Sabotage/UI/Foo.h).
		if (candidate === data.source_path && segments.length >= 2) return segments[0];
	}
	return null;
}
