import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Hello from '../src/lib/components/Hello.svelte';

describe('Hello', () => {
	it('renders the default heading', () => {
		render(Hello);
		expect(screen.getByRole('heading', { name: 'Inventory App' })).toBeDefined();
	});

	it('renders a custom heading', () => {
		render(Hello, { props: { message: 'M0' } });
		expect(screen.getByRole('heading', { name: 'M0' })).toBeDefined();
	});
});
