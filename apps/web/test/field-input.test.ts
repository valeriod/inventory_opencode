import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '@inventory/db';
import FieldInput from '../src/lib/components/FieldInput.svelte';

describe('FieldInput (generated form controls)', () => {
	it('renders a select with its options', () => {
		const field: FieldDefinition = {
			key: 'tolerance',
			label: 'Tolerance',
			type: 'select',
			required: true,
			options: ['1%', '5%'],
		};
		const { getByRole } = render(FieldInput, { props: { field, value: '' } });
		const select = getByRole('combobox') as HTMLSelectElement;
		const options = [...select.options].map((o) => o.value);
		expect(options).toEqual(['1%', '5%']);
	});

	it('renders a unit suffix for numeric fields', () => {
		const field: FieldDefinition = {
			key: 'value',
			label: 'Value',
			type: 'number',
			required: true,
			unit: 'Ω',
		};
		const { container } = render(FieldInput, { props: { field, value: '10' } });
		expect(container.textContent).toContain('Ω');
		const input = container.querySelector('input') as HTMLInputElement;
		expect(input.type).toBe('number');
	});

	it('renders a checkbox for booleans', () => {
		const field: FieldDefinition = { key: 'x', label: 'X', type: 'boolean' };
		const { container } = render(FieldInput, { props: { field, value: false } });
		expect((container.querySelector('input') as HTMLInputElement).type).toBe('checkbox');
	});

	it('renders a date input for dates', () => {
		const field: FieldDefinition = { key: 'd', label: 'Date', type: 'date' };
		const { container } = render(FieldInput, { props: { field, value: '' } });
		expect((container.querySelector('input') as HTMLInputElement).type).toBe('date');
	});

	it('renders a currency input with $ prefix', () => {
		const field: FieldDefinition = { key: 'cost', label: 'Cost', type: 'currency' };
		const { container } = render(FieldInput, { props: { field, value: '1.5' } });
		expect(container.textContent).toContain('$');
	});
});
