// Graph Brain - 分层架构脑图构建器
//
// 脑图不是把若干参考图叠在一起，而是把架构整理为可钻取的 scope：
// - 当前画布只包含本层的直接子系统，以及这些子系统在本层的关系；
// - 子系统内部节点收纳在 drillScope 中，使用者双击进入；
// - 跨 scope 的原始关系不画成长线，而是保存在端点的 interfaces 中。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unknownGraphEvidence } from "../../core/schema/graph-version.js";
import { UE5_THREAD_EDGES, UE5_THREAD_NODES } from "./thread-architecture.js";
import { UE5_CODE_GRAPH_FORMAT } from "./meta.js";

interface CytoNode { data: Record<string, unknown> & { id: string; parent?: string }; position?: { x: number; y: number } }
interface CytoEdge { data: Record<string, unknown> & { id: string; source: string; target: string; relation?: string } }
interface CytoFile { meta?: Record<string, unknown>; elements: { nodes: CytoNode[]; edges: CytoEdge[] } }

interface InterfacePoint {
	direction: "in" | "out";
	relation: string;
	peerScope: string;
	peerNode: string;
	peerLabel: string;
}

interface ArchitectureScope {
	id: string;
	title: string;
	description: string;
	parentScope?: string;
	sourceDocuments?: string[];
	elements: { nodes: CytoNode[]; edges: CytoEdge[] };
}

const GRAPHS_DIR = join(process.cwd(), "data", "graphs");
const CLASS_TYPES = new Set(["uclass", "uactor", "ucomponent", "uinterface", "ustruct", "uenum", "blueprint", "module"]);
const INTERNAL_TYPES = new Set([...CLASS_TYPES, "lifecycle_step", "meta_group"]);
const PROJECT_PREFIX = "ue5_code_project_";

const ENGINE_SOURCES: Array<{ topic: string; prefix: string }> = [
	{ topic: "gameplay-framework", prefix: "ue5_code_gameplay-framework-reference_" },
	{ topic: "lyra", prefix: "ue5_code_lyra-architecture-reference_" },
	{ topic: "network", prefix: "ue5_code_network-scope-reference_" },
	{ topic: "lifecycle", prefix: "ue5_code_lifecycle-dependencies-reference_" },
	{ topic: "session-flow", prefix: "ue5_code_framework-reference_" },
];

const SYSTEMS = [
	{
		id: "engine/runtime",
		label: "引擎运行时",
		description: "进程启动、Engine 实例与 WorldContext 的最高层运行时。",
	},
	{
		id: "engine/execution",
		label: "线程与任务执行",
		description: "UE5.8 命名线程、任务池、子系统线程、Chaos 求解阶段与 GPU 队列的移交模型。",
	},
	{
		id: "engine/session",
		label: "应用会话",
		description: "跨地图 GameInstance、本地玩家、视口与会话级服务。",
	},
	{
		id: "engine/world",
		label: "世界运行时",
		description: "随地图创建和销毁的 World 与世界级服务。",
	},
	{
		id: "engine/framework",
		label: "Gameplay 框架职责",
		description: "规则、公共状态、玩家身份、控制器和可占据身体的职责树。",
	},
	{
		id: "engine/modular",
		label: "模块化 Gameplay",
		description: "Lyra Experience、Game Features 与 Pawn 初始化装配链。",
	},
	{
		id: "engine/gas",
		label: "Gameplay Ability System",
		description: "能力、效果、属性、标签与表现事件。",
	},
] as const;

function latestFile(prefix: string): string | null {
	return readdirSync(GRAPHS_DIR)
		.filter((name) => name.startsWith(prefix) && name.endsWith(".cyto.json"))
		.sort()
		.reverse()[0] ?? null;
}

function loadGraph(file: string): CytoFile {
	return JSON.parse(readFileSync(join(GRAPHS_DIR, file), "utf-8").replace(/^\uFEFF/, "")) as CytoFile;
}

