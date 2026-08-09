export type KnowledgeTypeId = "gotcha" | "best_practice" | "design_decision" | "performance" | "reference";

export interface KnowledgeTypePresentation {
	id: KnowledgeTypeId;
	label: string;
	mark: string;
	hint: string;
	prompt: string;
}

export interface KnowledgeContext {
	domain: "ue5_code";
	kicker: string;
	title: string;
	objectName: string;
	collectionName: string;
	sourceName: string;
	manualTrustLabel: string;
	summaryGuide: string;
	headerGuide: (nodeId: string) => string;
	emptyGuide: string;
	types: readonly KnowledgeTypePresentation[];
}

const CODE_TYPES: readonly KnowledgeTypePresentation[] = [
	{ id: "gotcha", label: "风险", mark: "!", hint: "失效条件、生命周期陷阱与隐含约束", prompt: "描述触发条件、错误表现，以及安全替代方案…" },
	{ id: "best_practice", label: "实践", mark: "✓", hint: "经过验证的实现模式与团队约定", prompt: "记录推荐做法、适用范围，以及为什么这样做…" },
	{ id: "design_decision", label: "决策", mark: "●", hint: "已发生的代码决策、权衡与依据", prompt: "记录现有实现选择、依据与已知取舍…" },
	{ id: "performance", label: "性能", mark: "→", hint: "成本热点、预算、测量方法与退化信号", prompt: "记录成本来源、测量数据、预算或优化边界…" },
	{ id: "reference", label: "依据", mark: "↗", hint: "官方资料、源码入口与相关证据", prompt: "粘贴来源并说明它支持当前对象的哪项判断…" },
];

const CODE_CONTEXT: KnowledgeContext = {
	domain: "ue5_code",
	kicker: "CODE FACT ANNOTATIONS",
	title: "工程标注",
	objectName: "代码对象",
	collectionName: "整张代码图",
	sourceName: "源码",
	manualTrustLabel: "人工标注",
	summaryGuide: "记录代码风险、已有决策和最佳实践；标注不改变源码事实。",
	headerGuide: (nodeId) => `将阅读结论附着在 ${nodeId}，并通过源码哈希检测陈旧。`,
	emptyGuide: "第一条标注可以是最容易踩的坑、已确认的实现权衡，或维护时必须遵守的约束。",
	types: CODE_TYPES,
};

export function knowledgeContext(_domain: string): KnowledgeContext {
	return CODE_CONTEXT;
}
