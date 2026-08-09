// Canonical structural resolver for the owning UE code module.
// Explicit extractor output wins; path inference is deterministic and never guesses product intent.
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
