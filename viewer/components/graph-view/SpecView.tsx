// Graph Brain / viewer - 类 Spec 关系图示：左继承链 + 中持有/资产分区方框 + 右函数分区 + 下生命周期条
// 与右侧 SpecPanel 双向 hover 联动；函数的 uses_member 调度连线仅在 hover 时浮现
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useRef, useState } from "react";
import { ueSpecTypeLabel, ueTypeLabel } from "../../../core/schema/ue-naming";
import { ANIM, pulseNode, REDUCED_MOTION } from "../../src/motion";
import { SVG_INK } from "../../src/design-tokens";
import { SHORTCUT_KEYS } from "../../src/shortcutCatalog";
import { stylesheetFor } from "../../styles/stylesheets";
import { paginateSpecFunctions } from "../common/functionPartition";
import { buildBpNodeSvg, type BpNodeInput } from "./bpNode";
import type { GraphElements } from "./GraphView";
import { bindSemanticRelationMotion, decorateSemanticRelationEdge } from "./relationPresentation";
import resolveNodeOverlaps from "./resolveOverlaps";
import SpecFunctionPager from "./SpecFunctionPager";
import ViewportZoomControl from "./ViewportZoomControl";
import { loadViewport, saveViewport } from "./viewportStore";
import {
	FN_PAGE_SIZE,
	paginateSpecZone,
	SPEC_ZONE_PAGE_SIZE,
	SPEC_ZONE_NODE_IDS,
	type FocusRequest,
	type SpecTarget,
	type SpecZoneKey,
	type SpecZonePages,
} from "./specModel";
import { boundedLocateZoom, clampManualZoom, clampOverviewZoom, fitZoomForBounds, VIEWPORT_POLICY } from "./viewportPolicy";

const ASSET_TYPE_RE = /InputAction|InputMappingContext|DataAsset|DataTable|CurveTable|SoundBase|Montage/;
const HOLD_RELATIONS = new Set(["composes", "aggregates", "depends_on"]);

function specFitZoom(cy: Core, padding: number): number {
	const bounds = cy.elements().boundingBox({ includeLabels: true, includeOverlays: false });
	return fitZoomForBounds(cy.width(), cy.height(), bounds.w, bounds.h, padding);
}

function setSpecOverview(cy: Core, animate: boolean): void {
	const elements = cy.elements();
	const zoom = clampOverviewZoom(specFitZoom(cy, 50));
	cy.stop();
	if (animate) cy.animate({ center: { eles: elements }, zoom, duration: ANIM(200), easing: "ease-out" });
	else {
		cy.zoom(zoom);
		cy.center(elements);
	}
}

interface Props {
	elements: GraphElements;
	target: SpecTarget;
	fnPage: number;
	onFnPage: (page: number) => void;
	zonePages: SpecZonePages;
	onZonePage: (zone: SpecZoneKey, page: number) => void;
	hoverId: string | null;
	focusRequest: FocusRequest | null;
	onHover: (id: string | null) => void;
	onJump: (target: SpecTarget) => void;
	onSelectNode: (data: Record<string, unknown> | null) => void;
	/** F6：视口记忆键（同键重开恢复上次 pan/zoom；缺省不记忆） */
	viewportKey?: string;
}

