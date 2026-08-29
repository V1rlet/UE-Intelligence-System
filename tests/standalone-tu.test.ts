// B1/B2 回归：standalone 翻译单元消费 + Build.cs 模块依赖边。
// fixture Source 树：A.h+A.cpp（常规对）、Standalone.cpp（无同名 .h 的纯 C++ 类型）、
// Mod.Build.cs（PublicDependencyModuleNames）。
// 断言：coverage=complete 且 skipped=0；standalone 类型成为图节点；
// 模块级 depends_on 子图存在（stub 目标模块节点被自动创建）。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extractClassGraphWithCache } from "../adapters/ue5-code/extract-classes-lib.js";

function buildSourceTree(): string {
	const source = mkdtempSync(join(tmpdir(), "graphbrain-b1b2-source-"));
	const mod = join(source, "Mod");
	mkdirSync(mod, { recursive: true });
	writeFileSync(join(mod, "A.h"), `#pragma once
#include "CoreMinimal.h"
#include "A.generated.h"
UCLASS()
class MOD_API UA : public AActor {
	GENERATED_BODY()
};
`, "utf8");
	writeFileSync(join(mod, "A.cpp"), `#include "A.h"
UA::UA() { PrimaryActorTick.bCanEverTick = false; }
`, "utf8");
	writeFileSync(join(mod, "Standalone.cpp"), `#include "CoreMinimal.h"
struct FBStuff {
	int Count = 0;
};
class FBHelper {
public:
	void Run() {}
};
`, "utf8");
	writeFileSync(join(source, "Mod.Build.cs"), `using UnrealBuildTool;
public class Mod : ModuleRules {
	public Mod(ReadOnlyTargetRules Target) : base(Target) {
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject" });
		PrivateDependencyModuleNames.Add("Slate");
	}
}
`, "utf8");
	return source;
}

test("B1：无同名 .h 的 standalone .cpp 被消费，coverage 收敛为 complete", () => {
	const source = buildSourceTree();
	try {
		const { graph, cache, stats } = extractClassGraphWithCache([source], { subsystem: "project", withEngine: false });
		const coverage = graph.meta.coverage as { status: string; discovered_files: number; consumed_files: number; skipped_files: number };
		assert.equal(coverage.status, "complete", JSON.stringify(graph.meta.coverage));
		assert.equal(coverage.skipped_files, 0);
		assert.ok(stats.projectParsed >= 1, "至少一个 TU 被真实解析");
		void cache;
		const ids = new Set(graph.elements.nodes.map((node) => String(node.data.id)));
		assert.ok(ids.has("FBStuff") || [...ids].some((id) => id.includes("FBStuff")), `standalone 类型应入图：${[...ids].join(",")}`);
	} finally {
		rmSync(source, { recursive: true, force: true });
	}
});

test("B2：Build.cs 依赖生成模块级 depends_on 子图（stub 目标自动创建）", () => {
	const source = buildSourceTree();
	try {
		const { graph } = extractClassGraphWithCache([source], { subsystem: "project", withEngine: false });
		const nodes = new Map(graph.elements.nodes.map((node) => [String(node.data.id), node]));
		for (const expected of ["module:Mod", "module:Core", "module:CoreUObject", "module:Slate"]) {
			assert.ok(nodes.has(expected), `缺少模块节点 ${expected}`);
			assert.equal(nodes.get(expected)?.data.type, "module", expected);
		}
		const edgeIds = new Set(graph.elements.edges.map((edge) => String(edge.data.id)));
		for (const target of ["module:Core", "module:CoreUObject", "module:Slate"]) {
			assert.ok(edgeIds.has(`module:Mod--depends_on-->${target}`), `缺少模块依赖边 -> ${target}`);
		}
	} finally {
		rmSync(source, { recursive: true, force: true });
	}
});
