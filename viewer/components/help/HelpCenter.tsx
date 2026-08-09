import { useEffect, useMemo, useState } from "react";
import AppIcon from "../common/AppIcon";
import { useDialogFocus } from "../common/useDialogFocus";
import { shortcutHelpGroups } from "../../src/shortcutCatalog";
import styles from "./HelpCenter.module.css";

export type HelpSection = "current" | "workflow" | "shortcuts";

interface Props {
	initialSection: HelpSection;
	view: string;
	onClose: () => void;
}

function currentHelp(view: string) {
	if (view === "architecture") return {
		label: "代码架构总览",
		title: "从系统职责钻取到真实类型",
		summary: "架构图由 ue5_code 事实生成，只用于定位模块、关系和源码证据，不在 GraphBrain 内创作方案。",
		steps: ["双击系统进入下一层", "选择类型查看职责与来源", "打开类详情核对成员和函数"],
	};
	if (view === "api") return {
		label: "项目与 UE API",
		title: "核对真实签名与实现边界",
		summary: "项目函数和 UE 引擎源码共用一个只读索引；收藏与标注只增加阅读上下文，不改变代码事实。",
		steps: ["搜索类、函数或模块", "核对参数、返回值和源码位置", "按需收藏或写标注"],
	};
	if (view === "graph") return {
		label: "代码关系图",
		title: "沿源码结构查看类型与关系",
		summary: "文件树、类结构和关系边都来自 ue5_code；GraphBrain 不保存设计意图、规划状态或交付状态。",
		steps: ["搜索或选择文件", "双击类型打开类结构", "用标注记录观察，不改写事实"],
	};
	return {
		label: "代码事实首页",
		title: "选择一种代码阅读视角",
		summary: "GraphBrain 只负责代码架构查看。方案创作、关卡设计、实现规划和交付由 ClaudeGameStudios 负责。",
		steps: ["架构总览用于理解职责", "代码工作区用于切换项目与引擎来源", "API 视图用于核对签名"],
	};
}

const FLOW = [
	"从 UE 项目源码提取版本化 ue5_code 事实",
	"在架构总览或代码图中定位模块与类型",
	"用源码证据和 API 索引核对实现",
	"用标注记录观察；规划工作返回 ClaudeGameStudios",
];

export default function HelpCenter({ initialSection, view, onClose }: Props) {
	const dialogRef = useDialogFocus<HTMLElement>();
	const [section, setSection] = useState<HelpSection>(initialSection);
	const [query, setQuery] = useState("");
	const context = useMemo(() => currentHelp(view), [view]);
	const shortcuts = useMemo(() => shortcutHelpGroups(view), [view]);
	const results = useMemo(() => {
		const all = [
			{ section: "current" as const, title: context.title, detail: context.summary },
			...context.steps.map((detail) => ({ section: "current" as const, title: context.label, detail })),
			...FLOW.map((detail) => ({ section: "workflow" as const, title: "只读代码事实流", detail })),
			...shortcuts.flatMap((group) => group.items.map((item) => ({ section: "shortcuts" as const, title: `${group.title} · ${item.keys.join("+")}`, detail: item.description }))),
		];
		const normalized = query.trim().toLocaleLowerCase();
		return normalized ? all.filter((item) => `${item.title} ${item.detail}`.toLocaleLowerCase().includes(normalized)).slice(0, 24) : [];
	}, [context, query, shortcuts]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	return <div className={styles.centerMask} onClick={onClose}>
		<section ref={dialogRef} className={styles.center} role="dialog" aria-modal="true" aria-label="帮助中心" onClick={(event) => event.stopPropagation()}>
			<header className={styles.head}><span className={styles.mark}><AppIcon name="library" size={19} /></span><div><small>只读代码架构查看器</small><h2>帮助中心</h2></div><button type="button" className={styles.close} onClick={onClose} aria-label="关闭帮助中心（Esc）">✕</button></header>
			<label className={styles.search}><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索视图、流程或快捷键…" aria-label="搜索帮助内容" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="清空帮助搜索">×</button> : null}</label>
			<nav className={styles.tabs} role="tablist" aria-label="帮助内容">
				<button type="button" role="tab" aria-selected={section === "current"} className={section === "current" ? styles.active : ""} onClick={() => setSection("current")}>当前页面</button>
				<button type="button" role="tab" aria-selected={section === "workflow"} className={section === "workflow" ? styles.active : ""} onClick={() => setSection("workflow")}>事实流</button>
				<button type="button" role="tab" aria-selected={section === "shortcuts"} className={section === "shortcuts" ? styles.active : ""} onClick={() => setSection("shortcuts")}>快捷键</button>
			</nav>
			<div className={styles.body} role="tabpanel">
				{query.trim() ? <div className={styles.searchResults} aria-live="polite"><p>{results.length ? `找到 ${results.length} 条帮助` : "没有匹配的帮助内容"}</p>{results.map((item, index) => <button key={`${item.section}:${index}:${item.detail}`} type="button" onClick={() => { setSection(item.section); setQuery(""); }}><small>{item.section === "current" ? "当前页面" : item.section === "workflow" ? "事实流" : "快捷键"}</small><strong>{item.title}</strong><span>{item.detail}</span></button>)}</div> : null}
				{!query.trim() && section === "current" ? <div className={styles.current}><p className={styles.contextLabel}>{context.label}</p><h3>{context.title}</h3><p className={styles.contextSummary}>{context.summary}</p><ol className={styles.nextSteps}>{context.steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol><div className={styles.principle}><AppIcon name="review" size={17} /><p><b>代码事实唯一归属</b><span>图、类详情、API 与标注都通过稳定 ID 指向同一份 ue5_code 事实。</span></p></div></div> : null}
				{!query.trim() && section === "workflow" ? <div className={styles.workflows}><p className={styles.sectionIntro}>GraphBrain 的边界到“读懂代码事实”为止。</p><section className={styles.workflowCard}><header><AppIcon name="graph" size={18} /><h3>只读代码事实流</h3></header><ol>{FLOW.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol></section><p className={styles.sharedNote}><b>职责边界：</b>ClaudeGameStudios 拥有架构方案、关卡设计、编码规划、评审和交付；GraphBrain 不复制这些状态。</p></div> : null}
				{!query.trim() && section === "shortcuts" ? <div className={styles.shortcuts}><p className={styles.sectionIntro}>只显示只读查看器的实际操作。</p>{shortcuts.map((group) => <section key={group.id}><h3>{group.title}</h3><ul>{group.items.map((item) => <li key={`${group.id}:${item.keys.join("+")}`}><span>{item.keys.map((key) => <kbd key={key}>{key}</kbd>)}</span><p>{item.description}</p></li>)}</ul></section>)}</div> : null}
			</div>
			<footer className={styles.foot}><span><kbd>?</kbd> 快捷键</span><span><kbd>Esc</kbd> 关闭</span></footer>
		</section>
	</div>;
}
