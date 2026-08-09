// Graph Brain / adapters/ue5-code - 按 Lyra brief 构建 UE Gameplay Framework 四视图参考图

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unknownGraphEvidence } from "../../core/schema/graph-version.js";
import { UE5_CODE_GRAPH_FORMAT } from "./meta.js";

type Data = Record<string, unknown> & { id: string; label: string; type: string; domain: string };
type EdgeData = Record<string, unknown> & { id: string; source: string; target: string; relation: string; domain: string };
type Element = { data: Data; classes?: string };
type EdgeElement = { data: EdgeData; classes?: string };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GRAPH_DIR = join(ROOT, "data", "graphs");
const ANN_DIR = join(ROOT, "data", "annotations");
const MERMAID_DIR = join(ROOT, "data", "mermaid");
const DATE = "2026-07-12";

mkdirSync(GRAPH_DIR, { recursive: true });
mkdirSync(ANN_DIR, { recursive: true });
mkdirSync(MERMAID_DIR, { recursive: true });

function node(
	id: string,
	type: string,
	description: string,
	extra: Record<string, unknown> = {},
	layer: "engine" | "plugin" | "project" = "engine",
	module = "Engine",
): Element {
	const tags = (extra.tags as string[] | undefined) ?? [];
	const origin = String(extra.origin ?? (layer === "project" ? "Lyra" : "UE"));
	return {
		data: {
			id,
			label: String(extra.label ?? id),
			type,
			layer,
			module,
			domain: "ue5_code",
			description,
			visibility: "explored",
			...extra,
			tags,
		},
		classes: `origin-${origin.toLowerCase()} ${tags.join(" ")}`.trim(),
	};
}

function group(id: string, label: string, children: number, description: string): Element {
	return node(id, "meta_group", description, { label, children_count: children, category: "conceptual-group" });
}

function edge(source: string, target: string, relation: string, description: string): EdgeElement {
	return {
		data: {
			id: `${source}--${relation}-->${target}`,
			source,
			target,
			relation,
			domain: "ue5_code",
			description,
		},
		classes: `edge-${relation.replaceAll("_", "-")}`,
	};
}

function finalize(nodes: Element[], edges: EdgeElement[]) {
	const inDegree = new Map<string, number>();
	const outDegree = new Map<string, number>();
	for (const { data } of edges) {
		outDegree.set(data.source, (outDegree.get(data.source) ?? 0) + 1);
		inDegree.set(data.target, (inDegree.get(data.target) ?? 0) + 1);
	}
	for (const { data } of nodes) {
		data.metrics = { in_degree: inDegree.get(data.id) ?? 0, out_degree: outDegree.get(data.id) ?? 0 };
	}
	return { nodes, edges };
}

function writeGraph(subsystem: string, title: string, viewpoint: string, nodes: Element[], edges: EdgeElement[]) {
	const file = `ue5_code_${subsystem}_${DATE}.cyto.json`;
	const content = {
		meta: {
			domain: "ue5_code",
			subsystem,
			format_version: UE5_CODE_GRAPH_FORMAT,
			title,
			kind: "reference",
			viewpoint,
			generated_at: new Date().toISOString(),
			generator: "build-architecture-references.ts / UE5 Lyra Cytoscape brief",
			...unknownGraphEvidence("curated_reference", [], "curated-reference-no-source-manifest"),
		},
		elements: finalize(nodes, edges),
	};
	writeFileSync(join(GRAPH_DIR, file), `${JSON.stringify(content, null, 2)}\n`, "utf8");
	console.log(`${file}: ${nodes.length} nodes / ${edges.length} edges`);
}

function ue(
	id: string,
	type: string,
	parent: string,
	description: string,
	extra: Record<string, unknown> = {},
	layer: "engine" | "plugin" | "project" = "engine",
	module = "Engine",
) {
	return node(id, type, description, { parent, origin: "UE", ...extra }, layer, module);
}
function lyra(id: string, type: string, parent: string, description: string, extra: Record<string, unknown> = {}) {
	return node(id, type, description, { parent, origin: "Lyra", ...extra }, "project", "LyraGame");
}

