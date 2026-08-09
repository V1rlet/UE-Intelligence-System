import type { GraphCatalogEntry } from "./graphCatalog";

export const CODE_WORKSPACE_MODEL = [
	{ id: "architecture_knowledge", label: "架构脑图", hint: "总览定位 · 双击查看类详情", domain: "ue5_code", layers: [
		{ id: "business", label: "业务层", hint: "项目源码与业务类型" },
		{ id: "engine", label: "引擎层", hint: "UE 5.8 源码类型" },
	] },
] as const;

export function isArchitectureKnowledge(entry: GraphCatalogEntry): boolean {
	return entry.kind === "reference" || entry.kind === "mindmap";
}

export function isExistingSpec(entry: GraphCatalogEntry): boolean {
	return entry.domain === "ue5_code" && !isArchitectureKnowledge(entry);
}

export function isBusinessSpec(entry: GraphCatalogEntry): boolean {
	return isExistingSpec(entry) && entry.subsystem === "project";
}

export function selectExistingSpec(catalog: GraphCatalogEntry[], currentFile: string | null): GraphCatalogEntry | null {
	const current = catalog.find((entry) => entry.file === currentFile);
	if (current && isBusinessSpec(current)) return current;
	return catalog.find(isBusinessSpec)
		?? catalog.find(isExistingSpec)
		?? null;
}
