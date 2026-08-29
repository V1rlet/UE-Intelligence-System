export type ExtractorCapabilitySupport = "supported" | "heuristic" | "unsupported";

export interface ExtractorCapability {
	id: string;
	support: ExtractorCapabilitySupport;
}

export interface EvidenceExtractor {
	id: string;
	version: string | null;
	capabilities: ExtractorCapability[];
}

export type ExtractedFactClassification = "direct" | "heuristic" | "unknown";

export interface ExtractedFactEvidence {
	classification: ExtractedFactClassification;
	confidence: number | null;
	capability: string;
	source: { path: string | null; span: { start_line: number; end_line: number } | null };
	diagnostic: string | null;
}

const EXTRACTORS: Record<string, readonly ExtractorCapability[]> = {
	"ue5-code-adapter/extract-classes": [
		{ id: "declarations", support: "supported" },
		{ id: "uht-reflection-metadata", support: "supported" },
		{ id: "same-name-cpp-member-usage", support: "heuristic" },
		{ id: "delegate-binding", support: "heuristic" },
		{ id: "standalone-translation-units", support: "unsupported" },
		{ id: "blueprint-runtime", support: "unsupported" },
	],
};

/** Extractor identity and capability declarations have one registry owner. */
export function resolveEvidenceExtractor(generator: string | null): EvidenceExtractor {
	const match = generator?.match(/^(.+?)@([^@]+)$/);
	const id = match?.[1] ?? generator ?? "unknown";
	return {
		id,
		version: match?.[2] ?? null,
		capabilities: [...(EXTRACTORS[id] ?? [])],
	};
}

const DIRECT_RELATIONS = new Set(["inherits", "implements", "composes", "aggregates", "contains"]);
const DELEGATE_RELATIONS = new Set(["binds_event", "delegates"]);

/** Per-fact semantics are centralized with the extractor capability declaration. */
export function extractorNodeEvidence(generator: string | null, sourcePath: string | null): ExtractedFactEvidence {
	const extractor = resolveEvidenceExtractor(generator);
	if (extractor.id === "ue5-code-adapter/extract-classes" && sourcePath) {
		return {
			classification: "direct", confidence: 1, capability: "declarations",
			source: { path: sourcePath, span: null }, diagnostic: null,
		};
	}
	return {
		classification: "unknown", confidence: null, capability: "unknown",
		source: { path: sourcePath, span: null }, diagnostic: "fact-provenance-not-persisted",
	};
}

export function extractorRelationEvidence(generator: string | null, relation: string, sourcePath: string | null): ExtractedFactEvidence {
	const extractor = resolveEvidenceExtractor(generator);
	if (extractor.id !== "ue5-code-adapter/extract-classes") {
		return {
			classification: "unknown", confidence: null, capability: "unknown",
			source: { path: sourcePath, span: null }, diagnostic: "relation-provenance-not-persisted",
		};
	}
	if (relation === "uses_member") {
		return {
			classification: "heuristic", confidence: 0.65, capability: "same-name-cpp-member-usage",
			source: { path: sourcePath, span: null }, diagnostic: "same-name-member-usage-heuristic",
		};
	}
	if (DELEGATE_RELATIONS.has(relation)) {
		return {
			classification: "heuristic", confidence: 0.75, capability: "delegate-binding",
			source: { path: sourcePath, span: null }, diagnostic: "delegate-binding-heuristic",
		};
	}
	if (DIRECT_RELATIONS.has(relation) && sourcePath) {
		return {
			classification: "direct", confidence: 1, capability: "declarations",
			source: { path: sourcePath, span: null }, diagnostic: null,
		};
	}
	return {
		classification: "unknown", confidence: null, capability: "unknown",
		source: { path: sourcePath, span: null }, diagnostic: "relation-provenance-not-persisted",
	};
}