// Gameplay Framework Overview
const gameplayNodes: Element[] = [
	group("group:engine", "Engine Runtime", 4, "引擎进程与 WorldContext 管理层"),
	group("group:session", "Application Session", 6, "跨地图会话、本地玩家与生命周期作用域"),
	group("group:world", "World", 3, "随地图创建销毁的运行时世界"),
	group("group:framework", "Gameplay Framework", 7, "服务器规则、玩家身份、控制器与可占据身体"),
	ue("FEngineLoop", "ustruct", "group:engine", "引擎主循环入口，驱动 PreInit、Init、Tick 与退出。", { category: "engine-runtime", lifetime_scope: "process" }),
	ue("UEngine", "uclass", "group:engine", "引擎运行时根对象，管理 GameInstance 与 WorldContext。", { category: "engine-runtime", lifetime_scope: "process" }),
	ue("UGameEngine", "uclass", "group:engine", "游戏运行时 UEngine 实现，创建 GameInstance 和视口。", { category: "engine-runtime", lifetime_scope: "process" }),
	ue("FWorldContext", "ustruct", "group:engine", "引擎管理 World 的上下文记录；不是 UObject Outer 层级。", { category: "engine-runtime", lifetime_scope: "process" }),
	ue("UGameInstance", "uclass", "group:session", "跨地图存活的会话根对象。", { category: "session", lifetime_scope: "game-instance", responsibilities: ["保存跨图会话数据", "管理 LocalPlayer", "承载 GameInstanceSubsystem"] }),
	ue("UGameInstanceSubsystem", "uclass", "group:session", "随 GameInstance 自动创建的会话级服务。", { category: "subsystem", lifetime_scope: "game-instance" }),
	ue("ULocalPlayer", "uclass", "group:session", "本机玩家、视口与输入设备的所有者。", { category: "player", network_scope: "local-only", lifetime_scope: "game-instance" }),
	ue("ULocalPlayerSubsystem", "uclass", "group:session", "随 LocalPlayer 创建的本地玩家服务。", { category: "subsystem", network_scope: "local-only", lifetime_scope: "local-player" }),
	ue("UGameViewportClient", "uclass", "group:session", "连接窗口、视口、LocalPlayer 与 UWorld。", { category: "ui", network_scope: "local-only", lifetime_scope: "game-instance" }),
	ue("UWorld", "uclass", "group:world", "地图运行时容器，持有 Actor 和 WorldSubsystem。", { category: "world", lifetime_scope: "world" }),
	ue("AActor", "uactor", "group:framework", "可放入 World 的实体与组件容器；Pawn 的直接基类。", { category: "gameplay-framework", network_scope: "server-all-clients", lifetime_scope: "actor" }),
	ue("UWorldSubsystem", "uclass", "group:world", "随 World 自动创建的世界级服务。", { category: "subsystem", lifetime_scope: "world" }),
	ue("AGameModeBase", "uactor", "group:framework", "服务器规则与玩家生成权威。", { category: "gameplay-framework", network_scope: "server-only", lifetime_scope: "world", common_mistakes: ["客户端访问 GameMode", "把跨地图状态放入 GameMode"] }),
	ue("AGameStateBase", "uactor", "group:framework", "向所有端发布公共比赛状态。", { category: "gameplay-framework", network_scope: "server-all-clients", lifetime_scope: "world" }),
	ue("APlayerController", "uactor", "group:framework", "玩家意志、输入路由与 owner-only 通信端点。", { category: "player", network_scope: "server-owning-client", lifetime_scope: "world" }),
	ue("APlayerState", "uactor", "group:framework", "跨 Pawn 重生持续的公共玩家身份。", { category: "player", network_scope: "server-all-clients", lifetime_scope: "world" }),
	ue("APawn", "uactor", "group:framework", "可被 Controller 占据并可销毁重生的身体。", { category: "pawn", network_scope: "server-all-clients", lifetime_scope: "actor" }),
	ue("ACharacter", "uactor", "group:framework", "带 CharacterMovement 的人形 Pawn。", { category: "pawn", network_scope: "server-all-clients", lifetime_scope: "actor" }),
	ue("AHUD", "uactor", "group:framework", "归属本地 PlayerController 的画布式 HUD。", { category: "ui", network_scope: "owning-client", lifetime_scope: "world" }),
];
const gameplayEdges = [
	edge("FEngineLoop", "UEngine", "creates", "Init 阶段创建并初始化 Engine。"),
	edge("UEngine", "UGameEngine", "owns", "游戏进程使用 UGameEngine 实现。"),
	edge("UGameEngine", "UGameInstance", "creates", "启动游戏会话时创建 GameInstance。"),
	edge("UEngine", "FWorldContext", "owns", "维护一个或多个 WorldContext。"),
	edge("FWorldContext", "UWorld", "owns", "WorldContext 指向当前 World。"),
	edge("UGameInstance", "UGameInstanceSubsystem", "owns", "自动实例化会话级 Subsystem。"),
	edge("UGameInstance", "ULocalPlayer", "owns", "单机或分屏本地玩家集合。"),
	edge("ULocalPlayer", "ULocalPlayerSubsystem", "owns", "自动实例化本地玩家 Subsystem。"),
	edge("UGameEngine", "UGameViewportClient", "creates", "创建游戏视口客户端。"),
	edge("UGameViewportClient", "ULocalPlayer", "owns", "视口承载一个或多个 LocalPlayer。"),
	edge("UGameInstance", "UWorld", "loads", "参与 Browse/Travel，切换当前 World。"),
	edge("UWorld", "UWorldSubsystem", "owns", "自动实例化 World 级 Subsystem。"),
	edge("UWorld", "AGameModeBase", "creates", "服务器加载地图时创建规则 Actor。"),
	edge("AGameModeBase", "AGameStateBase", "creates", "创建并维护公共比赛状态。"),
	edge("AGameModeBase", "APlayerController", "creates", "登录成功后建立玩家控制器。"),
	edge("AGameModeBase", "APlayerState", "creates", "为玩家建立可复制身份状态。"),
	edge("AGameModeBase", "APawn", "creates", "RestartPlayer 流程生成默认 Pawn。"),
	edge("APlayerController", "APawn", "possesses", "服务器权威占据当前 Pawn。"),
	edge("APlayerController", "APlayerState", "owns", "控制器关联自己的 PlayerState。"),
	edge("AGameStateBase", "APlayerState", "publishes", "PlayerArray 向所有端发布玩家集合。"),
	edge("APlayerController", "AHUD", "creates", "拥有端创建 HUD。"),
	edge("APawn", "AActor", "inherits", "Pawn 是可被 Controller 占据的 Actor。"),
	edge("ACharacter", "APawn", "inherits", "Character 是带移动能力的 Pawn。"),
];
writeGraph("gameplay-framework-reference", "UE5 Gameplay Framework · 运行时职责与所有权", "gameplay-framework", gameplayNodes, gameplayEdges);