function isLyra(id: string): boolean {
	return id.includes("Lyra") || id.includes("GameFeature") || id === "concept:GameplayReady";
}

function isGas(id: string): boolean {
	return /Ability|GameplayEffect|AttributeSet|GameplayTag|GameplayCue/.test(id);
}

/** 将同一个真实类型在五份参考资料中的出现折叠到唯一职责系统。 */
function engineOwner(topic: string, node: CytoNode): string | null {
	const id = String(node.data.id);
	const parent = String(node.data.parent ?? "");
	const type = String(node.data.type ?? "");
	if (!INTERNAL_TYPES.has(type)) return null;
	// 纯视觉分组由 scope 取代；有实际语义的概念节点仍保留。
	if (type === "meta_group" && !id.startsWith("concept:")) return null;
	if (isGas(id)) return "engine/gas";
	if (isLyra(id)) return "engine/modular";

	if (["FEngineLoop", "UEngine", "UGameEngine", "FWorldContext", "UEngineSubsystem"].includes(id)) return "engine/runtime";
	if (["UGameInstance", "UGameInstanceSubsystem", "ULocalPlayer", "ULocalPlayerSubsystem", "UGameViewportClient", "UUserWidget", "UInputMappingContext"].includes(id)) return "engine/session";
	if (["UWorld", "UWorldSubsystem"].includes(id)) return "engine/world";
	if (id.startsWith("lifecycle:")) {
		if (/GameInstanceInit/.test(id)) return "engine/session";
		if (/LoadMap/.test(id)) return "engine/world";
		return "engine/framework";
	}
	if (id === "concept:LocalUI") return "engine/session";
	if (id === "concept:AuthoritySpawn" || id === "concept:OwnerOnlyRPC") return "engine/framework";
	if (parent === "group:engine" || parent === "life:process") return "engine/runtime";
	if (parent === "group:session" || parent === "life:session" || parent === "net:local") return "engine/session";
	if (parent === "group:world" || parent === "life:world") return "engine/world";
	if (parent === "group:framework" || parent === "life:actor" || parent.startsWith("net:")) return "engine/framework";
	if (topic === "lyra") return "engine/modular";
	return "engine/framework";
}

function mergeNode(target: CytoNode, incoming: CytoNode): void {
	const oldDescription = String(target.data.description ?? "");
	const newDescription = String(incoming.data.description ?? "");
	if (newDescription.length > oldDescription.length) target.data.description = newDescription;
	const tags = new Set<string>([
		...(Array.isArray(target.data.tags) ? target.data.tags as string[] : []),
		...(Array.isArray(incoming.data.tags) ? incoming.data.tags as string[] : []),
	]);
	if (tags.size) target.data.tags = [...tags];
}

function edgeKey(edge: CytoEdge): string {
	return `${edge.data.source}|${String(edge.data.relation ?? "related")}|${edge.data.target}`;
}

function countDirections(points: InterfacePoint[]): { incoming: number; outgoing: number } {
	return {
		incoming: points.filter((point) => point.direction === "in").length,
		outgoing: points.filter((point) => point.direction === "out").length,
	};
}

function summaryNode(
	id: string,
	label: string,
	description: string,
	drillScope: string,
	childCount: number,
	interfaces: InterfacePoint[],
	type = "architecture_system",
): CytoNode {
	const { incoming, outgoing } = countDirections(interfaces);
	return {
		data: {
			id,
			domain: "ue5_code",
			label,
			displayLabel: `${label}\n${childCount} 个内部节点  ·  ◁ ${incoming}  ${outgoing} ▷`,
			description,
			type: "meta_group",
			architectureNode: true,
			architectureLayer: type === "architecture_layer",
			drillScope,
			childCount,
			children_count: childCount,
			interfaceCount: interfaces.length,
			interfaces,
			width: type === "architecture_layer" ? 230 : 205,
			height: type === "architecture_layer" ? 92 : 82,
		},
	};
}

