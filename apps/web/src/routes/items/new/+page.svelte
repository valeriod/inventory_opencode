<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import FieldInput from '#lib/components/FieldInput.svelte';
	import { api, ApiError, type Category } from '#lib/api';
	import { fromFieldValue, isFilled, toFieldValue } from '#lib/field-values';
	import { createMutation, createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';

	let categoryId = $state('');
	const initialSku = $derived.by(() => (page.url.searchParams.get('sku') ?? '').toUpperCase());
	let sku = $state('');
	let skuPrefilled = $state(false);

	$effect(() => {
		if (!skuPrefilled && initialSku) {
			sku = initialSku;
			skuPrefilled = true;
		}
	});
	let name = $state('');
	let unit = $state('');
	let location = $state('');
	let unitCost = $state('');
	let description = $state('');
	let formValues = $state<Record<string, string | boolean>>({});
	let submitError = $state<string | null>(null);

	const categories = createQuery(() => ({
		queryKey: ['categories'],
		queryFn: api.listCategories,
		select: (res: { categories: { id: string; name: string }[] }) => res.categories,
	}));

	const category = createQuery(() => ({
		queryKey: ['category', categoryId],
		queryFn: () => api.getCategory(categoryId),
		enabled: categoryId !== '',
		select: (res: { category: Category }) => res.category,
	}));

	// (Re)initialise generated form values whenever the category schema changes.
	$effect(() => {
		const schema = category.data?.fieldSchema ?? [];
		const initial: Record<string, string | boolean> = {};
		for (const field of schema) initial[field.key] = fromFieldValue(field, null);
		formValues = initial;
		submitError = null;
	});

	const createItemMutation = createMutation(() => ({
		mutationFn: async () => {
			const cat = category.data;
			if (!cat) throw new ApiError(400, { error: 'request_error', message: 'pick a category' });
			const data: Record<string, unknown> = {};
			for (const field of cat.fieldSchema) {
				const raw = formValues[field.key];
				const value = toFieldValue(field, raw);
				if (value === null || value === '') continue;
				if (field.required && !isFilled(field, value)) {
					throw new ApiError(400, {
						error: 'validation_error',
						message: `Field '${field.label}' is required.`,
					});
				}
				data[field.key] = value;
			}
			const item = await api.createItem({
				sku: sku.trim().toUpperCase(),
				categoryId,
				name: name.trim(),
				description: description.trim() || null,
				unit: unit.trim() || null,
				location: location.trim() || null,
				unitCost: unitCost === '' ? null : Number(unitCost),
				data: Object.keys(data).length > 0 ? data : null,
			});
			return item;
		},
		onSuccess: (item) => goto(resolve('/items/[sku]', { sku: item.sku })),
	}));

	const createError = $derived(
		createItemMutation.error instanceof ApiError ? createItemMutation.error : null,
	);
	const createErrorMessage = $derived(submitError ?? createError?.message ?? null);

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!categoryId) {
			submitError = 'Pick a category first.';
			return;
		}
		submitError = null;
		createItemMutation.mutate();
	}
</script>

<div class="space-y-4">
	<h1 class="text-2xl font-semibold">New item</h1>

	<form class="max-w-xl space-y-5" onsubmit={handleSubmit}>
		<div>
			<label class="mb-1 block text-sm font-medium">Category</label>
			<select
				bind:value={categoryId}
				class="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
				required
			>
				<option value="" disabled>Choose a category…</option>
				{#each categories.data ?? [] as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
		</div>

		{#if category.isPending}
			<p class="text-sm text-neutral-500">Loading field schema…</p>
		{:else if category.data && category.data.fieldSchema.length > 0}
			<fieldset class="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
				<legend class="px-1 text-sm font-semibold text-neutral-700">
					{category.data.name} — fields
				</legend>
				{#each category.data.fieldSchema as field (field.key)}
					<div class="flex items-center gap-3">
						<label class="w-44 shrink-0 text-sm text-neutral-600">
							{field.label}{#if field.required}<span class="text-red-600"> *</span>{/if}
						</label>
						<FieldInput {field} bind:value={formValues[field.key]} />
					</div>
				{/each}
			</fieldset>
		{:else if categoryId}
			<p class="text-sm text-neutral-500">This category has no custom fields.</p>
		{/if}

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<div>
				<label class="mb-1 block text-sm font-medium">
					SKU <span class="text-red-600">*</span>
				</label>
				<input
					bind:value={sku}
					required
					pattern={'[A-Z0-9][A-Z0-9-%]{2,31}'}
					title="Uppercase letters/digits, 3–32 chars, may include - and %"
					autocapitalize="characters"
					oninput={() => (sku = sku.toUpperCase())}
					class="w-full rounded-md border border-neutral-300 px-3 py-1.5 font-mono text-sm uppercase"
				/>
				<p class="mt-1 text-xs text-neutral-500">3–32 chars: A–Z, 0–9, <code>-</code>, <code>%</code></p>
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium">
					Name <span class="text-red-600">*</span>
				</label>
				<input
					bind:value={name}
					required
					class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
				/>
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium">Unit</label>
				<input
					bind:value={unit}
					placeholder="pc, m, reel…"
					class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
				/>
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium">Location</label>
				<input
					bind:value={location}
					placeholder="A3-12"
					class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
				/>
			</div>
			<div class="sm:col-span-2">
				<label class="mb-1 block text-sm font-medium">Unit cost (USD)</label>
				<input
					bind:value={unitCost}
					type="number"
					step="any"
					min="0"
					class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
				/>
			</div>
			<div class="sm:col-span-2">
				<label class="mb-1 block text-sm font-medium">Description</label>
				<textarea
					bind:value={description}
					rows="2"
					class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"></textarea>
			</div>
		</div>

		{#if createErrorMessage}
			<div class="space-y-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
				<p>{createErrorMessage}</p>
				{#if createError && createError.issues.length > 0}
					<ul class="list-inside list-disc">
						{#each createError.issues as issue, i (i)}
							<li>{JSON.stringify(issue)}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		<button
			type="submit"
			disabled={createItemMutation.isPending}
			class="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
		>
			{createItemMutation.isPending ? 'Creating…' : 'Create item'}
		</button>
	</form>
</div>