// Lyra Architecture Overview
const lyraNodes: Element[] = [
	group("group:ue-base", "UE Gameplay Framework", 7, "Lyra 构建其上的原生框架层"),
	group("group:experience", "Lyra Experience", 5, "体验定义、ActionSet 与 PawnData 装配层"),
	group("group:features", "Game Features", 7, "按 Experience 动态激活和注入的功能层"),
	group("group:pawn-init", "Pawn Initialization", 5, "PawnData、ASC 与组件 InitState 协调层"),
	group("group:gas", "Gameplay Ability System", 9, "能力、效果、属性、标签与 Cue"),
	ue("AGameModeBase", "uactor", "group:ue-base", "服务器规则基类。", { network_scope: "server-only" }),
	ue("AGameStateBase", "uactor", "group:ue-base", "公共比赛状态基类。", { network_scope: "server-all-clients" }),
	ue("APlayerController", "uactor", "group:ue-base", "拥有端控制器基类。", { network_scope: "server-owning-client" }),
	ue("APlayerState", "uactor", "group:ue-base", "可复制玩家身份基类。", { network_scope: "server-all-clients" }),
	ue("APawn", "uactor", "group:ue-base", "可占据身体基类。", { network_scope: "server-all-clients" }),
	lyra("ALyraGameMode", "uactor", "group:ue-base", "选择 Experience、PawnData 并驱动玩家重启。", { network_scope: "server-only" }),
	lyra("ALyraGameState", "uactor", "group:ue-base", "持有 ExperienceManagerComponent 并复制 Experience 状态。", { network_scope: "server-all-clients" }),
	lyra("ULyraExperienceDefinition", "uclass", "group:experience", "定义本局 Experience、默认 PawnData、ActionSets 与 GameFeature 插件。", { category: "data-asset", lifetime_scope: "asset" }),
	lyra("ULyraExperienceActionSet", "uclass", "group:experience", "可复用的一组 GameFeatureActions 与插件依赖。", { category: "data-asset" }),
	lyra("ULyraExperienceManagerComponent", "ucomponent", "group:experience", "异步加载 Experience，并广播加载完成。", { network_scope: "server-all-clients", responsibilities: ["加载 ExperienceDefinition", "激活 GameFeaturePlugin", "通知 ExperienceLoaded"] }),
	lyra("ULyraPawnData", "uclass", "group:experience", "配置 Pawn 类、InputConfig、CameraMode 与 AbilitySets。", { category: "data-asset" }),
	ue("UGameFeaturesSubsystem", "uclass", "group:features", "管理 GameFeaturePlugin 状态机与激活。", { category: "subsystem", module: "GameFeatures" }, "plugin", "GameFeatures"),
	ue("UGameFeatureData", "uclass", "group:features", "插件的资产与 Actions 清单。", { category: "data-asset" }, "plugin", "GameFeatures"),
	ue("UGameFeatureAction", "uclass", "group:features", "Game Feature 激活时执行的注入动作基类。", {}, "plugin", "GameFeatures"),
	ue("UGameFeatureAction_AddComponents", "uclass", "group:features", "向目标 Actor 动态添加组件。", {}, "plugin", "GameFeatures"),
	lyra("UGameFeatureAction_AddAbilities", "uclass", "group:features", "向目标 Actor 的 ASC 授予 AbilitySet。"),
	lyra("UGameFeatureAction_AddInputConfig", "uclass", "group:features", "向本地英雄注入输入配置。"),
	lyra("UGameFeatureAction_AddWidgets", "uclass", "group:features", "向 UI Layer 注入布局与 Widget。"),
	lyra("ALyraCharacter", "uactor", "group:pawn-init", "Lyra 的可复制玩家 Pawn。", { network_scope: "server-all-clients" }),
	lyra("ALyraPlayerState", "uactor", "group:pawn-init", "持有长期存续的 Lyra ASC。", { network_scope: "server-all-clients" }),
	lyra("ULyraPawnExtensionComponent", "ucomponent", "group:pawn-init", "协调 PawnData、Controller、PlayerState、ASC 与 InitState。", { responsibilities: ["设置 PawnData", "绑定 ASC Owner/Avatar", "推进 InitState"], common_mistakes: ["用 Delay 代替 InitState", "重生后未重新绑定 AvatarActor"] }),
	lyra("ULyraHeroComponent", "ucomponent", "group:pawn-init", "本地英雄输入、相机和 GameplayReady 初始化。", { network_scope: "owning-client" }),
	lyra("ULyraHealthComponent", "ucomponent", "group:pawn-init", "桥接 Health Attribute、死亡状态和消息。"),
	lyra("ULyraAbilitySystemComponent", "ucomponent", "group:gas", "Lyra ASC：处理输入标签、激活组与能力关系。"),
	lyra("ULyraAbilitySet", "uclass", "group:gas", "批量授予 Abilities、Effects 与 AttributeSets 的数据资产。", { category: "data-asset" }),
	ue("UGameplayAbility", "uclass", "group:gas", "可预测、可复制的 Gameplay Ability。", {}, "plugin", "GameplayAbilities"),
	ue("UGameplayEffect", "uclass", "group:gas", "修改 Attribute 或施加持续状态的定义。", {}, "plugin", "GameplayAbilities"),
	ue("UAttributeSet", "uclass", "group:gas", "ASC 管理的属性集合。", {}, "plugin", "GameplayAbilities"),
	ue("FGameplayTag", "ustruct", "group:gas", "分层语义标签。", {}, "plugin", "GameplayTags"),
	ue("FGameplayAbilitySpec", "ustruct", "group:gas", "已授予 Ability 的运行时规格。", {}, "plugin", "GameplayAbilities"),
	ue("FGameplayEffectSpec", "ustruct", "group:gas", "GameplayEffect 的运行时实例参数。", {}, "plugin", "GameplayAbilities"),
	group("concept:GameplayCue", "Gameplay Cue（概念）", 0, "由 GameplayTag 驱动的表现事件系统。"),
];
const lyraEdges = [
	edge("ALyraGameMode", "AGameModeBase", "inherits", "Lyra 服务器规则实现。"),
	edge("ALyraGameState", "AGameStateBase", "inherits", "Lyra 公共状态实现。"),
	edge("ALyraGameMode", "ULyraExperienceDefinition", "configures", "根据 URL/WorldSettings/默认值选择 Experience。"),
	edge("ALyraGameState", "ULyraExperienceManagerComponent", "owns", "ExperienceManager 位于 GameState。"),
	edge("ULyraExperienceManagerComponent", "ULyraExperienceDefinition", "loads", "异步加载 Experience 主资产。"),
	edge("ULyraExperienceDefinition", "ULyraExperienceActionSet", "configures", "引用可复用 ActionSets。"),
	edge("ULyraExperienceDefinition", "ULyraPawnData", "configures", "指定默认 PawnData。"),
	edge("ULyraExperienceManagerComponent", "UGameFeaturesSubsystem", "activates", "激活 Experience 所需 GameFeaturePlugin。"),
	edge("UGameFeaturesSubsystem", "UGameFeatureData", "loads", "加载插件 GameFeatureData。"),
	edge("UGameFeatureData", "UGameFeatureAction", "owns", "持有激活时执行的 Actions。"),
	edge("UGameFeatureAction_AddComponents", "UGameFeatureAction", "inherits", "组件注入 Action。"),
	edge("UGameFeatureAction_AddAbilities", "UGameFeatureAction", "inherits", "能力注入 Action。"),
	edge("UGameFeatureAction_AddInputConfig", "UGameFeatureAction", "inherits", "输入注入 Action。"),
	edge("UGameFeatureAction_AddWidgets", "UGameFeatureAction", "inherits", "UI 注入 Action。"),
	edge("UGameFeatureAction_AddComponents", "ALyraCharacter", "injects", "向匹配 Actor 添加功能组件。"),
	edge("UGameFeatureAction_AddAbilities", "ULyraAbilitySystemComponent", "grants", "向 ASC 授予 AbilitySet。"),
	edge("UGameFeatureAction_AddInputConfig", "ULyraHeroComponent", "injects", "为本地英雄增加 InputConfig。"),
	edge("ULyraPawnData", "ALyraCharacter", "configures", "配置 Pawn 类和功能数据。"),
	edge("ULyraPawnData", "ULyraAbilitySet", "owns", "引用 Pawn 初始 AbilitySets。"),
	edge("ALyraCharacter", "ULyraPawnExtensionComponent", "owns", "Pawn 初始化协调组件。"),
	edge("ALyraCharacter", "ULyraHeroComponent", "owns", "本地英雄功能组件。"),
	edge("ALyraCharacter", "ULyraHealthComponent", "owns", "生命与死亡桥接组件。"),
	edge("ALyraPlayerState", "ULyraAbilitySystemComponent", "owns", "PlayerState 持有 ASC，使能力跨 Pawn 重生。"),
	edge("ULyraAbilitySystemComponent", "ALyraPlayerState", "binds_as_owner", "OwnerActor 固定为 PlayerState。"),
	edge("ULyraAbilitySystemComponent", "ALyraCharacter", "binds_as_avatar", "AvatarActor 绑定当前 Pawn。"),
	edge("ULyraPawnExtensionComponent", "ULyraPawnData", "depends_on", "等待 PawnData。"),
	edge("ULyraPawnExtensionComponent", "ALyraPlayerState", "depends_on", "等待 PlayerState/ASC。"),
	edge("ULyraHeroComponent", "ULyraPawnExtensionComponent", "depends_on", "等待 Pawn InitState。"),
	edge("ULyraAbilitySet", "UGameplayAbility", "grants", "授予 AbilitySpec。"),
	edge("ULyraAbilitySet", "UGameplayEffect", "grants", "应用初始 GameplayEffects。"),
	edge("ULyraAbilitySet", "UAttributeSet", "grants", "创建并加入 AttributeSets。"),
	edge("ULyraAbilitySystemComponent", "FGameplayTag", "observes", "使用 GameplayTag 驱动输入和状态。"),
	edge("UGameplayEffect", "FGameplayEffectSpec", "creates", "运行时生成 EffectSpec。"),
	edge("UGameplayAbility", "FGameplayAbilitySpec", "creates", "授予后形成 AbilitySpec。"),
	edge("UGameplayEffect", "concept:GameplayCue", "activates", "通过 Cue Tag 触发表现。"),
];
writeGraph("lyra-architecture-reference", "Lyra · Experience、Game Features、Pawn 初始化与 GAS", "lyra-architecture", lyraNodes, lyraEdges);

