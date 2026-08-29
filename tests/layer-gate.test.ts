// Graph Brain / R2 分层门禁测试：core 不得 import adapters 具体域实现。
// 直接驱动 scripts/layer-gate.ts 的核心审计函数 auditFiles（CLI 的 exit 语义是其薄包装）。

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ALLOWED_ADAPTER_BOUNDARIES, auditFiles } from "../scripts/layer-gate";

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-layer-gate-"));
	mkdirSync(join(root, "core"));
	return root;
}

test("含具体 adapter 实现 import 的 core 文件报违规", () => {
	const root = fixture();
	try {
		const bad = join(root, "core", "violation.ts");
		writeFileSync(
			bad,
			[
				'import { retiredAdapter } from "../adapters/retired-domain/adapter.js";',
				'import { ue5CodeMeta } from "../adapters/ue5-code/meta.js";',
			].join("\n"),
			"utf8",
		);
		const violations = auditFiles([bad], root);
		assert.equal(violations.length, 2);
		assert.ok(violations.every((v) => v.file === bad));
		assert.ok(violations.some((v) => v.specifier.includes("retired-domain/adapter.js")));
		assert.ok(violations.some((v) => v.specifier.includes("ue5-code/meta.js")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("type-only 导入与三个稳定边界模块不报违规", () => {
	const root = fixture();
	try {
		const good = join(root, "core", "clean.ts");
		writeFileSync(
			good,
			[
				'import type { GraphFile } from "../adapters/adapter-interface.js";',
				'import { diffGraphs } from "../adapters/diff-lib.js";',
				'import { domainCapabilities } from "../adapters/registry.js";',
			].join("\n"),
			"utf8",
		);
		assert.deepEqual(auditFiles([good], root), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("跨行 import 与含注释的 import 也能被正确判定", () => {
	const root = fixture();
	try {
		const file = join(root, "core", "multiline.ts");
		writeFileSync(
			file,
			[
				"import {",
				"	diffGraphs,",
				"} from \"../adapters/diff-lib.js\"; // 允许：共享 diff",
				"import {",
				"	retiredAdapter,",
				"} from \"../adapters/retired-domain/adapter.js\";",
			].join("\n"),
			"utf8",
		);
		const violations = auditFiles([file], root);
		assert.equal(violations.length, 1);
		assert.ok(violations[0].specifier.includes("retired-domain/adapter.js"));
		assert.equal(violations[0].line, 4);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("白名单只包含现存稳定边界", () => {
	assert.deepEqual([...ALLOWED_ADAPTER_BOUNDARIES].sort(), [
		"adapters/adapter-interface.js",
		"adapters/diff-lib.js",
		"adapters/registry.js",
	]);
	for (const name of ["adapters/adapter-interface.js", "adapters/diff-lib.js", "adapters/registry.js"]) {
		assert.ok(ALLOWED_ADAPTER_BOUNDARIES.has(name), `缺少精确边界 ${name}`);
	}
});

test("具体 Adapter 内的同名文件不能冒充稳定边界", () => {
	const root = fixture();
	try {
		const bad = join(root, "core", "fake-boundary.ts");
		writeFileSync(bad, 'import { registry } from "../adapters/ue5-code/registry.js";\n', "utf8");
		const violations = auditFiles([bad], root);
		assert.equal(violations.length, 1);
		assert.equal(violations[0].specifier, "../adapters/ue5-code/registry.js");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("动态 import() 与副作用 import 形态的 adapter 依赖报违规", () => {
	const root = fixture();
	try {
		const bad = join(root, "core", "nonfrom.ts");
		writeFileSync(
			bad,
			[
				'const adapter = await import("../adapters/retired-domain/adapter.js");',
				'import "../adapters/unknown-domain/adapter.js";',
			].join("\n"),
			"utf8",
		);
		const violations = auditFiles([bad], root);
		assert.equal(violations.length, 2);
		assert.ok(violations.some((v) => v.specifier.includes("retired-domain/adapter.js")));
		assert.ok(violations.some((v) => v.specifier.includes("unknown-domain/adapter.js")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("动态/副作用形态的白名单模块与 type-only 形态不误报", () => {
	const root = fixture();
	try {
		const good = join(root, "core", "nonfrom-clean.ts");
		writeFileSync(
			good,
			[
				'const registry = await import("../adapters/registry.js");',
				'import "../adapters/diff-lib.js";',
				'import type { GraphFile } from "../adapters/retired-domain/adapter.js";',
			].join("\n"),
			"utf8",
		);
		assert.deepEqual(auditFiles([good], root), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("正则引擎时代的三个假通过形态全部被 AST 引擎捕获", () => {
	const root = fixture();
	try {
		const bad = join(root, "core", "bypass.ts");
		writeFileSync(
			bad,
			[
				// 形态 1：副作用导入与 adapters 导入连写——正则懒匹配吞头后整段跳过
				'import "./side.js"; import { x } from "../adapters/ue5-impl.js";',
				// 形态 2：字符串字面量里的 "//" 被旧版当注释剥掉
				'const u = "http://x"; import { y } from "../adapters/impl2.js";',
				// 形态 3：反引号（无插值）动态 import 不匹配旧版的引号字符类
				'import(`../adapters/backtick.js`);',
			].join("\n"),
			"utf8",
		);
		const violations = auditFiles([bad], root);
		assert.equal(violations.length, 3);
		assert.ok(violations.some((v) => v.line === 1 && v.specifier.includes("ue5-impl.js")));
		assert.ok(violations.some((v) => v.line === 2 && v.specifier.includes("impl2.js")));
		assert.ok(violations.some((v) => v.line === 3 && v.specifier.includes("backtick.js")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("文件不可读时门禁 fail closed 而不是静默跳过", () => {
	const root = fixture();
	try {
		assert.throws(
			() => auditFiles([join(root, "core", "missing.ts")], root),
			/fail closed/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
