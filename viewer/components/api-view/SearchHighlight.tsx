// Graph Brain / viewer - API 搜索关键词高亮（左导航 / 中列表共用）
export default function SearchHighlight({ text, query }: { text: string; query: string }) {
	const needle = query.trim();
	if (!needle) return <>{text}</>;
	const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
	if (index < 0) return <>{text}</>;
	return (
		<>
			{text.slice(0, index)}
			<mark className="api-search-match">{text.slice(index, index + needle.length)}</mark>
			{text.slice(index + needle.length)}
		</>
	);
}
