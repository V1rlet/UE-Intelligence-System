// Graph Brain / viewer - Spec 视图共享模型（保持 App/面板不加载 Cytoscape 渲染器）

export interface SpecTarget {
	id: string;
	chain?: string[];
	/** 同头文件辅助类型跳转时沿用来源头文件，避免依赖“类型名 = 文件名”的启发式。 */
	sourcePath?: string;
}

export interface FocusRequest {
	id: string;
	seq: number;
}

/** 函数区每页节点数（小页保证布局一眼可读） */
export const FN_PAGE_SIZE = 10;

/** 非函数语义区每页节点数；六项保持单屏可读，第七项起分页。 */
export const SPEC_ZONE_PAGE_SIZE = 6;

export type SpecZoneKey =
	| "inheritance"
	| "interfaces"
	| "cpp"
	| "held"
	| "assets"
	| "delegates"
	| "subscriptions"
	| "lifecycle";

/** 分页控件锚定到真实 compound 区框；UI 不再按屏幕角落推断位置。 */
export const SPEC_ZONE_NODE_IDS: Record<SpecZoneKey, string> = {
	inheritance: "zone:inheritance",
	interfaces: "zone:ifaces",
	cpp: "zone:cpp",
	held: "zone:held",
	assets: "zone:assets",
	delegates: "zone:delegates",
	subscriptions: "zone:subscriptions",
	lifecycle: "zone:lifecycle",
};

export type SpecZonePages = Partial<Record<SpecZoneKey, number>>;

export interface SpecZonePage<T> {
	items: T[];
	pageIndex: number;
	pageCount: number;
	total: number;
}

export function paginateSpecZone<T>(items: T[], requestedPage: number, pageSize = SPEC_ZONE_PAGE_SIZE): SpecZonePage<T> {
	const safePageSize = Math.max(1, Math.floor(pageSize));
	const pageCount = Math.ceil(items.length / safePageSize);
	const pageIndex = pageCount > 0 ? Math.min(Math.max(Math.floor(requestedPage), 0), pageCount - 1) : 0;
	return {
		items: items.slice(pageIndex * safePageSize, (pageIndex + 1) * safePageSize),
		pageIndex,
		pageCount,
		total: items.length,
	};
}
