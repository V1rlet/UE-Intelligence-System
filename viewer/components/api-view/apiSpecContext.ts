import type { GraphElements } from "../graph-view/GraphView";
import type { SpecTarget } from "../graph-view/specModel";

export type ApiSpecSource = "all" | "project" | "engine";

export interface ApiSpecContext {
	elements: GraphElements;
	target: SpecTarget;
}

function contextFrom(elements: GraphElements, classId: string): ApiSpecContext | null {
	const classNode = elements.nodes.find((node) => String(node.data.id) === classId && node.data.type !== "ufunction");
	if (!classNode) return null;
	if (!hasConcreteSpecTarget(elements, classId)) return null;
	const chain = Array.isArray(classNode.data.inheritance_chain)
		? classNode.data.inheritance_chain.map(String)
		: [classId];
	return { elements, target: { id: classId, chain } };
}

/** 引用关系会生成轮廓 stub；只有具备源码/项目事实/成员事实的节点才能作为可导航 Spec。 */
export function hasConcreteSpecTarget(elements: GraphElements, classId: string): boolean {
	const node = elements.nodes.find((entry) => String(entry.data.id) === classId && entry.data.type !== "ufunction");
	if (!node) return false;
	const data = node.data as Record<string, unknown>;
	if (data.layer === "project" || typeof data.source_path === "string") return true;
	if (elements.nodes.some((entry) => entry.data.type === "ufunction" && String(entry.data.parent) === classId)) return true;
	return ["cpp_declarations", "data_members", "delegates", "delegate_subscriptions"]
		.some((key) => Array.isArray(data[key]) && (data[key] as unknown[]).length > 0);
}

/**
 * API 类详情与代码规划 Spec 共用 GraphElements；这里只选择事实源，不复制、不降级转换。
 * “全部”模式优先项目事实，只有项目图不存在该类时才回退到已解析的引擎事实。
 */
export function resolveApiSpecContext(
	projectElements: GraphElements,
	engineElements: GraphElements,
	source: ApiSpecSource,
	classId: string | null,
): ApiSpecContext | null {
	if (!classId) return null;
	if (source === "project") return contextFrom(projectElements, classId);
	if (source === "engine") return contextFrom(engineElements, classId);
	return contextFrom(projectElements, classId) ?? contextFrom(engineElements, classId);
}
