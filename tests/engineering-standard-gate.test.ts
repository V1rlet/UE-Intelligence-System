import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { auditEngineeringFiles, reconcileExceptions, validateExceptionRegistry, type EngineeringException, type ExceptionRegistry } from "../scripts/engineering-standard-gate";

function fixture(): string {
	return mkdtempSync(join(tmpdir(), "graphbrain-engineering-standard-"));
}

function validException(overrides: Partial<EngineeringException> = {}): EngineeringException {
	return {
		id: "temporary-third-party-type-gap",
		rule: "TYPE-001",
		path: "core/example.ts",
		line: 1,
		owner: "maintainer",
		reason: "第三方声明尚未提供可验证的 unknown 边界",
		tracking_issue: "GB-123",
		approved_on: "2026-08-01",
		expires_on: "2026-09-01",
		...overrides,
	};
}

test("AST 只报告真实显式 any，不误报字符串和 unknown", () => {
	const root = fixture();
	try {
		const core = join(root, "core");
		mkdirSync(core);
		const file = join(core, "example.ts");
		writeFileSync(file, 'const text = "value: any";\nlet unsafe: any;\nlet safe: unknown;\n', "utf8");
		const violations = auditEngineeringFiles([file], root);
		assert.deepEqual(violations.map(({ rule, line }) => ({ rule, line })), [{ rule: "TYPE-001", line: 2 }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("TypeScript 压制指令独立归入 TYPE-002", () => {
	const root = fixture();
	try {
		const file = join(root, "suppressed.ts");
		const directive = ["@ts", "expect-error"].join("-");
		writeFileSync(file, `// ${directive}\nconst value: string = 1;\n`, "utf8");
		const violations = auditEngineeringFiles([file], root);
		assert.equal(violations.length, 1);
		assert.equal(violations[0].rule, "TYPE-002");
		assert.equal(violations[0].line, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("有效例外必须精确命中同一规则、文件和行", () => {
	const root = fixture();
	try {
		const core = join(root, "core");
		mkdirSync(core);
		const file = join(core, "example.ts");
		writeFileSync(file, "let unsafe: any;\n", "utf8");
		const violations = auditEngineeringFiles([file], root);
		const raw: ExceptionRegistry = { format_version: 1, exceptions: [validException()] };
		const validated = validateExceptionRegistry(raw, root, "2026-08-13");
		assert.deepEqual(validated.errors, []);
		assert.ok(validated.registry);
		assert.deepEqual(reconcileExceptions(violations, validated.registry).unsuppressed, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("过期、越界路径和未知规则 fail closed", () => {
	const root = fixture();
	try {
		const result = validateExceptionRegistry({
			format_version: 1,
			exceptions: [validException({ rule: "UNKNOWN" as "TYPE-001", path: "../escape.ts", expires_on: "2026-08-12" })],
		}, root, "2026-08-13");
		assert.ok(result.errors.some((error) => error.includes("不是可豁免")));
		assert.ok(result.errors.some((error) => error.includes("仓库内相对路径")));
		assert.ok(result.errors.some((error) => error.includes("已过期")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("违规已修复后，陈旧例外必须删除", () => {
	const registry: ExceptionRegistry = { format_version: 1, exceptions: [validException()] };
	const result = reconcileExceptions([], registry);
	assert.equal(result.errors.length, 1);
	assert.match(result.errors[0], /陈旧例外/);
});

