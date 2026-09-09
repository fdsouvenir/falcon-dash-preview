// Gateway connection timestamps are Unix milliseconds, never inferred from strings.
export function formatOperatorTime(value, { locale, timeZone, missing = 'Not recorded' } = {}) {
	if (value == null) return missing;
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < 0 ||
		!Number.isFinite(new Date(value).getTime())
	)
		return 'Unknown (invalid timestamp)';
	const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	const formatter = new Intl.DateTimeFormat(locale, {
		timeZone: zone,
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		second: '2-digit',
		timeZoneName: 'short'
	});
	return `${formatter.format(new Date(value))} (${zone})`;
}