/** 从全量图数据裁出单类 Spec 页的元素并计算 preset 坐标（分区用 compound 方框承载；函数区分页） */
export function buildSpecElements(
	elements: GraphElements,
	target: SpecTarget,
	fnPage: number,
	zonePages: SpecZonePages = {},
): ElementDefinition[] {
	const nodeById = new Map(elements.nodes.map((n) => [String(n.data.id), n]));
	const classNode = nodeById.get(target.id);
	const classData = (classNode?.data ?? { id: target.id, label: target.id }) as Record<string, unknown> & { id: string };
	const chain = target.chain ?? (classData.inheritance_chain as string[] | undefined) ?? [target.id];
	const page = <T,>(zone: SpecZoneKey, items: T[]) => paginateSpecZone(items, zonePages[zone] ?? 0);

	const allIfaces = elements.edges
		.filter((edge) => {
			const data = edge.data as { source: string; relation?: string };
			return data.source === target.id && data.relation === "implements";
		})
		.map((edge) => String((edge.data as { target: string }).target));
	const inheritancePage = page("inheritance", chain.filter((name) => name !== target.id));
	const interfacePage = page("interfaces", allIfaces);
	const cppDeclarationsAll = (classData.cpp_declarations as {
		name: string;
		kind: "class" | "struct" | "enum";
		bases?: string[];
		description?: string;
		reflection?: "USTRUCT" | "UENUM";
	}[] | undefined) ?? [];
	const cppPage = page("cpp", cppDeclarationsAll);
	const heldAll: { target: string; desc?: string }[] = [];
	const assetsAll: { target: string; desc?: string }[] = [];
	for (const edge of elements.edges) {
		const data = edge.data as { source: string; target: string; relation?: string; description?: string };
		if (data.source !== target.id || !HOLD_RELATIONS.has(data.relation ?? "")) continue;
		(ASSET_TYPE_RE.test(data.target) ? assetsAll : heldAll).push({ target: data.target, desc: data.description });
	}
	const heldPage = page("held", heldAll);
	const dataMembersAll = (classData.data_members as { name: string; type?: string; note?: string }[] | undefined) ?? [];
	type AssetRow = { kind: "asset"; target: string; desc?: string } | { kind: "data"; name: string; type?: string; note?: string };
	const assetRowsAll: AssetRow[] = [
		...assetsAll.map((asset): AssetRow => ({ kind: "asset", ...asset })),
		...dataMembersAll.map((member): AssetRow => ({ kind: "data", ...member })),
	];
	const assetPage = page("assets", assetRowsAll);
	const delegatesAll = (classData.delegates as { member: string; type: string }[] | undefined) ?? [];
	const delegatePage = page("delegates", delegatesAll);
	const subscriptionsAll = ((classData.delegate_subscriptions as {
		sourceFunction?: string;
		ownerMember?: string;
		ownerClass: string;
		delegateMember: string;
		delegateType?: string;
		operation: string;
		handler?: string;
	}[] | undefined) ?? []).map((subscription, index) => ({ ...subscription, sourceIndex: index }));
	const subscriptionPage = page("subscriptions", subscriptionsAll);
	const lifecycleAll = elements.nodes.filter((node) => (node.data as { type?: string }).type === "lifecycle_step");
	const lifecyclePage = page("lifecycle", lifecycleAll);

	const els: ElementDefinition[] = [];
	const added = new Set<string>();
	const addNode = (
		data: Record<string, unknown> & { id: string },
		x: number,
		y: number,
		zone?: string,
		classes?: string,
	) => {
		if (added.has(data.id)) return;
		added.add(data.id);
		els.push({ group: "nodes", data: { ...data, parent: zone }, position: { x, y }, ...(classes ? { classes } : {}) });
	};
	// F10：蓝图风格节点——SVG 装饰数据（bpSvg/width/height）+ bp-node 类挂到节点上
	const addBpNode = (
		data: Record<string, unknown> & { id: string },
		bp: BpNodeInput,
		x: number,
		y: number,
		zone?: string,
	) => addNode({ ...data, ...buildBpNodeSvg(bp) }, x, y, zone, "bp-node");
	const addZone = (id: string, label: string, parent?: string, zoneKind?: string) => {
		if (added.has(id)) return;
		added.add(id);
		// zoneKind 驱动 Comment 框配色（UE 蓝图注释框语义）；默认取 id 后缀，可显式覆盖
		els.push({ group: "nodes", data: { id, label, specRole: "zone", zoneKind: zoneKind ?? id.slice(5), ...(parent ? { parent } : {}) } });
	};
	const addEdge = (source: string, target2: string, relation: string, description?: string) => {
		const id = `spec:${source}--${relation}-->${target2}`;
		if (added.has(id)) return;
		added.add(id);
		const classes = relation === "inherits" || relation === "implements"
			? "spec-wire spec-straight"
			: "spec-wire";
		els.push({
			group: "edges",
			data: { id, source, target: target2, relation, ...(description ? { description } : {}) },
			classes,
		});
	};

	// —— 左区入口：基类链与接口从两翼汇入当前类，形成“屮”形 ——
	const CHAIN_X = -100;
	const IFACE_X = 220;
	const ifaces = interfacePage.items;
	const baseChain = inheritancePage.items;
	const ifaceWidths = ifaces.map((name) => buildBpNodeSvg({ title: name, kind: "interface", subtitle: "UE 接口（I 前缀）" }).width);
	const widestIfaceWidth = ifaceWidths.length > 0 ? Math.max(...ifaceWidths) : 0;
	const ifaceRightEdge = IFACE_X + widestIfaceWidth / 2;
	const MID_X = Math.max(560, ifaceRightEdge + 160);
	const naturalCppBaseY = 70;
	const naturalHeldBaseY = cppPage.items.length > 0 ? naturalCppBaseY + cppPage.items.length * 70 + 110 : 100;
	const naturalAssetsBaseY = naturalHeldBaseY + heldPage.items.length * 70 + 110;
	const naturalDelegatesBaseY = naturalAssetsBaseY + assetPage.items.length * 70 + 110;
	const naturalSubscriptionsBaseY = naturalDelegatesBaseY + delegatePage.items.length * 58 + (delegatePage.items.length > 0 ? 110 : 0);
	const naturalMiddleTopY = cppPage.items.length > 0
		? naturalCppBaseY
		: heldPage.items.length > 0
			? naturalHeldBaseY
			: assetPage.items.length > 0
				? naturalAssetsBaseY
				: delegatePage.items.length > 0
					? naturalDelegatesBaseY
					: subscriptionPage.items.length > 0 ? naturalSubscriptionsBaseY : 70;
	const naturalMiddleBottomY = subscriptionPage.items.length > 0
		? naturalSubscriptionsBaseY + (subscriptionPage.items.length - 1) * 62
		: delegatePage.items.length > 0
			? naturalDelegatesBaseY + (delegatePage.items.length - 1) * 58
			: assetPage.items.length > 0
				? naturalAssetsBaseY + (assetPage.items.length - 1) * 70
				: heldPage.items.length > 0
					? naturalHeldBaseY + (heldPage.items.length - 1) * 70
					: cppPage.items.length > 0 ? naturalCppBaseY + (cppPage.items.length - 1) * 70 : 70;
	const naturalMiddleCenterY = (naturalMiddleTopY + naturalMiddleBottomY) / 2;
	const branchDepth = Math.max(baseChain.length, ifaces.length);
	const branchBottomY = branchDepth > 0 ? 70 + (branchDepth - 1) * 85 : 70;
	const minimumHubY = branchDepth > 0 ? branchBottomY + 120 : 70;
	const hubY = Math.max(minimumHubY, naturalMiddleCenterY);
	const middleShiftY = hubY - naturalMiddleCenterY;
	const cppBaseY = naturalCppBaseY + middleShiftY;
	const heldBaseY = naturalHeldBaseY + middleShiftY;
	const assetsBaseY = naturalAssetsBaseY + middleShiftY;
	const delegatesBaseY = naturalDelegatesBaseY + middleShiftY;
	const subscriptionsBaseY = naturalSubscriptionsBaseY + middleShiftY;
	const hubX = ifaces.length > 0 ? (CHAIN_X + IFACE_X) / 2 : CHAIN_X;
	const zoneLabel = (label: string, pagination: { pageCount: number; pageIndex: number; total: number }) =>
		pagination.pageCount > 1 ? `${label}（${pagination.pageIndex + 1}/${pagination.pageCount}，共 ${pagination.total}）` : label;

	if (baseChain.length > 0) addZone("zone:inheritance", zoneLabel("继承链", inheritancePage));
	baseChain.forEach((name, i) => {
		const real = nodeById.get(name)?.data as (Record<string, unknown> & { id: string; type?: string; layer?: string; module?: string }) | undefined;
		addBpNode(
			{ ...(real ?? { id: name, label: name, type: "uclass", layer: "engine" }), chainIndex: i, specRole: "chain" },
			{
				title: name,
				kind: "class",
				subtitle: [ueTypeLabel(real?.type ?? "uclass"), real?.layer ?? "engine"]
					.filter(Boolean)
					.join(" · "),
			},
			CHAIN_X,
			70 + i * 85,
			"zone:inheritance",
		);
		if (i > 0) addEdge(baseChain[i - 1], name, "inherits");
	});

	if (ifaces.length > 0) addZone("zone:ifaces", zoneLabel("接口（implements）", interfacePage));
	ifaces.forEach((name, i) => {
		const real = nodeById.get(name)?.data as (Record<string, unknown> & { id: string }) | undefined;
		addBpNode(
			{ ...(real ?? { id: name, label: name, type: "uinterface" }), specRole: "iface" },
			{ title: name, kind: "interface", subtitle: "UE 接口（I 前缀）" },
			IFACE_X,
			70 + i * 85,
			"zone:ifaces",
		);
	});

	const hub = nodeById.get(target.id)?.data as (Record<string, unknown> & { id: string; type?: string; layer?: string; module?: string }) | undefined;
	const hubTags = Array.isArray(hub?.tags) ? hub.tags.map(String) : [];
	addBpNode(
		{ ...(hub ?? classData), chainIndex: baseChain.length, specRole: "hub" },
		{
			title: target.id,
			kind: "hub",
			subtitle: [ueSpecTypeLabel(hub?.type ?? classData.type, target.id, hub?.cpp_kind ?? classData.cpp_kind, hubTags.includes("cpp_only")), hub?.layer ?? "project", hub?.module]
				.filter(Boolean)
				.join(" · "),
		},
		hubX,
		hubY,
	);
	if (baseChain.length > 0) addEdge(baseChain.at(-1)!, target.id, "inherits");
	for (const iface of ifaces) addEdge(iface, target.id, "implements");

	// —— 中区：同头文件纯 C++ 类型（接口之下、持有对象之上） ——
	const cppDeclarations = cppPage.items;
	if (cppDeclarations.length > 0) addZone("zone:cpp", zoneLabel("纯 C++ 辅助类（含 USTRUCT / UENUM）", cppPage));
	cppDeclarations.forEach((decl, i) => {
		const real = nodeById.get(decl.name)?.data as (Record<string, unknown> & { id: string; type?: string }) | undefined;
		addBpNode(
			{ ...decl, ...(real ?? {}), id: decl.name, label: decl.name, type: real?.type ?? decl.kind, specRole: "cpp" },
			{
				title: decl.name,
				kind: "class",
				subtitle: [decl.reflection ?? decl.kind, decl.bases?.length ? `: ${decl.bases.join(", ")}` : decl.reflection ? "reflected value type" : "non-reflected"].filter(Boolean).join(" · "),
			},
			MID_X,
			cppBaseY + i * 70,
			"zone:cpp",
		);
	});

	// —— 中区：持有对象区 / 数据资产区（各自 compound 方框） ——
	const held = heldPage.items;
	if (held.length > 0) addZone("zone:held", zoneLabel("持有对象区（Components / Subsystem）", heldPage));
	held.forEach((h, i) => {
		const real = nodeById.get(h.target)?.data as (Record<string, unknown> & { id: string; type?: string }) | undefined;
		addBpNode(
			{ ...(real ?? { id: h.target, label: h.target }), specRole: "held" },
			{ title: h.target, kind: "object", subtitle: real?.type ?? "component" },
			MID_X,
			heldBaseY + i * 70,
			"zone:held",
		);
		addEdge(target.id, h.target, "composes", h.desc);
	});
	const assetRows = assetPage.items;
	// 枚举目标：数据成员就是枚举值——用专属视觉语言（绿系值节点 + 枚举值区）而非借用
	// struct 的"数据资产/数据成员"语义，保持类/struct/enum 三者 Spec 视觉一致性
	const isEnumTarget = classData.type === "uenum" || (classData.cpp_kind ?? classData.declarationKind) === "enum";
	if (assetRows.length > 0) {
		if (isEnumTarget) addZone("zone:assets", zoneLabel("枚举值区", assetPage), undefined, "enum-values");
		else addZone("zone:assets", zoneLabel("数据资产 / 数据成员区", assetPage));
	}
	assetRows.forEach((row, i) => {
		if (row.kind === "asset") {
			const real = nodeById.get(row.target)?.data as (Record<string, unknown> & { id: string; type?: string }) | undefined;
			addBpNode(
				{ ...(real ?? { id: row.target, label: row.target }), specRole: "asset" },
				{ title: row.target, kind: "asset", subtitle: real?.type ?? "data asset" },
				MID_X,
				assetsBaseY + i * 70,
				"zone:assets",
			);
			addEdge(target.id, row.target, "depends_on", row.desc);
			return;
		}
		const memberId = `${target.id}::data:${row.name}`;
		if (isEnumTarget) {
			// type 字段承载显式初始值（"1 << 3" 等）；无显式值时不编造序号（分页下会错位）
			addBpNode(
				{ id: memberId, label: row.name, type: "enum_value", value_type: row.type, specRole: "enumValue" },
				{ title: row.name, kind: "enum", subtitle: row.type ? `= ${row.type}` : "枚举值" },
				MID_X,
				assetsBaseY + i * 70,
				"zone:assets",
			);
			addEdge(target.id, memberId, "member");
			return;
		}
		addBpNode(
			{ id: memberId, label: row.name, type: "data_member", value_type: row.type, specRole: "dataMember" },
			{ title: row.name, kind: "asset", subtitle: row.type ?? "" },
			MID_X,
			assetsBaseY + i * 70,
			"zone:assets",
		);
		addEdge(target.id, memberId, "member");
	});
	const delegates = delegatePage.items;
	const subscriptions = subscriptionPage.items;
	if (subscriptions.length > 0) addZone("zone:subscriptions", zoneLabel("订阅委托区（谁家的委托、谁来响应）", subscriptionPage));
	subscriptions.forEach((subscription, i) => {
		const subscriptionId = `${target.id}::subscription:${subscription.ownerMember ?? subscription.ownerClass}:${subscription.delegateMember}:${subscription.sourceIndex}`;
		addBpNode(
			{ ...subscription, id: subscriptionId, label: subscription.delegateMember, specRole: "subscription" },
			{
				title: `${subscription.ownerMember ?? subscription.ownerClass}.${subscription.delegateMember}`,
				kind: "delegate",
				subtitle: `${subscription.delegateType ?? subscription.ownerClass} · ${subscription.operation}`,
			},
			MID_X,
			subscriptionsBaseY + i * 62,
			"zone:subscriptions",
		);
		if (added.has(subscription.ownerClass)) addEdge(subscription.ownerClass, subscriptionId, "binds_event", subscription.operation);
	});
	const middleContentBottomY = naturalMiddleBottomY + middleShiftY;

	// —— 函数分区：静态/调度/接口/访问初始化/委托响应全部位于右区 ——
	const allFns = elements.nodes.filter((n) => {
		const d = n.data as { type?: string; parent?: string };
		return d.type === "ufunction" && d.parent === target.id;
	});
	const fnPagination = paginateSpecFunctions(
		allFns.map((node) => node.data as Record<string, unknown> & { id: string }),
		fnPage,
		FN_PAGE_SIZE,
	);
	const fnPartitions = fnPagination.page;
	const fnPageCount = fnPagination.pageCount;
	const dispatchFns = fnPartitions.dispatch;
	const FN_X = Math.max(1000, MID_X + 440);
	const INTERFACE_FN_X = FN_X + 340;
	const FOG_X = FN_X + (INTERFACE_FN_X - FN_X) * 0.25;
	const staticBaseY = 100;
	const dispatchBaseY = staticBaseY + fnPartitions.statics.length * 58 + (fnPartitions.statics.length > 0 ? 110 : 0);
	const dispatchBottom = dispatchBaseY + dispatchFns.length * 58;
	const accessBaseY = dispatchBottom + (dispatchFns.length > 0 ? 110 : 0);
	const responseBaseY = accessBaseY + fnPartitions.accessors.length * 58 + (fnPartitions.accessors.length > 0 ? 110 : 0);
	const addFunctionNodes = (
		functions: (Record<string, unknown> & { id: string })[],
		zoneId: string,
		zoneLabel: string,
		x: number,
		baseY: number,
		role: "accessor" | "staticFn" | "interfaceFn" | "delegateResponse" | "fn",
	) => {
		if (functions.length === 0) return;
		addZone(zoneId, zoneLabel, "zone:functions");
		functions.forEach((d, i) => {
			const api = d.api as { blueprint_exposable?: boolean; is_static?: boolean } | undefined;
			const tags = Array.isArray(d.tags) ? d.tags.map(String) : [];
			const isOverride = tags.includes("override");
			addBpNode(
				{ ...d, specRole: role },
				{
					title: String(d.label ?? d.id),
					kind: "function",
					bp: !!api?.blueprint_exposable,
					subtitle: [
						role === "staticFn" || api?.is_static ? "static" : api?.blueprint_exposable ? "BlueprintCallable" : "C++",
						isOverride ? "override" : undefined,
					].filter(Boolean).join(" · "),
					execIn: true,
					execOut: true,
				},
				x,
				baseY + i * 58,
				zoneId,
			);
		});
	};
	if (allFns.length > 0) {
		addZone(
			"zone:functions",
			`函数区${fnPageCount > 1 ? `（${fnPagination.pageIndex + 1}/${fnPageCount}，共 ${fnPagination.total}）` : ""}`,
		);
	}
	addFunctionNodes(fnPartitions.statics, "zone:statics", "静态函数区", FN_X, staticBaseY, "staticFn");
	if (dispatchFns.length > 0) {
		addZone(
			"zone:fns",
			`调度函数区${fnPageCount > 1 ? `（函数页 ${fnPagination.pageIndex + 1}/${fnPageCount}，共 ${fnPagination.total}）` : ""}`,
			"zone:functions",
		);
	}
	// 函数归属由各自分区方框表达，不再从类枢纽向每个函数拉 member 线
	// （引擎类一页 10 函数时连线成噪声——用户反馈 2026-07-02）
	addFunctionNodes(dispatchFns, "zone:fns", "调度函数区", FN_X, dispatchBaseY, "fn");
	addFunctionNodes(fnPartitions.interfaceFunctions, "zone:interface-fns", "接口函数区", INTERFACE_FN_X, dispatchBaseY, "interfaceFn");
	addFunctionNodes(fnPartitions.accessors, "zone:accessors", "Getter / Setter / Initter 函数区", FN_X, accessBaseY, "accessor");
	addFunctionNodes(fnPartitions.delegateResponses, "zone:delegate-responses", "委托响应函数区", FN_X, responseBaseY, "delegateResponse");
	// —— 委托类型区：位于中区数据资产/数据成员下方，由类枢纽发出成员线并向右延展未知后续 ——
	if (delegates.length > 0) addZone("zone:delegates", zoneLabel("委托类型（──▷ 未知后续）", delegatePage));
	delegates.forEach((dg, i) => {
		const dgId = `${target.id}::delegate:${dg.member}`;
		const fogId = `fog:${dg.member}`;
		addBpNode(
			{ id: dgId, label: dg.type, delegate_member: dg.member, specRole: "delegate" },
			{ title: dg.type, kind: "delegate", subtitle: dg.member },
			MID_X,
			delegatesBaseY + i * 58,
			"zone:delegates",
		);
		addNode({ id: fogId, label: "▓▒▓▒▓▒", specRole: "fog" }, FOG_X, delegatesBaseY + i * 58);
		addEdge(target.id, dgId, "member");
		addEdge(dgId, fogId, "delegates");
	});

	// 函数 → 成员使用（默认隐藏，hover 浮现）/ 生命周期覆写（常显）
	for (const subscription of subscriptions) {
		if (!subscription.handler) continue;
		const handlerId = `${target.id}::${subscription.handler}`;
		if (added.has(handlerId)) addEdge(`${target.id}::subscription:${subscription.ownerMember ?? subscription.ownerClass}:${subscription.delegateMember}:${subscription.sourceIndex}`, handlerId, "binds_event", subscription.operation);
	}
	const visibleFunctions = [
		...fnPartitions.accessors,
		...fnPartitions.statics,
		...fnPartitions.interfaceFunctions,
		...fnPartitions.delegateResponses,
		...dispatchFns,
	];
	const fnIds = new Set(visibleFunctions.map((f) => String(f.id)));
	let hasLifecycleEdge = false;
	for (const e of elements.edges) {
		const d = e.data as { source: string; target: string; relation?: string; description?: string };
		if (!fnIds.has(d.source)) continue;
		if (d.relation === "uses_member" && added.has(d.target)) addEdge(d.source, d.target, "uses_member", d.description);
		if (d.relation === "overrides") {
			hasLifecycleEdge = true;
			if (lifecyclePage.items.some((step) => String(step.data.id) === d.target)) addEdge(d.source, d.target, "overrides");
		}
	}

	// —— 生命周期条（下）：uactor 或有覆写时展示 ——
	const isActor = (classData.type as string) === "uactor";
	if (isActor || hasLifecycleEdge) {
		const steps = lifecyclePage.items;
		if (steps.length > 0) addZone("zone:lifecycle", zoneLabel("生命周期", lifecyclePage));
		const rightFnBottom = Math.max(
			dispatchBottom,
			fnPartitions.interfaceFunctions.length > 0 ? dispatchBaseY + fnPartitions.interfaceFunctions.length * 58 : 0,
			fnPartitions.accessors.length > 0 ? accessBaseY + fnPartitions.accessors.length * 58 : 0,
			fnPartitions.delegateResponses.length > 0 ? responseBaseY + fnPartitions.delegateResponses.length * 58 : 0,
		);
		const leftBottom = Math.max(hubY, delegatesBaseY + delegates.length * 58);
		const middleBottom = middleContentBottomY;
		const rowY = Math.max(rightFnBottom, leftBottom, middleBottom) + 150;
		steps.forEach((s, i) => {
			const sd = s.data as Record<string, unknown> & { id: string; label?: string };
			// 生命周期步骤 = UE 蓝图事件节点（红标题 + exec 引脚）；节点更宽，间距同步放大
			addBpNode(
				{ ...sd, specRole: "lifecycle" },
				{ title: String(sd.label ?? sd.id), kind: "event", subtitle: "lifecycle event", execIn: i > 0, execOut: i < steps.length - 1 },
				100 + i * 195,
				rowY,
				"zone:lifecycle",
			);
		});
		for (const e of elements.edges) {
			const d = e.data as { source: string; target: string; relation?: string; order?: number };
			if (d.relation === "lifecycle_sequence" && added.has(d.source) && added.has(d.target)) {
				els.push({
					group: "edges",
					data: { id: `spec:${d.source}->${d.target}`, source: d.source, target: d.target, relation: "lifecycle_sequence", order: d.order },
					classes: "spec-wire",
				});
			}
		}
	}

	return els.map((element) => element.group === "edges"
		? decorateSemanticRelationEdge(element as cytoscape.EdgeDefinition)
		: element);
}

