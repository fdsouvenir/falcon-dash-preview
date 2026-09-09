export class DomainError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.code = code;
		this.details = details;
	}
}
export function requireValue(test, code, message, details) {
	if (!test) throw new DomainError(code, message, details);
}
export function exact(value, keys) {
	requireValue(
		value && typeof value === 'object' && !Array.isArray(value),
		'invalid_input',
		'Expected an object'
	);
	requireValue(
		Object.keys(value).every((k) => keys.includes(k)),
		'unknown_field',
		'Unsupported field'
	);
}
export function text(value, max = 12000) {
	requireValue(
		typeof value === 'string' && value.trim().length > 0 && value.length <= max,
		'invalid_input',
		'Text is required and must fit its limit',
		{ max }
	);
	return value.trim();
}

export function timestamp(value) {
	requireValue(
		typeof value === 'string' &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
			Number.isFinite(Date.parse(value)),
		'invalid_input',
		'Use an explicit timezone-bearing timestamp'
	);
	return value;
}
