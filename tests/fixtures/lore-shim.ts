// V2/V6 共用设施：编译最小 lore CLI 替身（Windows 下 spawn 无 shell，必须是真 .exe），
// 并提供 head 签名 / 修订 delta 的文件式驱动接口。替身行为：
//   history 1                → 读 <repo>/head.txt 输出 Signature/Revision
//   revision info <sig> ...  → 读 <repo>/revisions/<sig>.txt 原样输出（Parent: 行 + A 清单行）
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CSC_PATH = "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe";
const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HELPER_DIR, "..", "..");

const LORE_SHIM_CS = `
using System;
using System.IO;
class LoreShim {
	static int Main(string[] args) {
		int repoAt = Array.IndexOf(args, "--repository");
		string repo = args[repoAt + 1];
		int p = Array.IndexOf(args, "-P");
		string rest = string.Join(" ", args, p + 1, args.Length - p - 1);
		string head = File.ReadAllText(Path.Combine(repo, "head.txt")).Trim();
		if (rest == "history 1") {
			Console.Out.WriteLine("Signature: " + head);
			Console.Out.WriteLine("Revision: 7");
			return 0;
		}
		if (rest.StartsWith("revision info ")) {
			string sig = rest.Substring("revision info ".Length).Replace("--delta", "").Trim();
			string revFile = Path.Combine(repo, "revisions", sig + ".txt");
			if (!File.Exists(revFile)) return 3;
			foreach (string line in File.ReadAllLines(revFile)) Console.Out.WriteLine(line);
			return 0;
		}
		return 2;
	}
}
`;

/** 替身 runner：记录调用 argv 到 RUNNER_MARKER，按 RUNNER_EXIT_CODE 退出，
 *  可选 RUNNER_DELAY_MS 模拟慢提取（V6 事件循环不冻结证明）。 */
export const RUNNER_MJS = `
import { appendFileSync } from "node:fs";
const marker = process.env.RUNNER_MARKER;
if (marker) appendFileSync(marker, JSON.stringify({ argv: process.argv.slice(2) }) + "\\n", "utf8");
const delay = Number(process.env.RUNNER_DELAY_MS ?? "0");
if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
process.exitCode = Number(process.env.RUNNER_EXIT_CODE ?? "0");
`;

export interface LoreFixture {
	dir: string;
	repoDir: string;
	shimExe: string;
	runnerPath: string;
	configPath: string;
	statePath: string;
	markerPath: string;
	setHead(sig: string): void;
	writeRevision(sig: string, parent: string, files: string[]): void;
	dispose(): void;
}

let compiledShimPath: string | null = null;

function compileShimOnce(): string {
	if (compiledShimPath && existsSync(compiledShimPath)) return compiledShimPath;
	if (!existsSync(CSC_PATH)) throw new Error(`需要 csc.exe 编译 lore 替身（未找到：${CSC_PATH}）`);
	const scratch = mkdtempSync(join(tmpdir(), "graphbrain-lore-shim-"));
	const cs = join(scratch, "LoreShim.cs");
	const exe = join(scratch, "lore-shim.exe");
	writeFileSync(cs, LORE_SHIM_CS, "utf8");
	execFileSync(CSC_PATH, ["/nologo", `/out:${exe}`, cs]);
	compiledShimPath = exe;
	return exe;
}

export function buildLoreFixture(prefix = "graphbrain-lore-fixture-"): LoreFixture {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	const repoDir = join(dir, "repo");
	mkdirSync(join(repoDir, "revisions"), { recursive: true });
	const shimExe = compileShimOnce();
	// runTsxAsync 以 baseRoot/node_modules/tsx 为 CLI 锚点：junction 到真仓库安装。
	const tsxLink = join(dir, "node_modules", "tsx");
	mkdirSync(join(dir, "node_modules"), { recursive: true });
	symlinkSync(resolve(REPO_ROOT, "node_modules", "tsx"), tsxLink, "junction");
	const runnerPath = join(dir, "runner.mjs");
	writeFileSync(runnerPath, RUNNER_MJS, "utf8");
	const configPath = join(dir, "hook-projects.json");
	const statePath = join(dir, "lore-watch-state.json");
	const markerPath = join(dir, "runner-calls.jsonl");

	return {
		dir,
		repoDir,
		shimExe,
		runnerPath,
		configPath,
		statePath,
		markerPath,
		setHead(sig) {
			writeFileSync(join(repoDir, "head.txt"), sig, "utf8");
		},
		writeRevision(sig, parent, files) {
			writeFileSync(join(repoDir, "revisions", `${sig}.txt`), `Parent: ${parent}\n${files.map((file) => `A ${file}`).join("\n")}\n`, "utf8");
		},
		dispose() {
			rmSync(tsxLink, { force: true });
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

export function registerLoreProject(fixture: LoreFixture): void {
	writeFileSync(fixture.configPath, JSON.stringify({
		projects: [{ name: "Fixture", root: fixture.repoDir, vcs: "lore" }],
		lore_exe: fixture.shimExe,
	}), "utf8");
}