export default function SpecView({ elements, target, fnPage, onFnPage, zonePages, onZonePage, hoverId, focusRequest, onHover, onJump, onSelectNode, viewportKey }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
	const pagerLayerRef = useRef<HTMLDivElement>(null);
	const cyRef = useRef<Core | null>(null);
	const [zoomPct, setZoomPct] = useState(100);
	const cbRef = useRef({ onHover, onJump, onSelectNode });
	cbRef.current = { onHover, onJump, onSelectNode };
	const viewportKeyRef = useRef(viewportKey);
	viewportKeyRef.current = viewportKey;
	const functionPagination = paginateSpecFunctions(
		elements.nodes
			.map((node) => node.data as Record<string, unknown> & { id: string })
			.filter((node) => node.type === "ufunction" && node.parent === target.id),
		fnPage,
		FN_PAGE_SIZE,
	);
	const viewClassData = (elements.nodes.find((node) => String(node.data.id) === target.id)?.data ?? {}) as Record<string, unknown>;
	const viewChain = target.chain ?? (viewClassData.inheritance_chain as string[] | undefined) ?? [target.id];
	const holdTargets = elements.edges.filter((edge) => {
		const data = edge.data as { source: string; target: string; relation?: string };
		return data.source === target.id && HOLD_RELATIONS.has(data.relation ?? "");
	}).map((edge) => String((edge.data as { target: string }).target));
	const allZonePagerEntries: { key: SpecZoneKey; label: string; total: number; zoneId: string }[] = [
		{ key: "inheritance", label: "继承链", total: viewChain.filter((name) => name !== target.id).length, zoneId: SPEC_ZONE_NODE_IDS.inheritance },
		{ key: "interfaces", label: "接口", total: elements.edges.filter((edge) => edge.data.source === target.id && edge.data.relation === "implements").length, zoneId: SPEC_ZONE_NODE_IDS.interfaces },
		{ key: "cpp", label: "纯 C++", total: Array.isArray(viewClassData.cpp_declarations) ? viewClassData.cpp_declarations.length : 0, zoneId: SPEC_ZONE_NODE_IDS.cpp },
		{ key: "held", label: "持有对象", total: holdTargets.filter((id) => !ASSET_TYPE_RE.test(id)).length, zoneId: SPEC_ZONE_NODE_IDS.held },
		{ key: "assets", label: viewClassData.type === "uenum" ? "枚举值" : "数据资产/成员", total: holdTargets.filter((id) => ASSET_TYPE_RE.test(id)).length + (Array.isArray(viewClassData.data_members) ? viewClassData.data_members.length : 0), zoneId: SPEC_ZONE_NODE_IDS.assets },
		{ key: "delegates", label: "委托类型", total: Array.isArray(viewClassData.delegates) ? viewClassData.delegates.length : 0, zoneId: SPEC_ZONE_NODE_IDS.delegates },
		{ key: "subscriptions", label: "订阅委托", total: Array.isArray(viewClassData.delegate_subscriptions) ? viewClassData.delegate_subscriptions.length : 0, zoneId: SPEC_ZONE_NODE_IDS.subscriptions },
		{ key: "lifecycle", label: "生命周期", total: elements.nodes.filter((node) => node.data.type === "lifecycle_step").length, zoneId: SPEC_ZONE_NODE_IDS.lifecycle },
	];
	const zonePagerEntries = allZonePagerEntries.filter((entry) => entry.total > SPEC_ZONE_PAGE_SIZE);

	useEffect(() => {
		if (!containerRef.current || !backgroundCanvasRef.current) return;
		const canvas = containerRef.current;
		const backgroundCanvas = backgroundCanvasRef.current;
		const cy = cytoscape({
			container: canvas,
			elements: buildSpecElements(elements, target, fnPage, zonePages),
			// Spec 页元素量小，样式过渡（hover 联动的 dimmed/highlighted 平滑化）常开
			style: stylesheetFor("ue5_code", !REDUCED_MOTION),
			layout: { name: "preset", fit: true, padding: 50 },
			wheelSensitivity: VIEWPORT_POLICY.wheelSensitivity,
			minZoom: VIEWPORT_POLICY.hardMinZoom,
			maxZoom: VIEWPORT_POLICY.hardMaxZoom,
			// 不缓存整张视口纹理：快速平移有限纹理会露出边界。交互时仅隐藏高成本连线/标签，
			// 节点继续在始终覆盖视口的无限背景上实时绘制。
			textureOnViewport: false,
			hideEdgesOnViewport: true,
			hideLabelsOnViewport: true,
			pixelRatio: 1,
		});
		cyRef.current = cy;
		let zoomFrame = 0;
		const syncZoom = () => {
			cancelAnimationFrame(zoomFrame);
			zoomFrame = requestAnimationFrame(() => setZoomPct(Math.round(cy.zoom() * 100)));
		};
		cy.on("zoom", syncZoom);

		// 背景使用“有限表面 + 循环瓦片缓存”：实际 bitmap 仅比视口多一圈 overscan，
		// 网格像素按缩放档位缓存，固定容量循环覆盖，不随世界坐标或拖动距离增长。
		const gridTileCache: { key: string; bitmap: HTMLCanvasElement }[] = [];
		let gridTileCursor = 0;
		const GRID_TILE_CACHE_CAPACITY = 4;
		const cachedGridTile = (minorSize: number) => {
			const majorSize = minorSize * 5;
			const key = `${minorSize}`;
			const cached = gridTileCache.find((entry) => entry.key === key);
			if (cached) return cached.bitmap;
			const bitmap = document.createElement("canvas");
			bitmap.width = majorSize;
			bitmap.height = majorSize;
			const context = bitmap.getContext("2d");
			if (context) {
				context.clearRect(0, 0, majorSize, majorSize);
				context.lineWidth = 1;
				context.strokeStyle = "rgba(130, 151, 206, 0.06)";
				context.beginPath();
				for (let offset = minorSize; offset < majorSize; offset += minorSize) {
					context.moveTo(offset + 0.5, 0);
					context.lineTo(offset + 0.5, majorSize);
					context.moveTo(0, offset + 0.5);
					context.lineTo(majorSize, offset + 0.5);
				}
				context.stroke();
				context.strokeStyle = "rgba(130, 151, 206, 0.11)";
				context.beginPath();
				context.moveTo(0.5, 0);
				context.lineTo(0.5, majorSize);
				context.moveTo(0, 0.5);
				context.lineTo(majorSize, 0.5);
				context.stroke();
			}
			const entry = { key, bitmap };
			if (gridTileCache.length < GRID_TILE_CACHE_CAPACITY) gridTileCache.push(entry);
			else {
				gridTileCache[gridTileCursor] = entry;
				gridTileCursor = (gridTileCursor + 1) % GRID_TILE_CACHE_CAPACITY;
			}
			return bitmap;
		};
		const paintBackground = () => {
			const width = Math.max(1, Math.ceil(backgroundCanvas.clientWidth));
			const height = Math.max(1, Math.ceil(backgroundCanvas.clientHeight));
			if (backgroundCanvas.width !== width || backgroundCanvas.height !== height) {
				backgroundCanvas.width = width;
				backgroundCanvas.height = height;
			}
			const context = backgroundCanvas.getContext("2d");
			if (!context) return;
			context.fillStyle = SVG_INK.specPanelBg;
			context.fillRect(0, 0, width, height);
			const glow = context.createRadialGradient(width * 0.5, height * 0.44, 0, width * 0.5, height * 0.44, Math.max(width, height) * 0.7);
			glow.addColorStop(0, "rgba(39, 54, 82, 0.5)");
			glow.addColorStop(1, "rgba(16, 21, 33, 0)");
			context.fillStyle = glow;
			context.fillRect(0, 0, width, height);

			const gridScale = Math.min(2.4, Math.max(0.4, cy.zoom()));
			const minorSize = Math.max(19, Math.round(48 * gridScale));
			const majorSize = minorSize * 5;
			const pattern = context.createPattern(cachedGridTile(minorSize), "repeat");
			if (!pattern) return;
			const pan = cy.pan();
			const offsetX = ((Math.round(pan.x) % majorSize) + majorSize) % majorSize;
			const offsetY = ((Math.round(pan.y) % majorSize) + majorSize) % majorSize;
			context.save();
			context.translate(offsetX, offsetY);
			context.fillStyle = pattern;
			context.fillRect(-offsetX, -offsetY, width + majorSize, height + majorSize);
			context.restore();
		};

		// 分页属于语义区，而不是屏幕角落：DOM 控件随 compound 区框的渲染包围盒移动。
		let pagerFrame = 0;
		const positionZonePagers = () => {
			pagerFrame = 0;
			paintBackground();
			const layer = pagerLayerRef.current;
			if (!layer || cy.destroyed()) return;
			for (const element of layer.querySelectorAll<HTMLElement>("[data-zone-id]")) {
				const zone = cy.getElementById(element.dataset.zoneId ?? "");
				if (zone.empty() || !zone.isNode()) {
					element.hidden = true;
					continue;
				}
				element.hidden = false;
				const box = zone.renderedBoundingBox();
				const x = Math.max(4, box.x2 - element.offsetWidth - 8);
				const y = Math.max(4, box.y1 + 5);
				element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
			}
		};
		const schedulePagerPosition = () => {
			if (!pagerFrame) pagerFrame = window.requestAnimationFrame(positionZonePagers);
		};
		cy.on("pan zoom resize", schedulePagerPosition);
		const canvasResizeObserver = new ResizeObserver(schedulePagerPosition);
		canvasResizeObserver.observe(backgroundCanvas);
		schedulePagerPosition();

		// 预设坐标按固定间距排布，宽标签（长类名/接口名/委托类型）可能互相叠压——
		// 布局后自动分离一次，有位移则重新适配视口
		resolveNodeOverlaps(cy, { margin: 10 });
		setSpecOverview(cy, false);

		// F6：视口策略（参照 UE 蓝图编辑器）——
		// 同键有记忆（重开本类 Spec / 函数翻页重建）→ 恢复上次 pan/zoom；
		// 首次打开 → 逻辑入口焦点：整图 fit 后若缩得太小看不清，改为对准类枢纽本身。
		// key 在构建时捕获（清理阶段 ref 已是新 key，见 GraphView 同款注释）
		const vpKey = viewportKeyRef.current;
		const saved = vpKey ? loadViewport(vpKey) : undefined;
		if (saved) {
			cy.viewport({ zoom: clampManualZoom(saved.zoom), pan: saved.pan });
		} else if (cy.zoom() < 0.55) {
			const hub = cy.nodes('[specRole = "hub"]');
			if (hub.nonempty()) {
				cy.zoom(0.85);
				cy.center(hub);
			}
		}
		syncZoom();

		// ═══ F9：蓝图绘制入场——首次打开本类 Spec（无视口记忆）时按阅读顺序分组点亮：
		// 继承/接口 → 纯 C++ → 持有/资产/订阅 → 各函数区 → 委托类型/雾团 → 生命周期，连线最后接通。
		// 函数翻页/重开走视口记忆分支，不重演动画（高频操作不被拖慢）══
		const timers: number[] = [];
		if (!REDUCED_MOTION && !saved) {
			const byRole = (r: string) => cy.nodes(`[specRole = "${r}"]`);
			const zone = (id: string) => cy.getElementById(id);
			const waves = [
				byRole("hub").union(byRole("chain")),
				byRole("iface").union(zone("zone:ifaces")),
				byRole("cpp").union(zone("zone:cpp")),
				byRole("held").union(zone("zone:held")).union(byRole("asset")).union(byRole("dataMember")).union(zone("zone:assets")).union(byRole("subscription")).union(zone("zone:subscriptions")),
				byRole("staticFn").union(zone("zone:statics")),
				byRole("fn").union(zone("zone:fns")).union(byRole("interfaceFn")).union(zone("zone:interface-fns")),
				byRole("accessor").union(zone("zone:accessors")).union(byRole("delegateResponse")).union(zone("zone:delegate-responses")),
				byRole("delegate").union(zone("zone:delegates")).union(byRole("fog")),
				byRole("lifecycle"),
			].filter((w) => w.nonempty());
			cy.elements().style("opacity", 0);
			waves.forEach((w, i) => {
				timers.push(
					window.setTimeout(() => {
						w.animate({ style: { opacity: 1 } }, { duration: 200, easing: "ease-out" });
					}, i * 80),
				);
			});
			// 连线统一接通；结束后归还样式控制权（各类边的默认透明度不同，inline 会压住类样式）
			timers.push(
				window.setTimeout(() => {
					cy.edges().animate({ style: { opacity: 1 } }, { duration: 220, easing: "ease-out" });
				}, waves.length * 80 + 60),
			);
			timers.push(window.setTimeout(() => cy.elements().removeStyle("opacity"), waves.length * 80 + 400));
		}

		// 单类 Spec 与主图共用语义关系流水线：hover 后持续运转，移开即完整复位。
		const clearRelationMotion = bindSemanticRelationMotion(cy, REDUCED_MOTION);

		// F9：委托雾团呼吸——"未知监听者"在雾中若隐若现（仅数个节点，成本可忽略）
		if (!REDUCED_MOTION) {
			const breathe = (ele: cytoscape.NodeSingular, up: boolean) => {
				if (cy.destroyed()) return;
				ele.animate(
					{ style: { "background-opacity": up ? 0.42 : 0.12 } },
					{ duration: 1500, easing: "ease-in-out", complete: () => breathe(ele, !up) },
				);
			};
			timers.push(
				window.setTimeout(() => cy.nodes('[specRole = "fog"]').forEach((f) => breathe(f, true)), 900),
			);
		}

		// Home：回正（fit 全图，同 UE 蓝图 Zoom to Fit）；不劫持输入框按键
		const onKeyDown = (e: KeyboardEvent) => {
			const t = e.target;
			const typing =
				t instanceof HTMLInputElement ||
				t instanceof HTMLTextAreaElement ||
				t instanceof HTMLSelectElement ||
				(t instanceof HTMLElement && t.isContentEditable);
			if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
			if (SHORTCUT_KEYS.graph.fit.some((key) => key === e.key)) {
				setSpecOverview(cy, true);
			}
		};
		window.addEventListener("keydown", onKeyDown);

		cy.on("mouseover", "node", (evt) => {
			if (evt.target.data("specRole") === "zone") return;
			cbRef.current.onHover(evt.target.id());
		});
		cy.on("mouseout", "node", () => cbRef.current.onHover(null));
		cy.on("tap", "node", (evt) => {
			const data = evt.target.data() as Record<string, unknown> & { id: string; specRole?: string };
			if (data.specRole === "zone") return;
			cbRef.current.onSelectNode(data);
			// 继承链节点：单击跳转到该类的 Spec（追溯线索）
			if (data.specRole === "chain") {
				const chain = (target.chain ?? (elements.nodes.find((n) => n.data.id === target.id)?.data as { inheritance_chain?: string[] })?.inheritance_chain) ?? [];
				const idx = chain.indexOf(data.id);
				cbRef.current.onJump({ id: data.id, chain: idx >= 0 ? chain.slice(0, idx + 1) : undefined });
				return;
			}
			// 类的构成（持有对象/数据资产）：与继承链同款跳转，入追溯栈可原路返回
			if (data.specRole === "held" || data.specRole === "asset" || data.specRole === "iface" || data.specRole === "cpp") {
				cbRef.current.onJump({
					id: data.id,
					...(data.specRole === "cpp" && viewClassData.source_path ? { sourcePath: String(viewClassData.source_path) } : {}),
				});
			}
		});
		cy.on("tap", (evt) => {
			if (evt.target === cy) cbRef.current.onSelectNode(null);
		});

		return () => {
			window.removeEventListener("keydown", onKeyDown);
			for (const t of timers) window.clearTimeout(t);
			clearRelationMotion();
			cy.off("pan zoom resize", schedulePagerPosition);
			canvasResizeObserver.disconnect();
			if (pagerFrame) window.cancelAnimationFrame(pagerFrame);
			cancelAnimationFrame(zoomFrame);
			cy.off("zoom", syncZoom);
			if (vpKey) {
				saveViewport(vpKey, { zoom: cy.zoom(), pan: cy.pan() });
			}
			cyRef.current = null;
			cy.destroy();
		};
	}, [elements, target, fnPage, zonePages]);

	// 面板点击 → 图内定位：居中 + 适度放大到该节点
	useEffect(() => {
		const cy = cyRef.current;
		if (!cy || !focusRequest) return;
		const node = cy.getElementById(focusRequest.id);
		if (node.empty() || !node.isNode()) return;
		const readableZoom = boundedLocateZoom(cy.zoom());
		cy.animate({
			center: { eles: node },
			zoom: readableZoom,
			duration: ANIM(260),
			easing: "ease-out",
		});
		pulseNode(node);
	}, [focusRequest]);

	const zoomBy = (factor: number) => {
		const cy = cyRef.current;
		if (!cy) return;
		cy.animate({
			zoom: {
				level: clampManualZoom(cy.zoom() * factor),
				renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
			},
			duration: ANIM(120),
		});
	};
	const setZoomPercent = (nextZoomPct: number) => {
		const cy = cyRef.current;
		if (!cy) return;
		cy.stop();
		cy.animate({
			zoom: {
				level: clampManualZoom(nextZoomPct / 100),
				renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
			},
			duration: ANIM(120),
		});
	};

	// hover 联动：高亮邻域 + 浮现该节点相关的 uses_member 调度连线，其余压暗
	useEffect(() => {
		const cy = cyRef.current;
		if (!cy) return;
		cy.elements().removeClass("dimmed").removeClass("highlighted");
		cy.edges(".uses-visible").removeClass("uses-visible");
		if (!hoverId) return;
		const node = cy.getElementById(hoverId);
		if (node.empty() || !node.isNode()) return;

		const usesEdges = node.connectedEdges('[relation = "uses_member"]');
		usesEdges.addClass("uses-visible");

		let hood = node
			.closedNeighborhood()
			.union(node.ancestors())
			.union(usesEdges)
			.union(usesEdges.connectedNodes())
			.union(usesEdges.connectedNodes().ancestors());
		// compound 父节点的 opacity 会级联到子节点——必须把 hood 内所有节点的
		// zone 祖先也纳入，否则 dimmed 的 zone 会压暗其中已 highlighted 的子节点
		hood = hood.union(hood.nodes().ancestors());
		cy.elements().addClass("dimmed");
		hood.removeClass("dimmed").addClass("highlighted");
	}, [hoverId]);

	// F6：对准类枢纽（逻辑入口焦点的手动回正入口）
	const centerHub = () => {
		const cy = cyRef.current;
		if (!cy) return;
		const hub = cy.nodes('[specRole = "hub"]');
		if (hub.empty()) return;
		cy.animate({ center: { eles: hub }, zoom: boundedLocateZoom(cy.zoom()), duration: ANIM(220), easing: "ease-out" });
	};

	return (
		<>
			<div className="spec-canvas-surface">
				<canvas ref={backgroundCanvasRef} className="spec-canvas-cache" aria-hidden="true" />
				<div className="graph-canvas spec-cytoscape-canvas" ref={containerRef} />
			</div>
			{zonePagerEntries.length > 0 || functionPagination.pageCount > 1 ? (
				<div ref={pagerLayerRef} className="spec-zone-pagers" aria-label="类详情分区分页">
					{zonePagerEntries.map((entry) => {
						const pagination = paginateSpecZone(Array.from({ length: entry.total }), zonePages[entry.key] ?? 0);
						return (
							<div key={entry.key} className="spec-zone-pager-row" data-zone-id={entry.zoneId}>
								<SpecFunctionPager
									label={entry.label}
									page={pagination.pageIndex}
									pageCount={pagination.pageCount}
									total={pagination.total}
									onPage={(page) => onZonePage(entry.key, page)}
									compact
								/>
							</div>
						);
					})}
					{functionPagination.pageCount > 1 ? (
						<div className="spec-zone-pager-row" data-zone-id="zone:functions">
							<SpecFunctionPager
								label="函数"
								page={functionPagination.pageIndex}
								pageCount={functionPagination.pageCount}
								total={functionPagination.total}
								onPage={onFnPage}
								compact
							/>
						</div>
					) : null}
				</div>
			) : null}
			<div className="graph-controls" data-zoom-pct={zoomPct}>
				<button title="对准当前类" aria-label="对准当前类" onClick={centerHub}>⌖</button>
				<button title="适配全图（Home / F）" aria-label="适配全图" onClick={() => cyRef.current && setSpecOverview(cyRef.current, true)}>⊞</button>
				<button title="缩小" aria-label="缩小" onClick={() => zoomBy(1 / VIEWPORT_POLICY.zoomStep)}>－</button>
				<ViewportZoomControl zoomPct={zoomPct} onChange={setZoomPercent} />
				<button title="放大" aria-label="放大" onClick={() => zoomBy(VIEWPORT_POLICY.zoomStep)}>＋</button>
			</div>
		</>
	);
}