// Network Scope View
const networkNodes: Element[] = [
	group("net:server", "Server Only", 3, "只存在于权威服务器"),
	group("net:all", "Server + All Clients", 6, "服务器存在并复制到所有相关客户端"),
	group("net:owner", "Server + Owning Client", 3, "服务器与拥有该玩家的客户端"),
	group("net:local", "Local Only", 4, "仅本机进程/本地玩家"),
	ue("AGameModeBase", "uactor", "net:server", "服务器规则与 Spawn 权威。", { network_scope: "server-only" }),
	lyra("ALyraGameMode", "uactor", "net:server", "Lyra Experience 选择与重生权威。", { network_scope: "server-only" }),
	group("concept:AuthoritySpawn", "Authority Spawn（概念）", 0, "服务器权威生成与重生逻辑。"),
	ue("AGameStateBase", "uactor", "net:all", "公共比赛状态。", { network_scope: "server-all-clients" }),
	ue("APlayerState", "uactor", "net:all", "公共玩家身份。", { network_scope: "server-all-clients" }),
	ue("APawn", "uactor", "net:all", "可复制 Pawn。", { network_scope: "server-all-clients" }),
	lyra("ALyraGameState", "uactor", "net:all", "复制 Experience 状态。", { network_scope: "server-all-clients" }),
	lyra("ALyraPlayerState", "uactor", "net:all", "持有可复制 Lyra ASC。", { network_scope: "server-all-clients" }),
	lyra("ULyraAbilitySystemComponent", "ucomponent", "net:all", "ASC 的复制模式决定公开/owner-only 数据范围。", { network_scope: "server-all-clients" }),
	ue("APlayerController", "uactor", "net:owner", "服务器与拥有端存在。", { network_scope: "server-owning-client" }),
	lyra("ALyraPlayerController", "uactor", "net:owner", "Lyra 拥有端控制器。", { network_scope: "server-owning-client" }),
	group("concept:OwnerOnlyRPC", "Owner-only RPC（概念）", 0, "只发往拥有客户端的 RPC/复制数据。"),
	ue("ULocalPlayer", "uclass", "net:local", "仅本机 LocalPlayer。", { network_scope: "local-only" }),
	ue("ULocalPlayerSubsystem", "uclass", "net:local", "仅本地玩家的 Subsystem。", { network_scope: "local-only" }),
	lyra("ULyraHeroComponent", "ucomponent", "net:local", "本地输入与相机初始化。", { network_scope: "local-only" }),
	group("concept:LocalUI", "Local UI（概念）", 0, "本地 HUD、CommonUI Layer 与设置界面。"),
];
const networkEdges = [
	edge("AGameModeBase", "AGameStateBase", "publishes", "权威规则写入公共状态。"),
	edge("AGameStateBase", "APlayerState", "owns", "维护 PlayerArray。"),
	edge("AGameStateBase", "net:all", "replicates_to", "公共比赛状态复制至所有端。"),
	edge("APlayerState", "net:all", "replicates_to", "公共玩家状态复制至所有端。"),
	edge("APawn", "net:all", "replicates_to", "Replicated Pawn 复制至相关客户端。"),
	edge("APlayerController", "net:owner", "replicates_to", "只存在于服务器与拥有端。"),
	edge("APlayerController", "concept:OwnerOnlyRPC", "owns", "承载 Client/Server owner RPC。"),
	edge("ULocalPlayer", "ULocalPlayerSubsystem", "owns", "本地玩家服务。"),
	edge("ULocalPlayer", "ULyraHeroComponent", "configures", "本地输入配置驱动 HeroComponent。"),
	edge("ULyraHeroComponent", "concept:LocalUI", "injects", "本地体验注入输入与 UI。"),
	edge("ALyraGameMode", "concept:AuthoritySpawn", "owns", "服务器执行 Pawn 生成与重生。"),
	edge("ALyraGameState", "net:all", "replicates_to", "Experience 状态复制到客户端。"),
	edge("ALyraPlayerState", "ULyraAbilitySystemComponent", "owns", "ASC 随 PlayerState 存续。"),
];
writeGraph("network-scope-reference", "UE5 / Lyra · 网络存在范围与复制边界", "network-scope", networkNodes, networkEdges);

