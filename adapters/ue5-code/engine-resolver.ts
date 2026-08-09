// Graph Brain / adapters/ue5-code - 引擎源码解析器：按需定位并解析引擎 .h（替代种子链）
//
// 范围：Engine/Source/{Runtime,Developer,Editor} + Engine/Plugins 下公开头文件；
// 与 Epic 5.8 API 首页的四级目录一致。
//
// DECISION: 类 → 头文件用"文件名 = 去前缀类名.h"启发式 + 内容验证，而非全文扫描
// REASON: Runtime 有上万个头文件，全文扫描太慢；UE 约定文件与主类同名（去 A/U 前缀），
//         命中后再用 `class *_API <类名>` 验证消歧，准确且索引一次即可。
// DATE: 2026-07-02

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ueHeaderStemForType } from "../../core/schema/ue-naming.js";
import { parseHeader, type ParsedClass } from "./header-parser.js";

/** 从 .uproject 的 EngineAssociation 推导本机引擎根目录 */
export function engineRootFromUproject(uprojectPath: string): string | null {
	try {
		const raw = JSON.parse(readFileSync(uprojectPath, "utf-8").replace(/^﻿/, "")) as { EngineAssociation?: string };
		const ver = raw.EngineAssociation;
		if (!ver) return null;
		const candidates = [`G:/Epic Games/UE_${ver}`, `D:/Epic Game/Unreal Engine/UE_${ver}`];
		for (const c of candidates) {
			if (existsSync(join(c, "Engine", "Source", "Runtime"))) return c;
		}
	} catch { /* 解析失败按未命中处理 */ }
	return null;
}

/** 在项目根目录（Source 的上级）里找 .uproject */
export function findUproject(sourceDir: string): string | null {
	const projectRoot = dirname(sourceDir);
	try {
		const up = readdirSync(projectRoot).find((f) => f.endsWith(".uproject"));
		return up ? join(projectRoot, up) : null;
	} catch {
		return null;
	}
}

export class EngineResolver {
	private index: Map<string, string[]> | null = null;
	private parsedFiles = new Map<string, ParsedClass[]>();
	readonly engineSourceRoot: string;
	readonly engineRoot: string;

	constructor(engineRoot: string) {
		this.engineRoot = engineRoot;
		this.engineSourceRoot = join(engineRoot, "Engine", "Source");
	}

	private buildIndex(): Map<string, string[]> {
		if (this.index) return this.index;
		const started = Date.now();
		const index = new Map<string, string[]>();
		const walk = (dir: string) => {
			let entries;
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const p = join(dir, entry.name);
				if (entry.isDirectory()) {
					if (/^(Private|Intermediate|Binaries|Content)$/i.test(entry.name)) continue;
					walk(p);
				}
				else if (entry.name.endsWith(".h")) {
					const key = entry.name.toLowerCase();
					const list = index.get(key) ?? [];
					list.push(p);
					index.set(key, list);
				}
			}
		};
		for (const scope of ["Runtime", "Developer", "Editor"]) walk(join(this.engineSourceRoot, scope));
		walk(join(this.engineRoot, "Engine", "Plugins"));
		console.log(`引擎头文件索引: ${index.size} 个文件名（${((Date.now() - started) / 1000).toFixed(1)}s）`);
		this.index = index;
		return index;
	}

	/** 定位声明了指定类的引擎头文件（找不到返回 null） */
	resolveHeaderPath(className: string, sourcePath?: string): string | null {
		const index = this.buildIndex();
		const deprecatedPrefix = className.match(/^[AUI]DEPRECATED_(.+)$/);
		const stem = deprecatedPrefix?.[1] ?? ueHeaderStemForType(className);
		const candidates = index.get(`${stem.toLowerCase()}.h`) ?? [];
		const escapedName = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const declRe = new RegExp(
			String.raw`\b(?:class|struct|enum\s+(?:class\s+)?)\s+` +
			String.raw`(?:(?:\w+_API)\s+|(?:UE_DEPRECATED(?:_FORGAME)?\s*\([^)]*\))\s+)*` +
			`${escapedName}\\s*[:{\\s]`,
		);
		// UE 老式命名空间枚举：名字跟在 namespace 后（`namespace EXxx { enum Type }`），
		// 不加这条，EDrawDebugTrace 等类型头文件定位永远失败 → 按需解析"未命中"、Spec 空
		const nsEnumRe = new RegExp(String.raw`\bnamespace\s+${escapedName}\s*\{[^{}]{0,300}\benum\b`);
		const declaresClass = (text: string) => declRe.test(text) || nsEnumRe.test(text);
		if (sourcePath) {
			// source_path 有两种相对根：按需解析服务写 Engine/ 相对（"Source/Runtime/..."），
			// 项目图提取写 Engine/Source/ 相对（"Runtime/..." 或 "../Plugins/..."）——两种都接受。
			const engineDir = resolve(this.engineRoot, "Engine");
			for (const base of [engineDir, this.engineSourceRoot]) {
				const exactCandidate = resolve(base, sourcePath);
				const relativeCandidate = relative(engineDir, exactCandidate);
				if (
					relativeCandidate.startsWith("..") ||
					isAbsolute(relativeCandidate) ||
					!exactCandidate.endsWith(".h") ||
					!existsSync(exactCandidate)
				) continue;
				try {
					if (declaresClass(readFileSync(exactCandidate, "utf-8"))) return exactCandidate;
				} catch { /* 精确路径读取失败后继续使用文件名索引 */ }
			}
		}
		for (const candidate of candidates) {
			try {
				if (declaresClass(readFileSync(candidate, "utf-8"))) return candidate;
			} catch { /* 读失败换下一个候选 */ }
		}
		return null;
	}

	/** 解析引擎类（文件级缓存）；返回该类的 ParsedClass 与头文件路径 */
	resolveClass(className: string, sourcePath?: string): { cls: ParsedClass; headerPath: string } | null {
		const headerPath = this.resolveHeaderPath(className, sourcePath);
		if (!headerPath) return null;
		let classes = this.parsedFiles.get(headerPath);
		if (!classes) {
			// API Spec 对反射类型与普通 F/E/I/S/C++ 类型一视同仁：同一解析模型、同一主视图。
			classes = parseHeader(headerPath, this.engineSourceRoot, { includePlainCpp: true });
			this.parsedFiles.set(headerPath, classes);
		}
		const cls = classes.find((c) => c.name === className);
		return cls ? { cls, headerPath } : null;
	}
}
