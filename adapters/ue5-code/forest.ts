// Graph Brain / adapters/ue5-code - 文件森林构建 + 模块名定位（extract-classes 与
// engine-class-service 共用；P3U1 抽出）

import { readdirSync } from "node:fs";
import { basename, dirname } from "node:path";

export interface AnyNode {
	data: Record<string, unknown> & { id: string; metrics: { in_degree: number; out_degree: number } };
}
export interface AnyEdge {
	data: {
		id: string; source: string; target: string; relation: string; domain: string;
		weight?: number; description?: string; order?: number;
	};
}

/** 向上找最近的 *.Build.cs 目录名作为模块名 */
export function findModuleName(headerPath: string, stopAt: string): string {
	let dir = dirname(headerPath);
	while (dir.length >= stopAt.length) {
		const buildCs = readdirSync(dir).find((f) => f.endsWith(".Build.cs"));
		if (buildCs) return basename(buildCs).replace(/\.Build\.cs$/i, "");
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return "Unknown";
}

// ████████████████████████████████████████████████████████████████████████████
//  森林构建（项目子树 / 引擎子树共用）
// ████████████████████████████████████████████████████████████████████████████

export class ForestBuilder {
	nodes: AnyNode[] = [];
	edges: AnyEdge[] = [];
	private dirSeen = new Set<string>();

	constructor(private rootLabel: string) {
		this.nodes.push(this.makeFolder(`dir:${rootLabel}`, rootLabel));
		this.dirSeen.add(`dir:${rootLabel}`);
	}

	private makeFolder(id: string, label: string): AnyNode {
		return {
			data: {
				id, label, type: "folder", layer: "project", domain: "ue5_code",
				visibility: "explored", metrics: { in_degree: 0, out_degree: 0 },
			},
		};
	}

	addFile(relPath: string, extra: Record<string, unknown>): void {
		const relNoExt = relPath.replace(/\.h$/i, "");
		const dirs = relNoExt.split("/").slice(0, -1);
		let parentId = `dir:${this.rootLabel}`;
		let acc = "";
		for (const d of dirs) {
			acc = acc ? `${acc}/${d}` : d;
			const dirId = `dir:${this.rootLabel}/${acc}`;
			if (!this.dirSeen.has(dirId)) {
				this.dirSeen.add(dirId);
				this.nodes.push(this.makeFolder(dirId, d));
				this.edges.push({
					data: { id: `${parentId}--contains-->${dirId}`, source: parentId, target: dirId, relation: "contains", domain: "ue5_code" },
				});
			}
			parentId = dirId;
		}
		const fileId = `file:${this.rootLabel}/${relNoExt}`;
		this.nodes.push({
			data: {
				id: fileId, label: basename(relNoExt), type: "file", layer: "project",
				domain: "ue5_code", source_path: relPath, visibility: "explored",
				...extra,
				metrics: { in_degree: 0, out_degree: 0 },
			},
		});
		this.edges.push({
			data: { id: `${parentId}--contains-->${fileId}`, source: parentId, target: fileId, relation: "contains", domain: "ue5_code" },
		});
	}
}
