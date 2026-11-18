<script lang="ts">
	import { api } from '#lib/api';
	import { createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';

	let q = $state('');
	let debouncedQ = $state('');
	let categoryId = $state('');
	let location = $state('');
	let page = $state(1);

	$effect(() => {
		void q; // tracked: re-runs when the search box changes
		const timer = setTimeout(() => {
			debouncedQ = q;
			page = 1;
		}, 250);
		return () => clearTimeout(timer);
	});

	const categories = createQuery(() => ({
		queryKey: ['categories'],
		queryFn: api.listCategories,
		select: (res: { categories: { id: string; name: string }[] }) => res.categories,
	}));

	const list = createQuery(() => ({
		queryKey: ['items', debouncedQ, categoryId, location, page],
		queryFn: () =>
			api.listItems({
				q: debouncedQ || undefined,
				category: categoryId || undefined,
				location: location || undefined,
				page,
				pageSize: 25,
			}),
		keepPreviousData: true,
	}));

	function changePage(delta: number) {
		page = Math.max(1, page + delta);
	}
</script>

<div class="space-y-4">
	<div class="flex flex-wrap items-center gap-3">
		<h1 class="text-2xl font-semibold">Items</h1>
		<a
			href={resolve('/items/new')}
			class="ml-auto rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
		>
			+ New item
		</a>
	</div>

	<div class="flex flex-wrap gap-3">
		<input
			type="search"
			bind:value={q}
			placeholder="Search sku, name, or custom fields…"
			class="w-72 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
		/>
		<select
			bind:value={categoryId}
			class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
			onchange={() => (page = 1)}
		>
			<option value="">All categories</option>
			{#each categories.data ?? [] as c (c.id)}
				<option value={c.id}>{c.name}</option>
			{/each}
		</select>
		<input
			type="search"
			bind:value={location}
			placeholder="Location…"
			class="w-36 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
			onchange={() => (page = 1)}
		/>
	</div>

	{#if list.isPending}
		<p class="text-sm text-neutral-500">Loading…</p>
	{:else if list.data}
		<table class="w-full border-collapse text-sm">
			<thead>
				<tr class="border-b border-neutral-300 text-left text-neutral-500">
					<th class="py-2 pr-4 font-medium">SKU</th>
					<th class="py-2 pr-4 font-medium">Name</th>
					<th class="py-2 pr-4 text-right font-medium">Qty</th>
					<th class="py-2 pr-4 font-medium">Location</th>
				</tr>
			</thead>
			<tbody>
				{#each list.data.items as item (item.sku)}
					<tr class="border-b border-neutral-100 hover:bg-neutral-100">
						<td class="py-2 pr-4">
							<a
								href={resolve('/items/[sku]', { sku: item.sku })}
								class="font-mono text-neutral-700 hover:underline"
							>
								{item.sku}
							</a>
						</td>
						<td class="py-2 pr-4">{item.name}</td>
						<td class="py-2 pr-4 text-right">
							{item.quantityOnHand}{item.unit ? ` ${item.unit}` : ''}
						</td>
						<td class="py-2 pr-4 text-neutral-500">{item.location ?? '—'}</td>
					</tr>
				{:else}
					<tr>
						<td class="py-6 text-center text-neutral-500" colspan="4">No items match.</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<div class="flex items-center justify-between text-sm text-neutral-600">
			<span>{list.data.total} result(s)</span>
			<div class="flex items-center gap-2">
				<button
					class="rounded-md border border-neutral-300 bg-white px-2 py-1 disabled:opacity-40"
					disabled={list.data.page <= 1}
					onclick={() => changePage(-1)}
				>
					← Prev
				</button>
				<span>page {list.data.page}</span>
				<button
					class="rounded-md border border-neutral-300 bg-white px-2 py-1 disabled:opacity-40"
					disabled={list.data.page * list.data.pageSize >= list.data.total}
					onclick={() => changePage(1)}
				>
					Next →
				</button>
			</div>
		</div>
	{/if}
</div>
