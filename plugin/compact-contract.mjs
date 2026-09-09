// Lossless structural interning. JSON Pointer references are local to this public artifact.
export function compactContract(source) {
	const plain = JSON.parse(JSON.stringify(source)),
		counts = new Map(),
		ids = new Map(),
		defs = {};
	function count(value) {
		if (Array.isArray(value)) {
			value.forEach(count);
			return;
		}
		if (!value || typeof value !== 'object') return;
		const key = JSON.stringify(value);
		counts.set(key, (counts.get(key) ?? 0) + 1);
		Object.values(value).forEach(count);
	}
	count(plain);
	function encode(value, inline = null) {
		if (Array.isArray(value)) return value.map((v) => encode(v));
		if (!value || typeof value !== 'object') return value;
		const key = JSON.stringify(value),
			n = counts.get(key) ?? 0;
		if (key !== inline && (n - 1) * key.length > n * 32 + 16) {
			if (!ids.has(key)) {
				const id = `s${ids.size}`;
				ids.set(key, id);
				defs[id] = encode(value, key);
			}
			return { $ref: `#/$defs/${ids.get(key)}` };
		}
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
	}
	const result = encode(plain);
	return Object.keys(defs).length ? { ...result, $defs: defs } : result;
}
export function expandContract(compact) {
	function expand(value) {
		if (Array.isArray(value)) return value.map(expand);
		if (!value || typeof value !== 'object') return value;
		if (
			Object.keys(value).length === 1 &&
			typeof value.$ref === 'string' &&
			value.$ref.startsWith('#/$defs/')
		)
			return expand(compact.$defs[value.$ref.slice(8)]);
		return Object.fromEntries(
			Object.entries(value)
				.filter(([k]) => k !== '$defs')
				.map(([k, v]) => [k, expand(v)])
		);
	}
	return expand(compact);
}
