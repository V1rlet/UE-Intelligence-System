interface Props {
	page: number;
	pageCount: number;
	total: number;
	onPage: (page: number) => void;
	label?: string;
	compact?: boolean;
}

export default function SpecFunctionPager({ page, pageCount, total, onPage, label = "函数", compact = false }: Props) {
	if (pageCount <= 1) return null;
	if (compact) {
		return (
			<span className="spec-pager spec-pager-compact" aria-label={`${label}分页`}>
				<button title="上一页" aria-label={`${label}上一页`} disabled={page === 0} onClick={() => onPage(page - 1)}>◀</button>
				<b>{page + 1}/{pageCount}</b>
				<button title="下一页" aria-label={`${label}下一页`} disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>▶</button>
			</span>
		);
	}
	return (
		<span className="spec-pager" aria-label={`${label}分页`}>
			<button title="首页" disabled={page === 0} onClick={() => onPage(0)}>⏮</button>
			<button title="上一页" disabled={page === 0} onClick={() => onPage(page - 1)}>◀</button>
			<input
				key={page}
				type="number"
				min={1}
				max={pageCount}
				defaultValue={page + 1}
				title="输入页码后回车跳转"
				onKeyDown={(event) => {
					if (event.key !== "Enter") return;
					const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
					if (!Number.isNaN(value)) onPage(Math.min(Math.max(value, 1), pageCount) - 1);
				}}
			/>
			/{pageCount}（共 {total}）
			<button title="下一页" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>▶</button>
			<button title="尾页" disabled={page >= pageCount - 1} onClick={() => onPage(pageCount - 1)}>⏭</button>
		</span>
	);
}
