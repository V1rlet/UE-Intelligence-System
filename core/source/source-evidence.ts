// Node-only source inventory and deterministic content fingerprinting.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
	SOURCE_FINGERPRINT_ALGORITHM,
	type CoverageDiagnostic,
	type SourceFingerprint,
} from "../schema/graph-version.js";

const SOURCE_SUFFIXES = [".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".inl", ".ipp", ".build.cs"];

export interface DiscoveredSourceFile {
	absolute_path: string;
	relative_path: string;
	root_index: number;
}

export interface SourceInventory {
	roots: string[];
	files: DiscoveredSourceFile[];
	diagnostics: CoverageDiagnostic[];
}

export interface SourceSnapshot extends SourceInventory {
	fingerprint: SourceFingerprint | null;
}

export function isSourceInput(path: string): boolean {
	const lower = path.toLowerCase();
	return SOURCE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function canonicalPath(path: string): string {
	return resolve(path).replaceAll("\\", "/");
}

export function discoverSourceInputs(sourceRoots: string[]): SourceInventory {
	const roots = [...new Set(sourceRoots.map(canonicalPath))].sort((a, b) => a.localeCompare(b));
	const diagnostics: CoverageDiagnostic[] = [];
	const byAbsolutePath = new Map<string, DiscoveredSourceFile>();
	for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
		const root = roots[rootIndex];
		const pending = [root];
		while (pending.length > 0) {
			const directory = pending.pop()!;
			let entries;
			try {
				entries = readdirSync(directory, { withFileTypes: true });
			} catch (error) {
				diagnostics.push({ code: directory === root ? "source-root-unreadable" : "source-directory-unreadable", path: directory, message: String(error) });
				continue;
			}
			for (const entry of entries) {
				const absolutePath = canonicalPath(`${directory}/${entry.name}`);
				if (entry.isDirectory()) {
					pending.push(absolutePath);
					continue;
				}
				if (!entry.isFile() || !isSourceInput(entry.name) || byAbsolutePath.has(absolutePath)) continue;
				byAbsolutePath.set(absolutePath, {
					absolute_path: absolutePath,
					relative_path: relative(root, absolutePath).replaceAll("\\", "/"),
					root_index: rootIndex,
				});
			}
		}
	}
	const files = [...byAbsolutePath.values()].sort((a, b) =>
		a.root_index - b.root_index || a.relative_path.localeCompare(b.relative_path));
	return { roots, files, diagnostics };
}

export function fingerprintSourceInventory(inventory: SourceInventory): SourceSnapshot {
	const diagnostics = [...inventory.diagnostics];
	const aggregate = createHash("sha256");
	aggregate.update(`${SOURCE_FINGERPRINT_ALGORITHM}\0`);
	for (const file of inventory.files) {
		try {
			const contentHash = createHash("sha256").update(readFileSync(file.absolute_path)).digest("hex");
			aggregate.update(`${file.root_index}:${file.relative_path}\0${contentHash}\0`);
		} catch (error) {
			diagnostics.push({ code: "source-file-unreadable", path: file.absolute_path, message: String(error) });
		}
	}
	const failed = diagnostics.some((item) => item.code.endsWith("unreadable"));
	return {
		...inventory,
		diagnostics,
		fingerprint: failed ? null : {
			algorithm: SOURCE_FINGERPRINT_ALGORITHM,
			value: aggregate.digest("hex"),
			file_count: inventory.files.length,
		},
	};
}

export function buildSourceSnapshot(sourceRoots: string[]): SourceSnapshot {
	return fingerprintSourceInventory(discoverSourceInputs(sourceRoots));
}
