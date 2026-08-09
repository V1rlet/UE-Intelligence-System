// UE 5.8 执行模型：依据本机 Engine/Source 中的线程创建、调度与同步边界整理。
// 重要：Chaos 以求解任务/阶段表达，不虚构一个始终存在的“Physics Thread”。

export interface ThreadSourceEvidence {
	path: string;
	symbol: string;
	line: number;
	claim: string;
}

interface ThreadNode {
	data: Record<string, unknown> & { id: string };
	position: { x: number; y: number };
}

interface ThreadEdge {
	data: Record<string, unknown> & { id: string; source: string; target: string; relation: string };
}

// 固定的是执行语义列，而不是一次偶然的力导向结果：加载/GT/任务池在控制列，
// Gameplay 子系统在回收列，Render→RHI→GPU 保持清晰的设备提交流。
const EXECUTION_POSITIONS: Record<string, { x: number; y: number }> = {
	"thread:async-loading": { x: 120, y: 105 },
	"thread:game": { x: 450, y: 105 },
	"scheduler:task-workers": { x: 780, y: 105 },
	"tasks:chaos": { x: 285, y: 330 },
	"thread:audio": { x: 580, y: 330 },
	"thread:render": { x: 875, y: 330 },
	"thread:rhi": { x: 1170, y: 330 },
	"device:gpu-queues": { x: 1170, y: 555 },
};

const EXECUTION_CAPTIONS: Record<string, string> = {
	"thread:async-loading": "Subsystem thread",
	"thread:game": "Named thread · frame owner",
	"scheduler:task-workers": "Worker pool",
	"tasks:chaos": "Solver phase / task events",
	"thread:audio": "Subsystem thread · optional",
	"thread:render": "Named thread · optional",
	"thread:rhi": "Named thread · optional",
	"device:gpu-queues": "Graphics / Compute / Copy",
};

function executionNode(
	id: string,
	label: string,
	executionKind: "named_thread" | "worker_pool" | "subsystem_thread" | "solver_tasks" | "device_queue",
	affinity: string,
	description: string,
	safetyBoundary: string,
	evidence: ThreadSourceEvidence[],
	optional = false,
): ThreadNode {
	return {
		position: EXECUTION_POSITIONS[id],
		data: {
			id,
			domain: "ue5_code",
			type: executionKind === "worker_pool" ? "scheduler" : "execution_lane",
			label,
			displayLabel: `${label}\n${EXECUTION_CAPTIONS[id] ?? affinity}`,
			description,
			layer: "engine",
			module: evidence[0]?.path.split("/")[1] ?? "Core",
			architectureNode: true,
			executionNode: true,
			executionKind,
			affinity,
			optional,
			safetyBoundary,
			sourceEvidence: evidence,
			source_path: evidence[0]?.path,
			width: 230,
			height: 92,
		},
	};
}

function handoff(id: string, source: string, target: string, relation: string, label: string): ThreadEdge {
	return { data: { id, domain: "ue5_code", source, target, relation, label, architectureEdge: true, executionEdge: true } };
}

