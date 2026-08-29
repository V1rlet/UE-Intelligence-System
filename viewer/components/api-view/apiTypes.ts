// Graph Brain / viewer - API Reference View 共享类型（三列拆分后单一事实源）。
// 三列共用：左 ApiCatalogPane / 中 ApiReferenceView 本体（测试锚定）/ 右 ApiDetailPane。
import type { SpecTarget } from "../graph-view/specModel";
import type { CodeSource } from "../../src/codeWorkspaceModel";
import { CODE_QUICK_GROUPS } from "../../src/codeQuickEntries";
export type {
	CatalogSyncStatus,
	EngineCatalog,
	EngineCatalogClass,
	EngineCatalogModule,
} from "../../src/engineCatalogModel";
export { ALL_ENGINE_CATALOG as ALL_CATALOG_FILTER, normalizeEngineCatalogClasses } from "../../src/engineCatalogModel";

export interface ApiInfo {
	signature?: string;
	return_type?: string;
	params?: { name: string; type: string; note?: string }[];
	companions?: string[];
	cpp_only?: boolean;
	blueprint_exposable?: boolean;
	is_static?: boolean;
}

export interface FnEntry {
	id: string;
	label: string;
	parent: string;
	module: string;
	description?: string;
	tags: string[];
	api?: ApiInfo;
	layer?: string;
	source_path?: string;
}

export interface EngineClassInfo {
	name: string;
	folder: string;
	group: (typeof CODE_QUICK_GROUPS)[number]["id"];
	parsed: boolean;
	loading: boolean;
}

export interface ApiClassFavorite {
	name: string;
	source: "project" | "engine";
	module?: string;
	sourcePath?: string;
}

export interface ApiFunctionFavoriteRef extends FnEntry {
	layer: string;
}

export interface ApiSpecTrailEntry extends SpecTarget {
	source: "project" | "engine";
}

export type Source = CodeSource;
export type EngineMetaFilter = "BlueprintCallable" | "C++ Only" | "WorldContext" | "Latent";
