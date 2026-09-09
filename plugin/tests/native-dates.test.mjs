import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatOperatorTime } from '../native/dates.mjs';

test('operator timestamps include calendar date, time and explicit local timezone across DST', () => {
	const options = { locale: 'en-US', timeZone: 'America/Chicago' };
	const summer = formatOperatorTime(Date.UTC(2026, 8, 6, 17, 0), options);
	assert.match(summer, /Sep 6, 2026/);
	assert.match(summer, /12:00:00 PM/);
	assert.match(summer, /CDT.*America\/Chicago/);
	assert.match(formatOperatorTime(Date.UTC(2026, 0, 6, 18, 0), options), /CST.*America\/Chicago/);
	assert.match(formatOperatorTime(0, { locale: 'en-US', timeZone: 'UTC' }), /1970.*UTC/);
});
test('missing and invalid timestamps remain distinct without coercion or fabricated dates', () => {
	for (const value of [null, undefined]) assert.equal(formatOperatorTime(value), 'Not recorded');
	assert.equal(formatOperatorTime(null, { missing: 'Not scheduled' }), 'Not scheduled');
	for (const value of ['', '1788714483520', false, {}, NaN, Infinity, 1e30, -1])
		assert.equal(formatOperatorTime(value), 'Unknown (invalid timestamp)');
});
