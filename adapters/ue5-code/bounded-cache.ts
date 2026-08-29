// Graph Brain / adapters/ue5-code - 常驻服务进程的有界缓存
//
// 增量/解析缓存是纯加速层：淘汰只损失一次重算，正确性不受影响。常驻服务
// （NSSM release server）里无界 Map 会随用户浏览的引擎类数量无限增长——
// soak 门禁只测浏览器端内存，测不到服务端这半边。

/** 插入序有界 Map：超容量淘汰最旧条目；读取命中会重新插入以近似 LRU。 */
export class BoundedCache<K, V> {
	private readonly map = new Map<K, V>();

	constructor(
		readonly capacity: number,
		private readonly onEvict?: (key: K) => void,
	) {
		if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error(`BoundedCache capacity 必须是正整数: ${capacity}`);
	}

	get(key: K): V | undefined {
		const value = this.map.get(key);
		if (value !== undefined) {
			this.map.delete(key);
			this.map.set(key, value);
		}
		return value;
	}

	set(key: K, value: V): void {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, value);
		while (this.map.size > this.capacity) {
			const oldest = this.map.keys().next().value as K | undefined;
			if (oldest === undefined) break;
			this.map.delete(oldest);
			this.onEvict?.(oldest);
		}
	}

	get size(): number {
		return this.map.size;
	}
}
