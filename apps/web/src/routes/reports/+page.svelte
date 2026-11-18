<script lang="ts">
	import { api } from '#lib/api';
	import { createQuery } from '@tanstack/svelte-query';

	type Tab = 'summary' | 'low-stock' | 'movements' | 'projects';
	let tab = $state<Tab>('summary');

	// Summary
	let groupBy = $state<'category' | 'location'>('category');
	let summaryCategory = $state('');
	const summary = createQuery(() => ({
		queryKey: ['report', 'summary', groupBy, summaryCategory],
		queryFn: () => api.getSummaryReport({ groupBy, category: summaryCategory || undefined }),
		enabled: tab === 'summary',
	}));

	// Low stock
	let threshold = $state('0');
	let lowCategory = $state('');
	const lowStock = createQuery(() => ({
		queryKey: ['report', 'low-stock', threshold, lowCategory],
		queryFn: () =>
			api.getLowStockReport({
				threshold: threshold === '' ? undefined : Number(threshold),
				category: lowCategory || undefined,
			}),
		enabled: tab === 'low-stock',
	}));

	// Movements
	let movSku = $state('');
	let movFrom = $state('');
	let movTo = $state('');
	const movements = createQuery(() => ({
		queryKey: ['report', 'movements', movSku, movFrom, movTo],
		queryFn: () =>
			api.getMovementsReport({
				sku: movSku.trim() || undefined,
				from: movFrom || undefined,
				to: movTo || undefined,
			}),
		enabled: tab === 'movements',
	}));

	// Projects
	let projStatus = $state<'' | 'active' | 'closed'>('');
	const projects = createQuery(() => ({
		queryKey: ['report', 'projects', projStatus],
		queryFn: () => api.getProjectsReport(projStatus ? { status: projStatus } : {}),
		enabled: tab === 'projects',
	}));

	const categories = createQuery(() => ({
		queryKey: ['categories'],
		queryFn: api.listCategories,
		select: (r: { categories: { id: string; name: string }[] }) => r.categories,
	}));

	function fmtUsd(n: number): string {
		return `$${n.toFixed(2)}`;
	}

	const summaryCsv = $derived(
		api.exportCsvUrl({
			report: 'summary',
			groupBy,
			category: summaryCategory || undefined,
		}),
	);
	const movementsCsv = $derived(
		api.exportCsvUrl({
			report: 'movements',
			sku: movSku.trim() || undefined,
			from: movFrom || undefined,
			to: movTo || undefined,
		}),
	);