function architectureEdge(id: string, source: string, target: string, label: string, relation = "contains"): CytoEdge {
	return { data: { id, domain: "ue5_code", source, target, relation, label, architectureEdge: true } };
}

function main() {
	const engineSourceDocuments: string[] = [];
	const engineNodes = new Map<string, CytoNode>();
	const engineNodeOwner = new Map<string, string>();
	const engineEdges = new Map<string, CytoEdge>();

	for (const source of ENGINE_SOURCES) {
		const file = latestFile(source.prefix);
		if (!file) {
			console.warn(`跳过（未找到）：${source.prefix}*`);
			continue;
		}
		const graph = loadGraph(file);
		engineSourceDocuments.push(file);
		for (const node of graph.elements.nodes) {
			const owner = engineOwner(source.topic, node);
			if (!owner) continue;
			const id = String(node.data.id);
			const existing = engineNodes.get(id);
			if (existing) mergeNode(existing, node);
			else {
				const data = { ...node.data, id };
				delete data.parent;
				engineNodes.set(id, { data });
			}
			engineNodeOwner.set(id, owner);
		}
		for (const edge of graph.elements.edges) {
			const sourceId = String(edge.data.source);
			const targetId = String(edge.data.target);
			if (!engineNodes.has(sourceId) || !engineNodes.has(targetId)) continue;
			engineEdges.set(edgeKey(edge), { data: { ...edge.data, id: edgeKey(edge) } });
		}
		console.log(`架构资料 → ${file}`);
	}

	const interfacesByNode = new Map<string, InterfacePoint[]>();
	const systemInterfaces = new Map<string, InterfacePoint[]>(SYSTEMS.map((system) => [system.id, []]));
	const pushInterface = (nodeId: string, point: InterfacePoint) => {
		const list = interfacesByNode.get(nodeId) ?? [];
		if (!list.some((item) => item.direction === point.direction && item.relation === point.relation && item.peerNode === point.peerNode)) list.push(point);
		interfacesByNode.set(nodeId, list);
	};

	for (const edge of engineEdges.values()) {
		const sourceId = String(edge.data.source);
		const targetId = String(edge.data.target);
		const sourceScope = engineNodeOwner.get(sourceId);
		const targetScope = engineNodeOwner.get(targetId);
		if (!sourceScope || !targetScope || sourceScope === targetScope) continue;
		const relation = String(edge.data.relation ?? "related");
		const sourceLabel = String(engineNodes.get(sourceId)?.data.label ?? sourceId);
		const targetLabel = String(engineNodes.get(targetId)?.data.label ?? targetId);
		const out: InterfacePoint = { direction: "out", relation, peerScope: targetScope, peerNode: targetId, peerLabel: targetLabel };
		const incoming: InterfacePoint = { direction: "in", relation, peerScope: sourceScope, peerNode: sourceId, peerLabel: sourceLabel };
		pushInterface(sourceId, out);
		pushInterface(targetId, incoming);
		systemInterfaces.get(sourceScope)?.push(out);
		systemInterfaces.get(targetScope)?.push(incoming);
	}

	const scopes: Record<string, ArchitectureScope> = {};
	for (const system of SYSTEMS) {
		const nodes = system.id === "engine/execution" ? UE5_THREAD_NODES.map((node) => ({ data: { ...node.data }, position: { ...node.position } })) : [...engineNodes.values()]
			.filter((node) => engineNodeOwner.get(String(node.data.id)) === system.id)
			.map((node) => ({ data: { ...node.data, interfaces: interfacesByNode.get(String(node.data.id)) ?? [] } }));
		const ids = new Set(nodes.map((node) => String(node.data.id)));
		const edges = system.id === "engine/execution"
			? UE5_THREAD_EDGES.map((edge) => ({ data: { ...edge.data } }))
			: [...engineEdges.values()].filter((edge) => ids.has(String(edge.data.source)) && ids.has(String(edge.data.target)));
		scopes[system.id] = {
			id: system.id,
			title: system.label,
			description: system.description,
			parentScope: "engine",
			sourceDocuments: system.id === "engine/execution" ? ["UE 5.8 local source evidence"] : engineSourceDocuments,
			elements: { nodes, edges },
		};
	}

	const engineSummaryNodes = SYSTEMS.map((system) => summaryNode(
		system.id,
		system.label,
		system.description,
		system.id,
		scopes[system.id].elements.nodes.length,
		systemInterfaces.get(system.id) ?? [],
	));
	const engineSummaryEdges = [
		architectureEdge("runtime-to-execution", "engine/runtime", "engine/execution", "启动并附着线程", "configures"),
		architectureEdge("execution-to-world", "engine/execution", "engine/world", "驱动 Tick / 归并结果", "dispatches_to"),
		architectureEdge("runtime-to-session", "engine/runtime", "engine/session", "创建会话"),
		architectureEdge("runtime-to-world", "engine/runtime", "engine/world", "持有 WorldContext"),
		architectureEdge("session-to-world", "engine/session", "engine/world", "加载地图", "loads"),
		architectureEdge("world-to-framework", "engine/world", "engine/framework", "生成玩法框架"),
		architectureEdge("framework-to-modular", "engine/framework", "engine/modular", "扩展与装配"),
		architectureEdge("modular-to-gas", "engine/modular", "engine/gas", "授予能力"),
	];
	scopes.engine = {
		id: "engine",
		title: "引擎层",
		description: "从进程运行时、线程任务执行到玩法能力的职责层级；横切资料已融合进对应系统。",
		parentScope: "root",
		sourceDocuments: engineSourceDocuments,
		elements: { nodes: engineSummaryNodes, edges: engineSummaryEdges },
	};

	// 业务层：模块是本层节点，模块内部类收进其 drillScope；跨模块/引擎关系只形成接口点。
	const projectFile = latestFile(PROJECT_PREFIX);
	const moduleNodes = new Map<string, CytoNode[]>();
	const projectNodeModule = new Map<string, string>();
	const projectInterfaces = new Map<string, InterfacePoint[]>();
	const moduleInterfaces = new Map<string, InterfacePoint[]>();
	const moduleEdges = new Map<string, CytoEdge>();
	if (projectFile) {
		const graph = loadGraph(projectFile);
		for (const node of graph.elements.nodes) {
			const type = String(node.data.type ?? "");
			if (node.data.layer !== "project" || !CLASS_TYPES.has(type) || type === "module") continue;
			const module = String(node.data.module || "Project");
			const scopeId = `business/module/${module}`;
			const data = { ...node.data };
			delete data.parent;
			const list = moduleNodes.get(module) ?? [];
			list.push({ data });
			moduleNodes.set(module, list);
			projectNodeModule.set(String(node.data.id), scopeId);
		}

		for (const edge of graph.elements.edges) {
			const sourceId = String(edge.data.source);
			const targetId = String(edge.data.target);
			const sourceScope = projectNodeModule.get(sourceId);
			const targetScope = projectNodeModule.get(targetId) ?? engineNodeOwner.get(targetId);
			if (!sourceScope || !targetScope) continue;
			if (sourceScope === targetScope) {
				moduleEdges.set(edgeKey(edge), { data: { ...edge.data, id: edgeKey(edge) } });
				continue;
			}
			const relation = String(edge.data.relation ?? "related");
			const targetLabel = String(engineNodes.get(targetId)?.data.label ?? targetId);
			const point: InterfacePoint = { direction: "out", relation, peerScope: targetScope, peerNode: targetId, peerLabel: targetLabel };
			const list = projectInterfaces.get(sourceId) ?? [];
			if (!list.some((item) => item.relation === relation && item.peerNode === targetId)) list.push(point);
			projectInterfaces.set(sourceId, list);
			const moduleList = moduleInterfaces.get(sourceScope) ?? [];
			moduleList.push(point);
			moduleInterfaces.set(sourceScope, moduleList);
		}

		for (const [module, nodes] of moduleNodes) {
			const scopeId = `business/module/${module}`;
			const ids = new Set(nodes.map((node) => String(node.data.id)));
			scopes[scopeId] = {
				id: scopeId,
				title: module,
				description: `${module} 模块内部职责；对引擎依赖以节点接口点表达。`,
				parentScope: "business",
				sourceDocuments: projectFile ? [projectFile] : [],
				elements: {
					nodes: nodes.map((node) => ({ data: { ...node.data, interfaces: projectInterfaces.get(String(node.data.id)) ?? [] } })),
					edges: [...moduleEdges.values()].filter((edge) => ids.has(String(edge.data.source)) && ids.has(String(edge.data.target))),
				},
			};
		}
		console.log(`业务事实 → ${projectFile}`);
	}

	const businessSummaryNodes = [...moduleNodes.entries()].map(([module, nodes]) => {
		const scopeId = `business/module/${module}`;
		return summaryNode(scopeId, module, `${module} 业务模块`, scopeId, nodes.length, moduleInterfaces.get(scopeId) ?? []);
	});
	scopes.business = {
		id: "business",
		title: "业务层",
		description: "项目模块及其本层依赖；模块内部实现通过双击进入。",
		parentScope: "root",
		sourceDocuments: projectFile ? [projectFile] : [],
		elements: { nodes: businessSummaryNodes, edges: [] },
	};

	const rootEngineInterfaces: InterfacePoint[] = [];
	const rootBusinessInterfaces: InterfacePoint[] = [];
	for (const points of moduleInterfaces.values()) {
		for (const point of points) {
			rootBusinessInterfaces.push(point);
			rootEngineInterfaces.push({ ...point, direction: "in", peerScope: "business", peerNode: point.peerNode, peerLabel: point.peerLabel });
		}
	}
	const rootNodes = [
		summaryNode("engine", "引擎层", scopes.engine.description, "engine", SYSTEMS.length, rootEngineInterfaces, "architecture_layer"),
		summaryNode("business", "业务层", scopes.business.description, "business", businessSummaryNodes.length, rootBusinessInterfaces, "architecture_layer"),
	];
	scopes.root = {
		id: "root",
		title: "代码架构脑图",
		description: "一张可钻取的引擎层 × 线程执行模型 × 业务层职责树。",
		sourceDocuments: [...engineSourceDocuments, ...(projectFile ? [projectFile] : [])],
		elements: { nodes: rootNodes, edges: [architectureEdge("engine-supports-business", "engine", "business", "框架接口", "contains")] },
	};

	const allNodes = Object.values(scopes).reduce((sum, scope) => sum + scope.elements.nodes.length, 0);
	const allEdges = Object.values(scopes).reduce((sum, scope) => sum + scope.elements.edges.length, 0);
	const date = new Date().toISOString().slice(0, 10);
	const out: CytoFile = {
		meta: {
			domain: "ue5_code",
			subsystem: "architecture-mindmap",
			format_version: UE5_CODE_GRAPH_FORMAT,
			title: "代码架构脑图 · 分层职责树",
			kind: "mindmap",
			generated_at: new Date().toISOString(),
			generator: "build-architecture-mindmap@scope-v3-thread-model",
			...unknownGraphEvidence("curated_reference", [], "derived-mindmap-no-composite-fingerprint"),
			rootScope: "root",
			scopes,
		},
		// 保留根层 elements，兼容通用目录计数与旧读取器。
		elements: scopes.root.elements,
	};
	const outFile = `ue5_code_architecture-mindmap_${date}.cyto.json`;
	writeFileSync(join(GRAPHS_DIR, outFile), JSON.stringify(out, null, "\t"), "utf-8");
	console.log(`✓ ${outFile}：${Object.keys(scopes).length} 个 scope / ${allNodes} 节点 / ${allEdges} 边`);
}

main();
