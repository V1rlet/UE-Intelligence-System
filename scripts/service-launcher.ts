// Graph Brain / service - manifest-aware production launcher used by NSSM and candidate checks.
// The versioned deployment state is the only owner of the active artifact identity.

import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { assertReleaseId, RELEASE_FORMAT_VERSION } from "../core/service/deployment-contract.js";
import { readDeploymentState, resolveDeploymentPaths, validatePublishedRelease } from "../core/service/deployment-store.js";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(process.env.GB_PROJECT_ROOT ?? SOURCE_ROOT);
const paths = resolveDeploymentPaths(ROOT);

function readPort(): number {
	const raw = process.env.GB_SERVICE_PORT ?? "3030";
	const port = Number(raw);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error(`GB_SERVICE_PORT 非法：${raw}`);
	return port;
}

const state = await readDeploymentState(paths.stateFile);
const releaseId = process.env.GB_SERVICE_RELEASE_OVERRIDE ?? state?.current_release;
if (!releaseId) throw new Error("deployment state 没有 current_release；请先运行 npm run service:prepare");
assertReleaseId(releaseId, "service release");
const { manifest, serverFile } = await validatePublishedRelease(paths.releaseRoot, releaseId, true);
if (manifest.format_version !== RELEASE_FORMAT_VERSION || !serverFile) {
	throw new Error(`${releaseId} 不是完整 v${RELEASE_FORMAT_VERSION} runtime release；请先运行 service:prepare`);
}
const port = readPort();
process.env.GB_PROJECT_ROOT = ROOT;
process.env.GB_SERVICE_PORT = String(port);
console.log(`[service-launcher] ${releaseId} @ http://127.0.0.1:${port}`);
await import(`${pathToFileURL(serverFile).href}?release=${encodeURIComponent(releaseId)}`);
