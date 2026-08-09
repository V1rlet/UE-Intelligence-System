// Graph Brain / adapters/ue5-code - Actor 生命周期链：lifecycle_step 节点 + lifecycle_sequence 边
//
// 数据驱动：步骤表按 UE Actor 实际执行顺序排列（order = 数组下标）。
// 项目类覆写链上函数时，由 extract-classes.ts 生成 ufunction → lifecycle_step 的 overrides 边。

export interface LifecycleStep {
	name: string;
	description: string;
}

/** UE Actor 生命周期（按执行顺序） */
export const ACTOR_LIFECYCLE_STEPS: LifecycleStep[] = [
	{ name: "PostInitProperties", description: "属性初始化完成后调用；CDO 构造阶段也会触发，此时 World 可能尚未就绪" },
	{ name: "OnConstruction", description: "构造脚本执行点；编辑器中拖动/修改属性会反复触发" },
	{ name: "PreInitializeComponents", description: "组件 InitializeComponent 之前的准备点" },
	{ name: "PostInitializeComponents", description: "全部组件初始化完毕；访问组件的最早安全时机" },
	{ name: "BeginPlay", description: "游戏开始/Actor 生成完成；gameplay 逻辑的常规起点" },
	{ name: "Tick", description: "每帧调用（bCanEverTick）；可事件化的逻辑不要放这里" },
	{ name: "EndPlay", description: "Actor 移除/关卡卸载/游戏结束时调用，做清理" },
];

export function lifecycleStepId(name: string): string {
	return `lifecycle:${name}`;
}

const STEP_NAMES = new Set(ACTOR_LIFECYCLE_STEPS.map((s) => s.name));

/** 判断函数名是否为生命周期链上的步骤 */
export function isLifecycleStep(functionName: string): boolean {
	return STEP_NAMES.has(functionName);
}

/** 生成生命周期链的节点与顺序边（Cytoscape 元素，符合 GraphBrain schema） */
export function buildLifecycleElements() {
	const nodes = ACTOR_LIFECYCLE_STEPS.map((step) => ({
		data: {
			id: lifecycleStepId(step.name),
			label: step.name,
			type: "lifecycle_step",
			layer: "engine" as const,
			module: "Engine",
			domain: "ue5_code",
			description: step.description,
			visibility: "explored" as const,
			metrics: { in_degree: 0, out_degree: 0 },
		},
	}));

	const edges = ACTOR_LIFECYCLE_STEPS.slice(0, -1).map((step, i) => {
		const next = ACTOR_LIFECYCLE_STEPS[i + 1];
		return {
			data: {
				id: `${lifecycleStepId(step.name)}--lifecycle_sequence-->${lifecycleStepId(next.name)}`,
				source: lifecycleStepId(step.name),
				target: lifecycleStepId(next.name),
				relation: "lifecycle_sequence",
				domain: "ue5_code",
				order: i,
			},
		};
	});

	return { nodes, edges };
}
