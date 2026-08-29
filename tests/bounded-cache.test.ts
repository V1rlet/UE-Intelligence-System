// Graph Brain / adapters/ue5-code - 常驻服务有界缓存的淘汰语义。
import assert from "node:assert/strict";
import test from "node:test";
import { BoundedCache } from "../adapters/ue5-code/bounded-cache.js";

test("BoundedCache evicts the oldest entry beyond capacity and refreshes recency on read", () => {
	const cache = new BoundedCache<string, number>(2);
	cache.set("a", 1);
	cache.set("b", 2);
	assert.equal(cache.get("a"), 1, "容量内不得淘汰");
	cache.set("c", 3);
	assert.equal(cache.get("b"), undefined, "超出容量淘汰最旧条目");
	assert.equal(cache.get("a"), 1);
	assert.equal(cache.get("c"), 3);
	// 读取刷新新近度：a 变为最旧后，再插入应淘汰 a 而不是 c。
	cache.set("d", 4);
	assert.equal(cache.get("a"), undefined);
	assert.equal(cache.get("c"), 3);
	assert.equal(cache.get("d"), 4);
	assert.equal(cache.size, 2);
});

test("BoundedCache reports evictions and rejects invalid capacity", () => {
	const evicted: string[] = [];
	const cache = new BoundedCache<string, number>(1, (key) => evicted.push(key));
	cache.set("a", 1);
	cache.set("b", 2);
	assert.deepEqual(evicted, ["a"]);
	assert.throws(() => new BoundedCache<string, number>(0), /capacity/);
});