// Lifecycle and Dependency View
const lifecycleNodes: Element[] = [
	group("life:process", "Process Scope", 2, "进程级生命周期"),
	group("life:session", "GameInstance / LocalPlayer Scope", 4, "跨地图会话与本地玩家生命周期"),
	group("life:world", "World Scope", 4, "随地图创建销毁"),
	group("life:actor", "Actor / Component Scope", 8, "Actor 与组件初始化依赖"),
	ue("UEngine", "uclass", "life:process", "进程级引擎根。", { lifetime_scope: "process" }),
	ue("UEngineSubsystem", "uclass", "life:process", "进程级 Subsystem。", { lifetime_scope: "process" }),
	ue("UGameInstance", "uclass", "life:session", "跨 World 会话根。", { lifetime_scope: "game-instance" }),
	ue("UGameInstanceSubsystem", "uclass", "life:session", "会话级服务。", { lifetime_scope: "game-instance" }),
	ue("ULocalPlayer", "uclass", "life:session", "本地玩家生命周期。", { lifetime_scope: "local-player" }),
	ue("ULocalPlayerSubsystem", "uclass", "life:session", "本地玩家服务。", { lifetime_scope: "local-player" }),
	ue("UWorld", "uclass", "life:world", "地图世界生命周期。", { lifetime_scope: "world" }),
	ue("UWorldSubsystem", "uclass", "life:world", "World 服务。", { lifetime_scope: "world" }),
	lyra("ULyraExperienceManagerComponent", "ucomponent", "life:world", "Experience 加载状态协调。", { lifetime_scope: "world" }),
	lyra("ULyraExperienceDefinition", "uclass", "life:world", "当前体验配置资产。", { lifetime_scope: "asset" }),
	ue("APawn", "uactor", "life:actor", "可重生 Actor。", { lifetime_scope: "actor" }),
	ue("APlayerController", "uactor", "life:actor", "Pawn 初始化所需 Controller。", { lifetime_scope: "world" }),
	ue("APlayerState", "uactor", "life:actor", "Pawn 初始化所需 PlayerState。", { lifetime_scope: "world" }),
	lyra("ULyraPawnData", "uclass", "life:actor", "Pawn 功能配置。", { lifetime_scope: "asset" }),
	lyra("ULyraPawnExtensionComponent", "ucomponent", "life:actor", "协调 InitState 和 ASC 绑定。", { lifetime_scope: "actor-component" }),
	lyra("ULyraHeroComponent", "ucomponent", "life:actor", "等待输入组件与 PawnExtension。", { lifetime_scope: "actor-component" }),
	lyra("ULyraAbilitySystemComponent", "ucomponent", "life:actor", "等待 OwnerActor/AvatarActor。", { lifetime_scope: "player-state" }),
	lyra("ULyraAbilitySet", "uclass", "life:actor", "等待 ASC 初始化后授予能力。", { lifetime_scope: "asset" }),
	group("concept:GameplayReady", "GameplayReady（InitState）", 0, "所有必要功能达到 GameplayReady 后才可开始 gameplay。"),
];
const lifecycleEdges = [
	edge("UEngine", "UEngineSubsystem", "owns", "进程级作用域。"),
	edge("UEngine", "UGameInstance", "creates", "创建会话根。"),
	edge("UGameInstance", "UGameInstanceSubsystem", "owns", "会话级作用域。"),
	edge("UGameInstance", "ULocalPlayer", "owns", "本地玩家生命周期。"),
	edge("ULocalPlayer", "ULocalPlayerSubsystem", "owns", "本地玩家服务作用域。"),
	edge("UGameInstance", "UWorld", "loads", "Travel 创建新 World。"),
	edge("UWorld", "UWorldSubsystem", "owns", "World 级作用域。"),
	edge("UWorld", "ULyraExperienceManagerComponent", "owns", "Experience 状态随 World。"),
	edge("ULyraExperienceManagerComponent", "ULyraExperienceDefinition", "loads", "异步加载当前 Experience。"),
	edge("APawn", "APlayerController", "depends_on", "Pawn 等待 Controller。"),
	edge("APawn", "APlayerState", "depends_on", "Pawn 等待 PlayerState。"),
	edge("ULyraPawnExtensionComponent", "ULyraPawnData", "depends_on", "等待 PawnData。"),
	edge("ULyraPawnExtensionComponent", "ULyraExperienceManagerComponent", "depends_on", "等待 Experience Loaded。"),
	edge("ULyraPawnExtensionComponent", "APlayerState", "depends_on", "等待 PlayerState/ASC。"),
	edge("ULyraHeroComponent", "ULyraPawnExtensionComponent", "depends_on", "等待 PawnExtension 初始化。"),
	edge("ULyraHeroComponent", "APlayerController", "depends_on", "等待 InputComponent/Controller。"),
	edge("ULyraAbilitySystemComponent", "APlayerState", "binds_as_owner", "OwnerActor 准备。"),
	edge("ULyraAbilitySystemComponent", "APawn", "binds_as_avatar", "AvatarActor 准备。"),
	edge("ULyraAbilitySet", "ULyraAbilitySystemComponent", "depends_on", "ASC 初始化后授予。"),
	edge("concept:GameplayReady", "ULyraPawnExtensionComponent", "depends_on", "等待扩展组件 InitState。"),
	edge("concept:GameplayReady", "ULyraHeroComponent", "depends_on", "等待英雄组件 InitState。"),
	edge("concept:GameplayReady", "ULyraAbilitySystemComponent", "depends_on", "等待 ASC Owner/Avatar 绑定。"),
];
writeGraph("lifecycle-dependencies-reference", "UE5 / Lyra · 生命周期作用域与初始化依赖", "lifecycle-dependencies", lifecycleNodes, lifecycleEdges);

