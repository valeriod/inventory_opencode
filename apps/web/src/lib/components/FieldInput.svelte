<script lang="ts">
	import type { FieldDefinition } from '@inventory/db';

	let { field, value = $bindable() }: { field: FieldDefinition; value: string | boolean } =
		$props();

	const text = $derived(typeof value === 'boolean' ? '' : String(value ?? ''));
	const checked = $derived(Boolean(value));

	function onTextChange(e: Event) {
		value = (e.currentTarget as HTMLInputElement).value;
	}

	function onBoolChange(e: Event) {
		value = (e.currentTarget as HTMLInputElement).checked;
	}
</script>

{#if field.type === 'boolean'}
	<input type="checkbox" {checked} onchange={onBoolChange} class="size-4" />
{:else if field.type === 'select'}
	<select
		value={text}
		onchange={onTextChange}
		required={field.required}
		class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
	>
		{#if !field.required}
			<option value=""></option>
		{/if}
		{#each field.options ?? [] as opt (opt)}
			<option value={opt}>{opt}</option>
		{/each}
	</select>
{:else if field.type === 'date'}
	<input
		type="date"
		value={text}
		onchange={onTextChange}
		required={field.required}
		class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
	/>
{:else}
	<span class="inline-flex items-center gap-1">
		{#if field.type === 'currency'}
			<span class="text-sm text-neutral-500">$</span>
		{/if}
		<input
			type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
			value={text}
			onchange={onTextChange}
			required={field.required}
			step={field.type === 'integer' ? 1 : 'any'}
			max={field.max}
			class="w-32 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
		/>
		{#if field.unit}
			<span class="text-sm text-neutral-500">{field.unit}</span>
		{/if}
	</span>
{/if}
