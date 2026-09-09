import { requireValue, text } from '../errors.mjs';
const filler = new Set([
	'todo',
	'tbd',
	'n a',
	'none',
	'unknown',
	'pending',
	'done',
	'complete',
	'completed',
	'task',
	'work',
	'works',
	'it works',
	'same as above',
	'as above'
]);
const normalize = (value) =>
	value
		.toLowerCase()
		.replace(/[\p{P}\p{S}\s]+/gu, ' ')
		.trim();
export function definition(input) {
	const value = {
		title: text(input.title, 240),
		description: text(input.description),
		done_when: text(input.done_when)
	};
	const normalized = Object.values(value).map(normalize);
	requireValue(
		new Set(normalized).size === 3 && !normalized.some((v) => filler.has(v)),
		'invalid_definition',
		'Definition fields need distinct substantive content, not filler or repetitions'
	);
	return value;
}
