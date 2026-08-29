import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessEvidenceAccess } from "../core/evidence/status.js";
import { readEvidenceStatus, refreshRegisteredEvidence } from "../server/evidence.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const argv = process.argv.slice(2);
const command = argv[0] ?? "status";

function option(name: string): string | null {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

if (command === "status") {
	const status = readEvidenceStatus(DATA_DIR);
	console.log(JSON.stringify({ ...status, consumer_gate: assessEvidenceAccess(status) }, null, 2));
} else if (command === "check") {
	const status = readEvidenceStatus(DATA_DIR);
	const decision = assessEvidenceAccess(status, !argv.includes("--allow-nonfresh"));
	console.log(JSON.stringify({ status, consumer_gate: decision }, null, 2));
	if (!decision.allowed) process.exitCode = 3;
} else if (command === "refresh") {
	const result = await refreshRegisteredEvidence({
		root: ROOT,
		project: option("--project"),
		onEvent: (message) => console.log(message),
	});
	const status = readEvidenceStatus(DATA_DIR);
	console.log(JSON.stringify({ refresh: result, evidence_status: status, consumer_gate: assessEvidenceAccess(status) }, null, 2));
	if (result.status !== "refreshed") process.exitCode = result.status === "busy" ? 4 : 1;
} else {
	console.error("usage: npm run evidence -- <status|check|refresh> [--project <registered-name>] [--allow-nonfresh]");
	process.exitCode = 2;
}