</script>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
		<h1 class="text-2xl font-semibold">Reports</h1>
		<button
			class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
			onclick={() => window.print()}
		>
			Print
		</button>
	</div>

	<h1 class="hidden text-2xl font-semibold print:block">Inventory reports</h1>

	<div class="flex flex-wrap gap-2 border-b border-neutral-200 print:hidden">
		{#each [['summary', 'Summary'], ['low-stock', 'Low stock'], ['movements', 'Movements'], ['projects', 'Projects']] as [key, label] (key)}
			<button
				class="px-3 py-2 text-sm {tab === key
					? 'border-b-2 border-neutral-900 font-medium'
					: 'text-neutral-500 hover:text-neutral-800'}"
				onclick={() => (tab = key as Tab)}
			>
				{label}
			</button>
		{/each}
	</div>

	{#if tab === 'summary'}
		<section class="space-y-4">
			<div class="flex flex-wrap items-end gap-3 print:hidden">
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-neutral-600">Group by</span>
					<select
						bind:value={groupBy}
						class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
					>
						<option value="category">Category</option>
						<option value="location">Location</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-neutral-600">Category filter</span>
					<select
						bind:value={summaryCategory}
						class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
					>
						<option value="">All</option>
						{#each categories.data ?? [] as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</label>
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={summaryCsv}
					download="summary.csv"
					class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
				>
					Export CSV
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>

			{#if summary.isPending}
				<p class="text-sm text-neutral-500">Loading…</p>
			{:else if summary.data}
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b border-neutral-300 text-left text-neutral-500">
							<th class="py-2 pr-4 font-medium">
								{groupBy === 'category' ? 'Category' : 'Location'}
							</th>
							<th class="py-2 pr-4 text-right font-medium">Items</th>
							<th class="py-2 pr-4 text-right font-medium">Total qty</th>
							<th class="py-2 pr-4 text-right font-medium">Total value (USD)</th>
						</tr>
					</thead>
					<tbody>
						{#each summary.data.rows as row (row.key ?? row.label)}
							<tr class="border-b border-neutral-100">
								<td class="py-2 pr-4">{row.label}</td>
								<td class="py-2 pr-4 text-right">{row.itemCount}</td>
								<td class="py-2 pr-4 text-right">{row.totalQuantity}</td>
								<td class="py-2 pr-4 text-right">{fmtUsd(row.totalValue)}</td>
							</tr>
						{:else}
							<tr><td class="py-4 text-center text-neutral-500" colspan="4">No data.</td></tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="border-t border-neutral-300 font-semibold">
							<td class="py-2 pr-4">Total</td>
							<td class="py-2 pr-4 text-right">{summary.data.totals.itemCount}</td>
							<td class="py-2 pr-4 text-right">{summary.data.totals.totalQuantity}</td>
							<td class="py-2 pr-4 text-right">{fmtUsd(summary.data.totals.totalValue)}</td>
						</tr>
					</tfoot>
				</table>
			{/if}
		</section>
	{:else if tab === 'low-stock'}
		<section class="space-y-4">
			<div class="flex flex-wrap items-end gap-3 print:hidden">
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-neutral-600">Threshold (≤ qty)</span>
					<input
						type="number"
						step="any"
						bind:value={threshold}
						class="w-28 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-neutral-600">Category</span>
					<select
						bind:value={lowCategory}
						class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
					>
						<option value="">All</option>
						{#each categories.data ?? [] as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</label>
			</div>
			{#if lowStock.isPending}
				<p class="text-sm text-neutral-500">Loading…</p>
			{:else if lowStock.data}
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b border-neutral-300 text-left text-neutral-500">
							<th class="py-2 pr-4 font-medium">SKU</th>
							<th class="py-2 pr-4 font-medium">Name</th>
							<th class="py-2 pr-4 font-medium">Category</th>
							<th class="py-2 pr-4 font-medium">Location</th>
							<th class="py-2 pr-4 text-right font-medium">On hand</th>
						</tr>
					</thead>
					<tbody>
						{#each lowStock.data.rows as row (row.sku)}
							<tr class="border-b border-neutral-100">
								<td class="py-2 pr-4 font-mono">{row.sku}</td>
								<td class="py-2 pr-4">{row.name}</td>
								<td class="py-2 pr-4 text-neutral-500">{row.categoryName ?? '—'}</td>
								<td class="py-2 pr-4 text-neutral-500">{row.location ?? '—'}</td>
								<td class="py-2 pr-4 text-right">
									{row.quantityOnHand}{row.unit ? ` ${row.unit}` : ''}
								</td>
							</tr>
						{:else}
							<tr>
								<td class="py-4 text-center text-neutral-500" colspan="5">No low-stock items.</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	{:else if tab === 'movements'}
		<section class="space-y-4">
			<div class="flex flex-wrap items-end gap-3 print:hidden">
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-neutral-600">SKU</span>
					<input
						bind:value={movSku}
						class="w-40 rounded-md border border-neutral-300 px-3 py-1.5 font-mono text-sm"
						placeholder="optional"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-neutral-600">From</span>
					<input
						type="date"
						bind:value={movFrom}
						class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-neutral-600">To</span>
					<input
						type="date"
						bind:value={movTo}
						class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
					/>
				</label>
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={movementsCsv}
					download="movements.csv"
					class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
				>
					Export CSV
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>
			{#if movements.isPending}
				<p class="text-sm text-neutral-500">Loading…</p>
			{:else if movements.data}
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b border-neutral-300 text-left text-neutral-500">
							<th class="py-2 pr-4 font-medium">When</th>
							<th class="py-2 pr-4 font-medium">SKU</th>
							<th class="py-2 pr-4 font-medium">Item</th>
							<th class="py-2 pr-4 text-right font-medium">Delta</th>
							<th class="py-2 pr-4 text-right font-medium">Resulting</th>
							<th class="py-2 pr-4 font-medium">Reason</th>
							<th class="py-2 pr-4 font-medium">Reference</th>
						</tr>
					</thead>
					<tbody>
						{#each movements.data.rows as m (m.id)}
							<tr class="border-b border-neutral-100">
								<td class="py-2 pr-4 text-neutral-500">{new Date(m.createdAt).toLocaleString()}</td>
								<td class="py-2 pr-4 font-mono">{m.sku}</td>
								<td class="py-2 pr-4">{m.itemName ?? '—'}</td>
								<td
									class="py-2 pr-4 text-right {m.delta > 0
										? 'text-emerald-700'
										: m.delta < 0
											? 'text-red-700'
											: ''}"
								>
									{m.delta > 0 ? `+${m.delta}` : m.delta}
								</td>
								<td class="py-2 pr-4 text-right">{m.resultingQty}</td>
								<td class="py-2 pr-4">{m.reason ?? '—'}</td>
								<td class="py-2 pr-4 text-neutral-500">{m.reference ?? '—'}</td>
							</tr>
						{:else}
							<tr><td class="py-4 text-center text-neutral-500" colspan="7">No movements.</td></tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	{:else if tab === 'projects'}
		<section class="space-y-4">
			<div class="flex flex-wrap items-end gap-3 print:hidden">
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-neutral-600">Status</span>
					<select
						bind:value={projStatus}
						class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
					>
						<option value="">All</option>
						<option value="active">Active</option>
						<option value="closed">Closed</option>
					</select>
				</label>
			</div>
			{#if projects.isPending}
				<p class="text-sm text-neutral-500">Loading…</p>
			{:else if projects.data}
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b border-neutral-300 text-left text-neutral-500">
							<th class="py-2 pr-4 font-medium">Project</th>
							<th class="py-2 pr-4 font-medium">Status</th>
							<th class="py-2 pr-4 text-right font-medium">Active allocations</th>
							<th class="py-2 pr-4 text-right font-medium">Reserved qty</th>
						</tr>
					</thead>
					<tbody>
						{#each projects.data.rows as p (p.id)}
							<tr class="border-b border-neutral-100">
								<td class="py-2 pr-4">
									<div class="font-medium">{p.name}</div>
									{#if p.description}<div class="text-xs text-neutral-500">
											{p.description}
										</div>{/if}
								</td>
								<td class="py-2 pr-4">{p.status}</td>
								<td class="py-2 pr-4 text-right">{p.activeAllocations}</td>
								<td class="py-2 pr-4 text-right">{p.reservedQuantity}</td>
							</tr>
						{:else}
							<tr><td class="py-4 text-center text-neutral-500" colspan="4">No projects.</td></tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	{/if}
</div>

<style>
	@media print {
		@page {
			margin: 12mm;
		}
		table {
			font-size: 11px;
		}
	}
</style>
