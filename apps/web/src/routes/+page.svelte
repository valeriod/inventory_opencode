<script lang="ts">
	import { api } from '#lib/api';
	import { resolve } from '$app/paths';
	import { createQuery } from '@tanstack/svelte-query';

	const stats = createQuery(() => ({
		queryKey: ['dashboard'],
		queryFn: async () => {
			const [items, categories] = await Promise.all([
				api.listItems({ pageSize: 200 }),
				api.listCategories(),
			]);
			let withStock = 0;
			for (const item of items.items) if (item.quantityOnHand > 0) withStock++;
			return {
				itemCount: items.total,
				categoryCount: categories.categories.length,
				withStock,
			};
		},
	}));
</script>

<div class="space-y-6">
	<h1 class="text-2xl font-semibold">Inventory</h1>
	{#if stats.isPending}
		<p class="text-sm text-neutral-500">Loading…</p>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div class="rounded-lg border border-neutral-200 bg-white p-4">
				<div class="text-2xl font-semibold">{stats.data?.itemCount ?? 0}</div>
				<div class="text-sm text-neutral-500">items</div>
			</div>
			<div class="rounded-lg border border-neutral-200 bg-white p-4">
				<div class="text-2xl font-semibold">{stats.data?.withStock ?? 0}</div>
				<div class="text-sm text-neutral-500">in stock</div>
			</div>
			<div class="rounded-lg border border-neutral-200 bg-white p-4">
				<div class="text-2xl font-semibold">{stats.data?.categoryCount ?? 0}</div>
				<div class="text-sm text-neutral-500">categories</div>
			</div>
		</div>
		<a
			href={resolve('/items')}
			class="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
		>
			Browse items →
		</a>
	{/if}
</div>
