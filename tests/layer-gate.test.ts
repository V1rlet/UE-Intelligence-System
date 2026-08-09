// Graph Brain / R2 分层门禁测试：core 不得 import adapters 具体域实现。
// 直接驱动 scripts/layer-gate.ts 的核心审计函数 auditFiles（CLI 的 exit 语义是其薄包装）。

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ALLOWED_ADAPTER_MODULES, auditFiles } from "../scripts/layer-gate";

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-layer-gate-"));
	return root;
}

test("含具体 adapter 实现 import 的 core 文件报违规", () => {
	const root = fixture();
	try {
		const bad = join(root, "violation.ts");
		writeFileSync(
			bad,
			[
				'import { retiredAdapter } from "../adapters/retired-domain/adapter.js";',
				'import { ue5CodeMeta } from "../adapters/ue5-code/meta.js";',
			].join("\n"),
			"utf8",
		);
		const violations = auditFiles([bad]);
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
		const good = join(root, "clean.ts");
		writeFileSync(
			good,
			[
				'import type { GraphFile } from "../adapters/adapter-interface.js";',
				'import { diffGraphs } from "../adapters/diff-lib.js";',
				'import { domainCapabilities } from "../adapters/registry.js";',
			].join("\n"),
			"utf8",
		);
		assert.deepEqual(auditFiles([good]), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("跨行 import 与含注释的 import 也能被正确判定", () => {
	const root = fixture();
	try {
		const file = join(root, "multiline.ts");
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
		const violations = auditFiles([file]);
		assert.equal(violations.length, 1);
		assert.ok(violations[0].specifier.includes("retired-domain/adapter.js"));
		assert.equal(violations[0].line, 4);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("白名单只包含现存稳定边界", () => {
	assert.equal(ALLOWED_ADAPTER_MODULES.size, 3);
	for (const name of ["adapter-interface.js", "diff-lib.js", "registry.js"]) {
		assert.ok(ALLOWED_ADAPTER_MODULES.has(name), `缺少白名单 ${name}`);
	}
});

test("动态 import() 与副作用 import 形态的 adapter 依赖报违规", () => {
	const root = fixture();
	try {
		const bad = join(root, "nonfrom.ts");
		writeFileSync(
			bad,
			[
				'const adapter = await import("../adapters/retired-domain/adapter.js");',
				'import "../adapters/unknown-domain/adapter.js";',
			].join("\n"),
			"utf8",
		);
		const violations = auditFiles([bad]);
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
		const good = join(root, "nonfrom-clean.ts");
		writeFileSync(
			good,
			[
				'const registry = await import("../adapters/registry.js");',
				'import "../adapters/diff-lib.js";',
				'import type { GraphFile } from "../adapters/retired-domain/adapter.js";',
			].join("\n"),
			"utf8",
		);
		assert.deepEqual(auditFiles([good]), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