const annotations = [
	{ node_id: "AGameModeBase", domain: "ue5_code", annotations: [{ id: "ann_gf_gamemode", type: "gotcha", content: "GameMode 只存在于服务器；客户端规则展示必须读取 GameState。", created_at: `${DATE}T00:00:00.000Z` }] },
	{ node_id: "APlayerController", domain: "ue5_code", annotations: [{ id: "ann_gf_pc", type: "best_practice", content: "PlayerController 只存在于服务器和拥有端；不要把所有玩家都要看到的数据放在这里。", created_at: `${DATE}T00:00:00.000Z` }] },
	{ node_id: "APawn", domain: "ue5_code", annotations: [{ id: "ann_gf_pawn", type: "gotcha", content: "Pawn 是可替换身体；跨重生数据应进入 PlayerState 或其他更长生命周期作用域。", created_at: `${DATE}T00:00:00.000Z` }] },
];
writeFileSync(join(ANN_DIR, "ue5_code_gameplay-framework-reference_annotations.json"), `${JSON.stringify(annotations, null, 2)}\n`, "utf8");

const lyraAnnotations = [
	{ node_id: "ULyraPawnExtensionComponent", domain: "ue5_code", annotations: [{ id: "ann_lyra_extension", type: "gotcha", content: "不要用 BeginPlay + Delay 猜依赖就绪；Lyra 使用 InitState 协调 PawnData、Controller、PlayerState 与 ASC。", created_at: `${DATE}T00:00:00.000Z` }] },
	{ node_id: "ALyraPlayerState", domain: "ue5_code", annotations: [{ id: "ann_lyra_ps", type: "best_practice", content: "玩家 ASC 由 PlayerState 持有，OwnerActor=PlayerState，AvatarActor=当前 Pawn，因此可跨 Pawn 重生保留能力状态。", created_at: `${DATE}T00:00:00.000Z` }] },
	{ node_id: "ULyraExperienceManagerComponent", domain: "ue5_code", annotations: [{ id: "ann_lyra_exp", type: "best_practice", content: "Experience 加载是异步装配过程；依赖插件、PawnData 或输入的系统应等待 ExperienceLoaded。", created_at: `${DATE}T00:00:00.000Z` }] },
];
writeFileSync(join(ANN_DIR, "ue5_code_lyra-architecture-reference_annotations.json"), `${JSON.stringify(lyraAnnotations, null, 2)}\n`, "utf8");

