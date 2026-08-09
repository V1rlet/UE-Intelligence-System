// Graph Brain / viewer - UE 蓝图风格节点 SVG：Spec 页专用视觉
// 映射关系：生命周期步骤=事件节点（红标题+exec 引脚）/ 函数=函数节点（蓝标题+BP 徽章）/
// 持有组件=对象引用（蓝数据引脚）/ 数据资产=资产引用（青数据引脚）/ 委托=红方引脚 /
// 接口=银青标题 / 继承链=石板灰 / 类枢纽=琥珀标题（品牌色，即"本蓝图"）
// 颜色令牌全部来自 viewer/src/design-tokens.ts（单一事实源），本文件不声明色值。

import { BP_BADGE, BP_KIND_STYLE, BP_PIN_COLOR, SVG_INK } from "../../src/design-tokens";

export type BpKind =
	| "event"
	| "function"
	| "object"
	| "asset"
	| "interface"
	| "delegate"
	| "class"
	| "enum"
	| "hub";

export interface BpNodeInput {
	title: string;
	subtitle?: string;
	kind: BpKind;
	/** BlueprintCallable/BlueprintPure 徽章 */
	bp?: boolean;
	execIn?: boolean;
	execOut?: boolean;
}

const SANS = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif";
const MONO = "Consolas,Monaco,monospace";

/** 标题条渐变（上→下）+ 标题图标，取 UE 蓝图节点的语义色 */
const KIND_STYLE = BP_KIND_STYLE as Record<BpKind, { top: string; bottom: string; icon: string }>;

/** 数据引脚颜色（与标题语义同族） */
const PIN_COLOR = BP_PIN_COLOR;

function esc(s: unknown): string {
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** exec 引脚（UE 五边形箭头），(x,y) 为左上角 */
function execPin(x: number, y: number): string {
	return `<path d="M${x},${y} h5.5 l4.5,4.5 -4.5,4.5 h-5.5 z" fill="#dfe6ee" stroke="${SVG_INK.dark}" stroke-width="0.8"/>`;
}

/** 数据引脚：圆（对象/资产/接口）或方（委托，UE 委托引脚为方形） */
function dataPin(x: number, y: number, kind: BpKind): string {
	const c = PIN_COLOR[kind] ?? SVG_INK.muted;
	if (kind === "delegate") {
		return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" fill="${c}" stroke="${SVG_INK.dark}" stroke-width="0.8"/>`;
	}
	return `<circle cx="${x}" cy="${y}" r="4.2" fill="${c}" stroke="${SVG_INK.dark}" stroke-width="0.8"/>`;
}

/** 生成蓝图风格节点 SVG data URI 及尺寸；结果直接挂到节点 data（bpSvg/width/height） */
export function buildBpNodeSvg(input: BpNodeInput): { bpSvg: string; width: number; height: number } {
	const hub = input.kind === "hub";
	const ks = KIND_STYLE[input.kind];
	const TITLE_H = hub ? 24 : 20;
	const H = hub ? 48 : 40;
	const titlePx = hub ? 12.5 : 11;
	const W = Math.max(
		hub ? 190 : 148,
		Math.min(
			hub ? 340 : 300,
			Math.max(
				input.title.length * (titlePx * 0.62) + 66,
				(input.subtitle?.length ?? 0) * 5.8 + 60,
			),
		),
	);
	const bodyY = TITLE_H;
	const pinY = bodyY + (H - bodyY) / 2;

	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
	svg += `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ks.top}"/><stop offset="1" stop-color="${ks.bottom}"/></linearGradient></defs>`;
	// 节点体（暗色圆角）+ 顶部标题条（用下半遮盖法保留仅顶角圆角）
	svg += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${SVG_INK.bpBody}" stroke="${SVG_INK.bpEdge}" stroke-width="1"/>`;
	svg += `<rect x="0.5" y="0.5" width="${W - 1}" height="${TITLE_H + 6}" rx="6" fill="url(#g)"/>`;
	svg += `<rect x="0.5" y="${TITLE_H}" width="${W - 1}" height="${H - TITLE_H - 0.5}" rx="6" fill="${SVG_INK.bpBody}"/>`;
	svg += `<rect x="0.5" y="${TITLE_H}" width="${W - 1}" height="6" fill="${SVG_INK.bpBody}"/>`;
	// 标题条高光发丝线
	svg += `<line x1="2" y1="1.5" x2="${W - 2}" y2="1.5" stroke="#ffffff" stroke-opacity="0.14"/>`;
	// 标题图标 + 标题
	svg += `<text x="9" y="${TITLE_H / 2 + 4.5}" font-size="${hub ? 12 : 10.5}px" fill="#f4f7fa" opacity="0.9" font-family="${SANS}">${ks.icon}</text>`;
	svg += `<text x="25" y="${TITLE_H / 2 + 4.5}" font-size="${titlePx}px" font-weight="700" fill="${SVG_INK.bpTitle}" font-family="${SANS}">${esc(input.title)}</text>`;
	// BP 徽章（标题条右端）
	if (input.bp) {
		svg += `<rect x="${W - 30}" y="${TITLE_H / 2 - 6.5}" width="22" height="13" rx="3" fill="${BP_BADGE.fill}" fill-opacity="0.22" stroke="${BP_BADGE.fill}" stroke-width="0.8"/>`;
		svg += `<text x="${W - 19}" y="${TITLE_H / 2 + 3.5}" text-anchor="middle" font-size="8px" font-weight="700" fill="${BP_BADGE.text}" font-family="${SANS}">BP</text>`;
	}
	// 引脚层：exec（白色五边形）在函数/事件节点两侧；数据引脚在被引用物件左侧
	if (input.execIn) svg += execPin(7, pinY - 4.5);
	if (input.execOut) svg += execPin(W - 17, pinY - 4.5);
	if (PIN_COLOR[input.kind]) svg += dataPin(10, pinY, input.kind);
	// 副标题
	if (input.subtitle) {
		const subX = input.execIn || PIN_COLOR[input.kind] ? 22 : 12;
		svg += `<text x="${subX}" y="${pinY + 3.5}" font-size="9px" fill="${SVG_INK.muted}" font-family="${MONO}">${esc(input.subtitle)}</text>`;
	}
	svg += "</svg>";

	return {
		bpSvg: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
		width: W,
		height: H,
	};
}
