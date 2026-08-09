// Graph Brain / viewer - 图谱文件加载统一入口
// 全站图谱消费者（App 主图 / 嵌入页 / 工作区快照 / 架构脑图 / 跨域辅助）
// 各自裸调 apiFetchJson(`/data/graphs/${file}`) 的历史收敛：统一 URL 构造、静默失败
// 语义（notify:false）与 AbortSignal 透传；结构校验语义因消费方而异，留在各自调用点。
import { apiFetchJson } from "./apiFetch";

export async function loadGraphFile<T = unknown>(
	file: string,
	options?: { signal?: AbortSignal; context?: string },
): Promise<T> {
	return apiFetchJson<T>(
		`/data/graphs/${encodeURIComponent(file)}`,
		options?.signal ? { signal: options.signal } : undefined,
		{ notify: false, context: options?.context ?? "图谱加载" },
	);
}
