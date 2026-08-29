import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { nextListboxOptionIndex } from "./listboxNavigation";

export interface HierarchySelectOption {
	value: string;
	label: string;
	group?: string;
	description?: string;
	meta?: string;
}

interface Props {
	value: string;
	options: HierarchySelectOption[];
	onChange: (value: string) => void;
	label: string;
	eyebrow?: string;
	className?: string;
	compact?: boolean;
	searchable?: boolean;
	searchPlaceholder?: string;
	panelMinWidth?: number;
}

interface PanelPosition {
	left: number;
	width: number;
	maxHeight: number;
	top?: number;
	bottom?: number;
}

/** 只负责分组展示和选择交互；选项事实及选中值仍由调用方唯一持有。 */
export default function HierarchySelect({
	value,
	options,
	onChange,
	label,
	eyebrow = "当前选择",
	className = "",
	compact = false,
	searchable = false,
	searchPlaceholder = "筛选选项…",
	panelMinWidth = 300,
}: Props) {
	const id = useId();
	const panelId = `hierarchy-select-${id}`;
	const listboxId = `${panelId}-listbox`;
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const [position, setPosition] = useState<PanelPosition | null>(null);
	// 闭合态的当前值必须呈现事实：value 非空但不在选项里（目录刷新移除了当前文档）
	// 时显示"不在列表"而不是冒充第一项——展开列表里并没有选中它。
	const exact = options.find((option) => option.value === value);
	const selected = exact ?? options[0];
	const valueMissing = !exact && value.trim() !== "";

	const groupTones = useMemo(() => {
		const tones = new Map<string, number>();
		for (const option of options) {
			if (option.group && !tones.has(option.group)) tones.set(option.group, tones.size % 4);
		}
		return tones;
	}, [options]);

	const visibleOptions = useMemo(() => {
		const token = query.trim().toLocaleLowerCase("zh-CN");
		if (!token) return options;
		return options.filter((option) => `${option.label} ${option.group ?? ""} ${option.description ?? ""}`.toLocaleLowerCase("zh-CN").includes(token));
	}, [options, query]);

	const visibleIndexes = useMemo(() => new Map(visibleOptions.map((option, index) => [option, index])), [visibleOptions]);
	const groups = useMemo(() => {
		const result: { name: string | null; options: HierarchySelectOption[] }[] = [];
		const byName = new Map<string, HierarchySelectOption[]>();
		const standalone: HierarchySelectOption[] = [];
		for (const option of visibleOptions) {
			if (!option.group) {
				standalone.push(option);
				continue;
			}
			const group = byName.get(option.group) ?? [];
			group.push(option);
			byName.set(option.group, group);
		}
		if (standalone.length) result.push({ name: null, options: standalone });
		for (const [name, groupedOptions] of byName) result.push({ name, options: groupedOptions });
		return result;
	}, [visibleOptions]);

	const updatePosition = useCallback(() => {
		const trigger = triggerRef.current;
		if (!trigger) return;
		const rect = trigger.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const width = Math.min(viewportWidth - 16, Math.max(rect.width, panelMinWidth));
		const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
		const roomBelow = viewportHeight - rect.bottom - 8;
		const roomAbove = rect.top - 8;
		const openAbove = roomBelow < 220 && roomAbove > roomBelow;
		const maxHeight = Math.max(150, Math.min(420, (openAbove ? roomAbove : roomBelow) - 8));
		setPosition(openAbove
			? { left, width, maxHeight, bottom: viewportHeight - rect.top + 6 }
			: { left, width, maxHeight, top: rect.bottom + 6 });
	}, [panelMinWidth]);

	const close = useCallback((restoreFocus = false) => {
		setOpen(false);
		setQuery("");
		setPosition(null);
		if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
	}, []);

	const choose = (option: HierarchySelectOption) => {
		if (option.value !== value) onChange(option.value);
		close(true);
	};

	const openPanel = () => {
		setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
		setOpen(true);
	};

	useLayoutEffect(() => {
		if (open) updatePosition();
	}, [open, updatePosition]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
		};
		const onFocusIn = (event: FocusEvent) => {
			const target = event.target as Node;
			if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				close(true);
			}
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("focusin", onFocusIn);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("focusin", onFocusIn);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [close, open, updatePosition]);

	useEffect(() => {
		if (!open) return;
		const selectedVisibleIndex = visibleOptions.findIndex((option) => option.value === value);
		setActiveIndex(Math.max(0, selectedVisibleIndex));
		requestAnimationFrame(() => {
			if (searchable) searchRef.current?.focus();
			else panelRef.current?.querySelector<HTMLElement>("[data-active='true']")?.focus();
		});
	}, [open, searchable, value, visibleOptions]);

	useEffect(() => {
		if (activeIndex >= visibleOptions.length) setActiveIndex(Math.max(0, visibleOptions.length - 1));
	}, [activeIndex, visibleOptions.length]);

	const onListKeyDown = (event: ReactKeyboardEvent) => {
		if (!visibleOptions.length) return;
		const isSearchInput = event.target === searchRef.current;
		if (event.key === "Enter") {
			event.preventDefault();
			choose(visibleOptions[activeIndex]);
			return;
		}
		if (isSearchInput && (event.key === "Home" || event.key === "End")) return;
		const next = nextListboxOptionIndex(activeIndex, visibleOptions.length, event.key);
		if (next === null) return;
		event.preventDefault();
		setActiveIndex(next);
		requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(`[data-option-index='${next}']`)?.focus());
	};

	const panelStyle = position ? {
		left: position.left,
		width: position.width,
		top: position.top,
		bottom: position.bottom,
		"--hierarchy-panel-max-height": `${position.maxHeight}px`,
	} as CSSProperties : undefined;

	return <div className={`hierarchy-select${compact ? " is-compact" : ""}${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
		<button
			ref={triggerRef}
			type="button"
			className="hierarchy-select-trigger"
			role="combobox"
			aria-label={label}
			aria-haspopup="listbox"
			aria-expanded={open}
			aria-controls={open ? listboxId : undefined}
			onClick={() => open ? close() : openPanel()}
			onKeyDown={(event) => {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					openPanel();
				}
			}}
		>
			<span className="hierarchy-select-marker" aria-hidden="true" />
			<span className="hierarchy-select-value"><small>{eyebrow}</small><b>{valueMissing ? "当前选择不在列表中" : selected?.label ?? "未选择"}</b></span>
			{selected?.meta ? <span className="hierarchy-select-meta">{selected.meta}</span> : null}
			<i className="hierarchy-select-chevron" aria-hidden="true" />
		</button>

		{open && position ? createPortal(
			<div ref={panelRef} id={panelId} className={`hierarchy-select-panel${compact ? " is-compact" : ""}`} data-app-shortcuts="block" style={panelStyle} onKeyDown={onListKeyDown}>
				<header className="hierarchy-select-panel-head">
					<span><small>分层选择</small><b>{label}</b></span>
					<em aria-live="polite" aria-atomic="true">{visibleOptions.length} 项</em>
				</header>
				{searchable ? <label className="hierarchy-select-search">
					<span aria-hidden="true">⌕</span>
					<input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} aria-controls={listboxId} />
					{query ? <button type="button" aria-label="清除筛选" onClick={() => setQuery("")}>×</button> : null}
				</label> : null}
				<div id={listboxId} className="hierarchy-select-list" role="listbox" aria-label={label}>
					{groups.map((group) => {
						const tone = group.name ? (groupTones.get(group.name) ?? 0) : 0;
						return <section key={group.name ?? "__standalone"} className={`hierarchy-option-group${group.name ? "" : " is-root"}`} role="group" aria-label={group.name ?? "通用选项"} data-tone={tone}>
							{group.name ? <header><span aria-hidden="true" /><b>{group.name}</b><small>{group.options.length}</small></header> : null}
							{group.options.map((option, groupIndex) => {
								const optionIndex = visibleIndexes.get(option) ?? 0;
								const isSelected = option.value === value;
								return <button
									key={`${option.group ?? "root"}:${option.value}`}
									id={`${panelId}-option-${optionIndex}`}
									type="button"
									role="option"
									aria-selected={isSelected}
									tabIndex={activeIndex === optionIndex ? 0 : -1}
									className={`hierarchy-option${isSelected ? " is-selected" : ""}`}
									data-active={activeIndex === optionIndex}
									data-option-index={optionIndex}
									data-last={groupIndex === group.options.length - 1}
									onFocus={() => setActiveIndex(optionIndex)}
									onClick={() => choose(option)}
								>
									{group.name ? <span className="hierarchy-option-branch" aria-hidden="true" /> : <span className="hierarchy-option-root-mark" aria-hidden="true" />}
									<span className="hierarchy-option-copy"><b>{option.label}</b>{option.description ? <small>{option.description}</small> : null}</span>
									{option.meta ? <em>{option.meta}</em> : null}
									<span className="hierarchy-option-check" aria-hidden="true">✓</span>
								</button>;
							})}
						</section>;
					})}
					{visibleOptions.length === 0 ? <p className="hierarchy-select-empty" role="status">没有匹配选项</p> : null}
				</div>
			</div>,
			document.body,
		) : null}
	</div>;
}
