// Graph Brain / core/schema - UE/C++ 类型前缀语义（浏览器、提取器与 API 服务共享）

export type UeGraphClassType = "uactor" | "uclass" | "ucomponent" | "uinterface" | "ustruct" | "uenum";

/** 所有采用统一类 Spec 主视图的代码节点类型。各只读视图与关系检视共同复用。 */
export const UE_SPEC_NODE_TYPES = [
	"uclass",
	"uactor",
	"ucomponent",
	"uinterface",
	"ustruct",
	"uenum",
] as const satisfies readonly UeGraphClassType[];

/** 文件森林投影的结构节点；服务端投影与客户端导航共享。 */
export const UE_FOREST_NODE_TYPES = ["folder", "file"] as const;

/** Shared compact labels for list facets, badges and evidence summaries. */
export const UE_NODE_TYPE_SHORT_LABELS: Readonly<Record<string, string>> = {
	uclass: "类",
	uactor: "Actor",
	ucomponent: "组件",
	uinterface: "接口",
	ustruct: "结构体",
	uenum: "枚举",
	ufunction: "函数",
	file: "文件",
	folder: "目录",
};

export function ueNodeTypeShortLabel(type: unknown): string {
	const key = String(type ?? "");
	return UE_NODE_TYPE_SHORT_LABELS[key] ?? key;
}

const UE_FOREST_NODE_TYPE_SET = new Set<string>(UE_FOREST_NODE_TYPES);

export function isUeForestNodeType(type: unknown): type is typeof UE_FOREST_NODE_TYPES[number] {
	return UE_FOREST_NODE_TYPE_SET.has(String(type ?? ""));
}

/** 单一事实源：代码类型前缀 → GraphBrain Spec 类型。S 表示 Slate/普通 S 类，仍使用通用 class Spec。 */
export const UE_CODE_PREFIX_TYPES = {
	A: "uactor",
	U: "uclass",
	F: "ustruct",
	E: "uenum",
	I: "uinterface",
	S: "uclass",
} as const satisfies Record<string, UeGraphClassType>;

export const UE_API_CLASS_PREFIXES = ["A", "U", "F", "I", "S"] as const;
export const UE_API_ENUM_PREFIX = "E";

export function isUeCodeTypeName(name: string): boolean {
	return name.length > 1
		&& /^[A-Z]$/.test(name[1])
		&& Object.prototype.hasOwnProperty.call(UE_CODE_PREFIX_TYPES, name[0]);
}

export function ueTypeFromCodeName(
	name: string,
	declarationKind?: "class" | "struct" | "enum",
): UeGraphClassType {
	if (declarationKind === "enum") return "uenum";
	if (declarationKind === "struct") return "ustruct";
	if (/Component$/.test(name)) return "ucomponent";
	return UE_CODE_PREFIX_TYPES[name[0] as keyof typeof UE_CODE_PREFIX_TYPES] ?? "uclass";
}

/** UE 文件名通常去掉类型前缀；精确 source_path 存在时应优先用精确路径。 */
export function ueHeaderStemForType(name: string): string {
	return isUeCodeTypeName(name)
		? name.slice(1)
		: name;
}

export const UE_CLASS_TYPE_INFO: Record<string, { label: string; prefix: string; pattern: RegExp }> = {
	uactor: { label: "Actor 类（A 前缀）", prefix: "A", pattern: /^A[A-Z]/ },
	uclass: { label: "UObject / Slate / 普通 C++ 类（U/S 前缀）", prefix: "U/S", pattern: /^[US][A-Z]/ },
	ucomponent: { label: "ActorComponent 类（U 前缀）", prefix: "U", pattern: /^U[A-Z]/ },
	uinterface: { label: "接口类（I 前缀）", prefix: "I", pattern: /^I[A-Z]/ },
	ustruct: { label: "结构体（F 前缀）", prefix: "F", pattern: /^F[A-Z]/ },
	uenum: { label: "枚举（E 前缀）", prefix: "E", pattern: /^E[A-Z]/ },
};

export function ueTypeLabel(type: unknown): string {
	const key = String(type ?? "");
	return UE_CLASS_TYPE_INFO[key]?.label ?? key;
}

/** Spec 检视器中的非空类型说明；普通 C++ 类型同时保留声明种类与 GraphBrain 映射。 */
export function ueSpecTypeLabel(
	type: unknown,
	name: string,
	cppKind?: unknown,
	cppOnly = false,
): string {
	const rawType = String(type ?? "").trim();
	const resolvedType = rawType && UE_CLASS_TYPE_INFO[rawType] ? rawType : ueTypeFromCodeName(name);
	const graphLabel = ueTypeLabel(resolvedType);
	if (!cppOnly) return graphLabel;
	const declarationKind = String(cppKind ?? "").trim()
		|| (resolvedType === "uenum" ? "enum" : resolvedType === "ustruct" ? "struct" : "class");
	return `${declarationKind}（纯 C++） · ${graphLabel}`;
}

/** 返回 null 表示一致；非空字符串可直接作为校验错误展示。 */
export function checkUeClassName(id: string, type: string): string | null {
	const info = UE_CLASS_TYPE_INFO[type];
	if (!info || info.pattern.test(id)) return null;
	return `节点 ${id} 的 type=${type} 表示${info.label}，类名必须以 ${info.prefix} 开头`;
}
