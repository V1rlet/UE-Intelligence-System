import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("toast pause resumes from remaining lifetime and every close path owns one exit timer", () => {
	const source = readFileSync(new URL("../viewer/components/common/Toast.tsx", import.meta.url), "utf8");
	assert.match(source, /remainingMs = useRef\(item\.duration\)/);
	assert.match(source, /remainingMs\.current - \(performance\.now\(\) - startedAt\)/);
	assert.match(source, /if \(leaveStarted\.current\) return/);
	assert.match(source, /window\.clearTimeout\(exitTimer\.current\)/);
	assert.match(source, /onClick=\{beginLeave\}/);
	assert.equal(source.match(/dismissToast\(item\.id\)/g)?.length, 1);
});
