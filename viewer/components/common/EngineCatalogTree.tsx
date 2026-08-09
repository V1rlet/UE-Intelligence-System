import AppIcon from "./AppIcon";
import { ENGINE_SCOPES, type EngineCatalogModule, type EngineScope } from "../../src/engineCatalogModel";
import type { EngineCatalogState } from "../../src/useEngineCatalog";

interface Props {
	state: EngineCatalogState;
	ariaLabel?: string;
	compact?: boolean;
	onSelectModule?: (module: EngineCatalogModule) => void;
}

const SCOPE_LABELS: Record<EngineScope, string> = {
	Runtime: "运行时核心",
	Developer: "开发工具",
	Editor: "编辑器能力",
	Plugins: "引擎插件",
};

/** Shared engine forest: source and API lenses consume one directory position. */
export default function EngineCatalogTree({ state, ariaLabel = "UE 源码森林", compact = false, onSelectModule }: Props) {
	const { catalog, selectedModule, expandedScopes, moduleFilter } = state;
	const query = moduleFilter.trim().toLowerCase();
	const filtering = query.length > 0;
	return <aside className={`engine-module-tree${compact ? " is-compact" : ""}`} aria-label={ariaLabel}>
		<div className="engine-forest-root">
			<span className="engine-forest-root-icon"><AppIcon name="graph" size={17} /></span>
			<span><small>共享代码森林根域</small><b>UE {catalog?.engine_version ?? "5.8"} · Engine Source</b></span>
			<small>{catalog ? `${catalog.totals.modules} 模块` : "读取中"}</small>
		</div>
		<label className="engine-module-filter"><AppIcon name="search" size={14} /><input aria-label="筛选 UE 模块" value={moduleFilter} onChange={(event) => state.setModuleFilter(event.target.value)} placeholder="跨分支筛选模块…" /></label>
		<div className="engine-forest-branches">
			{ENGINE_SCOPES.map((scope) => {
				const modules = (catalog?.modules ?? []).filter((item) => item.scope === scope && (!query || item.name.toLowerCase().includes(query)));
				const expanded = filtering || expandedScopes.has(scope);
				const total = catalog?.modules.filter((item) => item.scope === scope).length ?? 0;
				return <section className={`engine-forest-branch${expanded ? " expanded" : ""}`} data-scope={scope.toLowerCase()} key={scope}>
					<button type="button" className="engine-forest-scope" aria-expanded={expanded} onClick={() => state.toggleScope(scope)}>
						<i aria-hidden="true">{expanded ? "−" : "+"}</i>
						<span><b>{scope}</b><small>{SCOPE_LABELS[scope]}</small></span>
						<em>{filtering ? `${modules.length}/${total}` : total}</em>
					</button>
					{expanded ? <div className="engine-module-list">{modules.map((module) => {
						const active = selectedModule?.name === module.name && selectedModule.scope === module.scope;
						return <button type="button" key={`${module.scope}:${module.name}`} className={`engine-module-card${active ? " active" : ""}`} aria-pressed={active} onClick={() => { state.selectModule(module); onSelectModule?.(module); }}><span className="engine-module-node" aria-hidden="true" /><b>{module.name}</b><small>{module.header_count} 头文件</small></button>;
					})}{modules.length === 0 ? <small className="engine-branch-empty">该分支没有匹配模块</small> : null}</div> : null}
				</section>;
			})}
		</div>
	</aside>;
}

