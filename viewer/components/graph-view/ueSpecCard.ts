// Graph Brain / viewer - UE5 编码规范卡片：按规范类交互图的组织思路渲染类节点 SVG
// 三分区：持有对象区（[C]组件等小盒）/ 调度协调函数区 / 数据资产区（[D] 小盒）；
// 继承/接口/生命周期保持为图上外部边（对应规范的继承列/接口/生命周期条）。

export interface SpecCardInput {
	id: string;
	tags?: string[];
	held: string[]; // 持有对象区条目（含 [C] 前缀）
	functions: { name: string; bp: boolean; override: boolean }[];
	assets: string[]; // 数据资产区条目（含 [D] 前缀）
}

const SANS = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif";
const MONO = "Consolas,Monaco,monospace";

// 色值已迁入 viewer/src/design-tokens.ts（单一事实源）
import { SPEC_CARD_COLORS } from "../../src/design-tokens";

const COLORS = SPEC_CARD_COLORS;

function esc(s: unknown): string {
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 按内容估算卡片尺寸并生成 SVG data URI；返回 {svg, width, height} */
export function buildUeSpecCardSvg(input: SpecCardInput): { svg: string; width: number; height: number } {
	const titleText = input.id + (input.tags?.includes("abstract") ? "  «abstract»" : "");
	const fnLines = input.functions.map(
		(f) => `${f.bp ? "ⓑ " : "  "}${f.name}${f.override ? " (override)" : ""}`,
	);
	const zones: { label: string; items: string[]; boxed: boolean }[] = [];
	if (input.held.length) zones.push({ label: "持有对象区", items: input.held, boxed: true });
	if (fnLines.length) zones.push({ label: "调度函数区", items: fnLines, boxed: false });
	if (input.assets.length) zones.push({ label: "数据资产区", items: input.assets, boxed: true });

	const allLines = [titleText, ...zones.flatMap((z) => z.items)];
	const width = Math.max(200, Math.min(380, Math.max(...allLines.map((l) => l.length)) * 7.2 + 40));

	const TITLE_H = 30;
	const ZONE_HEAD_H = 16;
	const ITEM_H = 20;
	const ZONE_PAD = 6;
	let height = TITLE_H + 8;
	for (const z of zones) height += 4 + ZONE_HEAD_H + z.items.length * ITEM_H + ZONE_PAD;
	height = Math.max(56, height);

	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
	// 规范的双线大框 → 外框 + 内描线
	svg += `<rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="6" fill="${COLORS.bg}" stroke="${COLORS.border}" stroke-width="2"/>`;
	svg += `<rect x="5" y="5" width="${width - 10}" height="${height - 10}" rx="4" fill="none" stroke="${COLORS.border}" stroke-width="0.6" opacity="0.5"/>`;

	let y = 10;
	svg += `<text x="${width / 2}" y="${y + 14}" text-anchor="middle" font-size="13px" font-weight="700" fill="${COLORS.title}" font-family="${SANS}">${esc(titleText)}</text>`;
	y += TITLE_H;

	for (const zone of zones) {
		// 分区分隔带（对应规范的 ██ 分割线）
		svg += `<rect x="6" y="${y}" width="${width - 12}" height="3" fill="${COLORS.zoneBand}"/>`;
		y += 4;
		svg += `<text x="12" y="${y + 11}" font-size="9px" fill="${COLORS.zoneLabel}" font-family="${SANS}">[${esc(zone.label)}]</text>`;
		y += ZONE_HEAD_H;
		for (const item of zone.items) {
			if (zone.boxed) {
				// ┏━┓ 小盒 → 圆角小框
				const boxW = Math.min(width - 24, item.length * 6.6 + 16);
				svg += `<rect x="12" y="${y + 1}" width="${boxW}" height="${ITEM_H - 4}" rx="3" fill="${COLORS.itemBox}" stroke="${COLORS.itemBorder}" stroke-width="1"/>`;
				svg += `<text x="20" y="${y + 13}" font-size="10px" fill="${COLORS.item}" font-family="${MONO}">${esc(item)}</text>`;
			} else {
				const isBp = item.startsWith("ⓑ");
				svg += `<text x="16" y="${y + 13}" font-size="10px" fill="${isBp ? COLORS.bp : COLORS.item}" font-family="${MONO}">${esc(item)}</text>`;
			}
			y += ITEM_H;
		}
		y += ZONE_PAD;
	}

	svg += "</svg>";
	return {
		svg: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
		width,
		height,
	};
}
