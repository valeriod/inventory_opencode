import type { FieldDefinition } from '@inventory/db';

/** Convert a raw form value (from an input element) into the stored field value. */
export function toFieldValue(field: FieldDefinition, raw: string | boolean): unknown {
	switch (field.type) {
		case 'number':
		case 'currency':
			return raw === '' ? null : Number(raw);
		case 'integer':
			return raw === '' ? null : Math.trunc(Number(raw));
		case 'boolean':
			return Boolean(raw);
		default:
			return raw === '' ? null : raw;
	}
}

/** Convert a stored field value back into a raw form value. */
export function fromFieldValue(field: FieldDefinition, value: unknown): string | boolean {
	if (value === null || value === undefined) return field.type === 'boolean' ? false : '';
	if (field.type === 'boolean') return Boolean(value);
	return String(value);
}

/** True if a stored value counts as provided (for required-field checks). */
export function isFilled(field: FieldDefinition, value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value.trim() !== '';
	return true;
}