const sequences: Record<string, string> = {
	"ue5_lyra-initialization_2026-07-12.mmd": `%% title: Lyra 初始化：Experience → Game Features → Pawn → GameplayReady\n%% nodes: ALyraGameMode, ALyraGameState, ULyraExperienceManagerComponent, ULyraExperienceDefinition, UGameFeaturesSubsystem, ULyraPawnExtensionComponent, ULyraAbilitySystemComponent, ULyraHeroComponent\nsequenceDiagram\n  participant GM as ALyraGameMode\n  participant EM as ExperienceManager\n  participant GF as GameFeaturesSubsystem\n  participant PE as PawnExtension\n  participant ASC as LyraASC\n  participant Hero as HeroComponent\n  GM->>EM: SetCurrentExperience\n  EM->>GF: LoadAndActivateGameFeatures\n  GF-->>EM: Plugins Active\n  EM-->>PE: Experience Loaded / PawnData\n  PE->>ASC: InitAbilityActorInfo\n  PE-->>Hero: InitState.DataAvailable\n  Hero-->>PE: InitState.GameplayReady\n`,
	"ue5_player-login-spawn_2026-07-12.mmd": `%% title: 玩家登录、生成与占据\n%% nodes: AGameModeBase, APlayerController, APlayerState, APawn\nsequenceDiagram\n  participant C as Client\n  participant GM as GameMode(Server)\n  participant PC as PlayerController\n  participant PS as PlayerState\n  participant P as Pawn\n  C->>GM: Login / PostLogin\n  GM->>PC: Create PlayerController\n  GM->>PS: InitPlayerState\n  GM->>P: SpawnDefaultPawnFor\n  PC->>P: Possess\n  PC-->>C: OnRep_Pawn / ClientRestart\n`,
	"ue5_gas-ability-activation_2026-07-12.mmd": `%% title: GAS Ability 激活与效果结算\n%% nodes: ULyraHeroComponent, ULyraAbilitySystemComponent, UGameplayAbility, UGameplayEffect, UAttributeSet\nsequenceDiagram\n  participant Input as HeroComponent\n  participant ASC as AbilitySystemComponent\n  participant GA as GameplayAbility\n  participant Server as Server Validation\n  participant GE as GameplayEffect\n  participant Attr as AttributeSet\n  Input->>ASC: AbilityInputTagPressed\n  ASC->>GA: TryActivateAbility\n  GA->>Server: Predict / Validate\n  Server->>GE: ApplyGameplayEffectSpec\n  GE->>Attr: Modify Attribute\n  Attr-->>ASC: Replicate / Notify\n`,
};
for (const [file, text] of Object.entries(sequences)) writeFileSync(join(MERMAID_DIR, file), text, "utf8");
