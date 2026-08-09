import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "./apiFetch";
import {
	ALL_ENGINE_CATALOG,
	type EngineCatalog,
	type EngineCatalogClass,
	type EngineCatalogModule,
	type EngineScope,
} from "./engineCatalogModel";

export interface EngineCatalogState {
	catalog: EngineCatalog | null;
	error: string | null;
	selectedScope: EngineScope | typeof ALL_ENGINE_CATALOG;
	selectedModuleName: string | typeof ALL_ENGINE_CATALOG;
	selectedModule: EngineCatalogModule | null;
	selectedClass: EngineCatalogClass | null;
	expandedScopes: Set<EngineScope>;
	moduleFilter: string;
	setModuleFilter: (value: string) => void;
	selectScope: (scope: EngineScope | typeof ALL_ENGINE_CATALOG) => void;
	selectModule: (module: EngineCatalogModule | null) => void;
	selectClass: (entry: EngineCatalogClass | null) => void;
	toggleScope: (scope: EngineScope) => void;
	refresh: () => void;
}

/** One owner for the engine directory and the user's position inside it. */
export function useEngineCatalog(sourceRoot?: string, enabled = true): EngineCatalogState {
	const [catalog, setCatalog] = useState<EngineCatalog | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [refreshSeq, setRefreshSeq] = useState(0);
	const [selectedScope, setSelectedScope] = useState<EngineScope | typeof ALL_ENGINE_CATALOG>(ALL_ENGINE_CATALOG);
	const [selectedModuleName, setSelectedModuleName] = useState<string | typeof ALL_ENGINE_CATALOG>(ALL_ENGINE_CATALOG);
	const [expandedScopes, setExpandedScopes] = useState<Set<EngineScope>>(() => new Set(["Runtime"]));
	const [moduleFilter, setModuleFilter] = useState("");
	const [selectedClass, setSelectedClass] = useState<EngineCatalogClass | null>(null);

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		const controller = new AbortController();
		const query = sourceRoot ? `?source_root=${encodeURIComponent(sourceRoot)}` : "";
		setCatalog(null);
		setError(null);
		apiFetchJson<EngineCatalog>(`/api/engine-catalog${query}`, { signal: controller.signal }, { notify: false, context: "引擎源码目录" })
			.then((body) => {
				if (cancelled) return;
				setCatalog(body);
				setError(null);
			})
			.catch((reason) => {
				if (!cancelled && (reason as Error).name !== "AbortError") setError(String((reason as Error).message ?? reason));
			});
		return () => { cancelled = true; controller.abort(); };
	}, [enabled, refreshSeq, sourceRoot]);

	const selectedModule = useMemo(() => {
		if (selectedModuleName === ALL_ENGINE_CATALOG) return null;
		return catalog?.modules.find((entry) => entry.name === selectedModuleName && (selectedScope === ALL_ENGINE_CATALOG || entry.scope === selectedScope)) ?? null;
	}, [catalog, selectedModuleName, selectedScope]);

	const selectScope = useCallback((scope: EngineScope | typeof ALL_ENGINE_CATALOG) => {
		setSelectedScope(scope);
		setSelectedModuleName(ALL_ENGINE_CATALOG);
		if (scope !== ALL_ENGINE_CATALOG) setExpandedScopes((current) => new Set(current).add(scope));
	}, []);

	const selectModule = useCallback((module: EngineCatalogModule | null) => {
		if (!module) {
			setSelectedModuleName(ALL_ENGINE_CATALOG);
			setSelectedClass(null);
			return;
		}
		setSelectedClass((current) => current?.scope === module.scope && current.module === module.name ? current : null);
		setSelectedScope(module.scope);
		setSelectedModuleName(module.name);
		setExpandedScopes((current) => new Set(current).add(module.scope));
	}, []);

	const selectClass = useCallback((entry: EngineCatalogClass | null) => {
		setSelectedClass(entry);
		if (!entry) return;
		setSelectedScope(entry.scope);
		setSelectedModuleName(entry.module);
		setExpandedScopes((current) => new Set(current).add(entry.scope));
	}, []);

	const toggleScope = useCallback((scope: EngineScope) => {
		setExpandedScopes((current) => {
			const next = new Set(current);
			if (next.has(scope)) next.delete(scope);
			else next.add(scope);
			return next;
		});
	}, []);

	return {
		catalog,
		error,
		selectedScope,
		selectedModuleName,
		selectedModule,
		selectedClass,
		expandedScopes,
		moduleFilter,
		setModuleFilter,
		selectScope,
		selectModule,
		selectClass,
		toggleScope,
		refresh: () => setRefreshSeq((value) => value + 1),
	};
}
