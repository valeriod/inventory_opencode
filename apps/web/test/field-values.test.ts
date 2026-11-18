import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '@inventory/db';
import { fromFieldValue, isFilled, toFieldValue } from '../src/lib/field-values.js';

const numeric: FieldDefinition = {
	key: 'value',
	label: 'Value',
	type: 'number',
	required: true,
	unit: 'Ω',
};
const currency: FieldDefinition = { key: 'cost', label: 'Cost', type: 'currency' };
const int: FieldDefinition = { key: 'pins', label: 'Pins', type: 'integer' };
const bool: FieldDefinition = { key: 'active', label: 'Active', type: 'boolean' };
const text: FieldDefinition = { key: 'name', label: 'Name', type: 'string' };

describe('toFieldValue', () => {
	it('converts number/currency/integer inputs', () => {
		expect(toFieldValue(numeric, '10.5')).toBe(10.5);
		expect(toFieldValue(numeric, '')).toBeNull();
		expect(toFieldValue(currency, '0.25')).toBe(0.25);
		expect(toFieldValue(int, '3')).toBe(3);
		expect(toFieldValue(int, '3.7')).toBe(3);
	});

	it('keeps strings as strings, trimming nothing (API validates)', () => {
		expect(toFieldValue(text, 'abc')).toBe('abc');
		expect(toFieldValue(text, '')).toBeNull();
	});

	it('coerces booleans', () => {
		expect(toFieldValue(bool, true)).toBe(true);
		expect(toFieldValue(bool, false)).toBe(false);
	});
});

describe('fromFieldValue', () => {
	it('renders stored values as raw form values', () => {
		expect(fromFieldValue(numeric, 10.5)).toBe('10.5');
		expect(fromFieldValue(numeric, null)).toBe('');
		expect(fromFieldValue(bool, true)).toBe(true);
		expect(fromFieldValue(bool, undefined)).toBe(false);
	});
});

describe('isFilled', () => {
	it('detects empty vs provided values', () => {
		expect(isFilled(numeric, null)).toBe(false);
		expect(isFilled(text, '  ')).toBe(false);
		expect(isFilled(text, 'x')).toBe(true);
		expect(isFilled(numeric, 0)).toBe(true);
	});
});
