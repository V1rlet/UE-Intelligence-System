export interface ApiNodeParameter {
	name: string;
	type: string;
	note?: string;
}

export interface ApiNodeEntry {
	label: string;
	parent: string;
	module: string;
	layer?: string;
	source_path?: string;
	api?: {
		signature?: string;
		return_type?: string;
		params?: ApiNodeParameter[];
	};
}

export interface ApiFunctionNodeModel {
	signature: string;
	visibleParams: ApiNodeParameter[];
	hiddenParamCount: number;
	returnType: string;
	sourceFile: string;
	sourceLabel: "UE 5.8" | "PROJECT";
}

/** Maps the complete list-row payload into the compact Spec-node presentation. */
export function buildApiFunctionNodeModel(entry: ApiNodeEntry, maxVisibleParams = 4): ApiFunctionNodeModel {
	const params = entry.api?.params ?? [];
	const returnType = entry.api?.return_type ?? "void";
	return {
		signature: entry.api?.signature ?? `${returnType} ${entry.label}(${params.map((param) => `${param.type} ${param.name}`).join(", ")})`,
		visibleParams: params.slice(0, maxVisibleParams),
		hiddenParamCount: Math.max(0, params.length - maxVisibleParams),
		returnType,
		sourceFile: entry.source_path?.split(/[\\/]/).at(-1) ?? entry.parent,
		sourceLabel: entry.layer === "engine" ? "UE 5.8" : "PROJECT",
	};
}