export const UE5_THREAD_NODES: ThreadNode[] = [
	executionNode(
		"thread:game", "Game Thread", "named_thread", "ENamedThreads::GameThread",
		"帧循环与 UObject/World 玩法状态的主所有者；FEngineLoop::Tick 在此推进一帧。",
		"跨线程结果必须在明确同步点或投递回 Game Thread 后再触碰仅限 GT 的对象状态。",
		[
			{ path: "Runtime/Launch/Private/LaunchEngineLoop.cpp", symbol: "FEngineLoop::Tick", line: 5575, claim: "主帧循环入口" },
			{ path: "Runtime/Launch/Private/LaunchEngineLoop.cpp", symbol: "FTaskGraphInterface::AttachToThread", line: 2593, claim: "将启动线程附着为 GameThread" },
		],
	),
	executionNode(
		"scheduler:task-workers", "TaskGraph / LowLevelTasks", "worker_pool", "Worker pool",
		"命名线程之外的通用任务调度层；工作线程数量与调度器生命周期由 TaskGraph/LowLevelTasks 管理。",
		"任务必须显式声明先决条件和完成事件；等待链不能反向阻塞持有资源的命名线程。",
		[
			{ path: "Runtime/Core/Private/Async/TaskGraph.cpp", symbol: "FTaskGraphCompatibilityImplementation::Startup", line: 1776, claim: "TaskGraph 启动" },
			{ path: "Runtime/Core/Private/Async/TaskGraph.cpp", symbol: "LowLevelTasks::FScheduler::StartWorkers", line: 1359, claim: "工作线程池启动" },
		],
	),
	executionNode(
		"thread:render", "Render Thread", "named_thread", "ENamedThreads::ActualRenderingThread",
		"消费 Game Thread 入队的渲染命令与帧快照；未启用线程化渲染时可折叠回 Game Thread。",
		"GT 只提交稳定的帧数据；等待 Render Thread 时禁止形成 Render→Game 的循环等待。",
		[
			{ path: "Runtime/RenderCore/Public/RenderingThread.h", symbol: "GUseThreadedRendering", line: 69, claim: "线程化渲染为运行配置" },
			{ path: "Runtime/Core/Public/Async/TaskGraphInterfaces.h", symbol: "ActualRenderingThread", line: 63, claim: "渲染命名线程枚举" },
		], true,
	),
	executionNode(
		"thread:rhi", "RHI Thread", "named_thread", "ENamedThreads::RHIThread",
		"从渲染命令流进一步派发 RHI 工作；是否独立运行由平台与运行配置决定。",
		"CPU 资源生命周期必须覆盖 RHI 命令消费；需要完成语义时使用 fence/flush，而非隐式假定已提交。",
		[
			{ path: "Runtime/Core/Public/Async/TaskGraphInterfaces.h", symbol: "RHIThread", line: 59, claim: "RHI 命名线程枚举" },
			{ path: "Runtime/RHI/Public/RHICommandList.h", symbol: "FRHICommandListExecutor", line: 5047, claim: "RHI 命令执行与同步入口" },
		], true,
	),
	executionNode(
		"thread:async-loading", "Async Loading Thread 2", "subsystem_thread", "FAsyncLoadingThread2",
		"异步解析包、导入与依赖；已加载包在 Game Thread 阶段归并并触发完成回调。",
		"后台加载不能越过 UObject 发布边界；完成回调与可见状态在 Game Thread 处理路径收束。",
		[
			{ path: "Runtime/CoreUObject/Private/Serialization/AsyncLoading2.cpp", symbol: "FAsyncLoadingThread2::Run", line: 11356, claim: "异步加载线程主循环" },
			{ path: "Runtime/CoreUObject/Private/Serialization/AsyncLoading2.cpp", symbol: "ProcessLoadedPackagesFromGameThread", line: 10728, claim: "已加载包回归 Game Thread" },
		],
	),
	executionNode(
		"tasks:chaos", "Chaos Physics Tasks", "solver_tasks", "Solver phase / task events",
		"物理场景通过任务事件推进求解、派发与回收；它是可并行的阶段管线，不等同于一个永久 Physics Thread。",
		"外部线程写入经命令/代理进入求解器；玩法读取结果前必须等待 pending task 或经过同步阶段。",
		[
			{ path: "Runtime/PhysicsCore/Private/ChaosScene.cpp", symbol: "FChaosScene::AdvanceAndDispatch_External", line: 379, claim: "推进并派发求解任务" },
			{ path: "Runtime/PhysicsCore/Private/ChaosScene.cpp", symbol: "FChaosScene::WaitOnPendingTasks_External", line: 174, claim: "等待物理待定任务" },
		],
	),
	executionNode(
		"thread:audio", "Audio Thread", "subsystem_thread", "Audio command thread",
		"消费音频命令并维护音频子系统状态；可按运行配置启停，并提供回投 Game Thread 的命令路径。",
		"UObject/GC 边界需要暂停或回归 Game Thread；音频命令不能捕获生命周期不受控的对象引用。",
		[
			{ path: "Runtime/Engine/Private/AudioThread.cpp", symbol: "RunCommandOnAudioThread", line: 494, claim: "投递到音频线程" },
			{ path: "Runtime/Engine/Private/AudioThread.cpp", symbol: "StartAudioThread", line: 629, claim: "按配置启动音频线程" },
		], true,
	),
	executionNode(
		"device:gpu-queues", "GPU Queues", "device_queue", "Graphics / Compute / Copy",
		"RHI 命令最终到达设备队列执行；这是 CPU 线程之外的异步执行目标。",
		"资源转换、队列依赖和 fence 决定可见性；CPU 提交完成不代表 GPU 已执行完成。",
		[
			{ path: "Runtime/RHI/Public/RHICommandList.h", symbol: "ImmediateFlush(DispatchToRHIThread)", line: 4780, claim: "命令派发语义" },
		],
	),
];

export const UE5_THREAD_EDGES: ThreadEdge[] = [
	handoff("gt-dispatch-workers", "thread:game", "scheduler:task-workers", "dispatches_to", "派发并行任务"),
	handoff("workers-sync-gt", "scheduler:task-workers", "thread:game", "synchronizes_with", "先决条件 / 完成事件"),
	handoff("gt-enqueue-render", "thread:game", "thread:render", "enqueues_to", "入队渲染命令"),
	handoff("render-dispatch-rhi", "thread:render", "thread:rhi", "dispatches_to", "派发 RHI 命令"),
	handoff("rhi-submit-gpu", "thread:rhi", "device:gpu-queues", "submits_to", "提交设备队列"),
	handoff("loading-complete-gt", "thread:async-loading", "thread:game", "completes_on", "归并包与完成回调"),
	handoff("gt-dispatch-chaos", "thread:game", "tasks:chaos", "dispatches_to", "推进物理阶段"),
	handoff("chaos-sync-gt", "tasks:chaos", "thread:game", "synchronizes_with", "等待 / 回收结果"),
	handoff("gt-enqueue-audio", "thread:game", "thread:audio", "enqueues_to", "投递音频命令"),
	handoff("audio-complete-gt", "thread:audio", "thread:game", "completes_on", "回投游戏线程"),
];
