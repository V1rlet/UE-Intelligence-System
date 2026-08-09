import { useEffect, useRef, useState } from "react";
import { VIEWPORT_POLICY } from "./viewportPolicy";

interface Props {
	zoomPct: number;
	onChange: (zoomPct: number) => void;
}

function clampPercent(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export default function ViewportZoomControl({ zoomPct, onChange }: Props) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [draft, setDraft] = useState(String(zoomPct));
	const hardMin = Math.round(VIEWPORT_POLICY.hardMinZoom * 100);
	const hardMax = Math.round(VIEWPORT_POLICY.hardMaxZoom * 100);
	const sliderMin = Math.round(VIEWPORT_POLICY.sliderMinZoom * 100);
	const sliderMax = Math.round(VIEWPORT_POLICY.sliderMaxZoom * 100);

	useEffect(() => {
		if (document.activeElement !== inputRef.current) setDraft(String(zoomPct));
	}, [zoomPct]);

	const commit = (raw = draft) => {
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) {
			setDraft(String(zoomPct));
			return;
		}
		const next = Math.round(clampPercent(parsed, hardMin, hardMax));
		setDraft(String(next));
		onChange(next);
	};

	return (
		<div className="viewport-zoom-control" role="group" aria-label="缩放比例" data-zoom-pct={zoomPct}>
			<input
				className="zoom-slider"
				type="range"
				min={sliderMin}
				max={sliderMax}
				step={5}
				value={clampPercent(zoomPct, sliderMin, sliderMax)}
				aria-label="缩放滑杆"
				title={`常用缩放范围 ${sliderMin}%–${sliderMax}%`}
				onChange={(event) => onChange(Number(event.currentTarget.value))}
			/>
			<label className="zoom-number" title={`可精确输入 ${hardMin}%–${hardMax}%`}>
				<input
					ref={inputRef}
					type="number"
					min={hardMin}
					max={hardMax}
					step={1}
					value={draft}
					aria-label="精确缩放百分比"
					onChange={(event) => setDraft(event.currentTarget.value)}
					onBlur={(event) => commit(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commit(event.currentTarget.value);
							event.currentTarget.blur();
						} else if (event.key === "Escape") {
							event.preventDefault();
							setDraft(String(zoomPct));
							event.currentTarget.blur();
						}
					}}
				/>
				<span aria-hidden="true">%</span>
			</label>
		</div>
	);
}
