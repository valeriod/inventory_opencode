<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, ApiError } from '#lib/api';
	import { createMutation, createQuery, getQueryClientContext } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';

	// page.params is already URL-decoded by SvelteKit.
	const sku = $derived.by(() => page.params.sku ?? '');
	const queryClient = getQueryClientContext();

	const itemQuery = createQuery(() => ({
		queryKey: ['item', sku],
		queryFn: () => api.getItem(sku),
	}));
	const item = $derived(itemQuery.data);

	const categoryQuery = createQuery(() => ({
		queryKey: ['category', item?.categoryId],
		queryFn: async () => {
			const id = item?.categoryId;
			if (!id) throw new ApiError(404, { error: 'not_found', message: 'no category' });
			return api.getCategory(id);
		},
		enabled: Boolean(item?.categoryId),
		select: (res: { category: { fieldSchema: unknown } }) => res.category,
	}));

	const movementsQuery = createQuery(() => ({
		queryKey: ['movements', sku],
		queryFn: () => api.listMovements(sku),
	}));

	const fieldEntries = $derived.by(() => {
		const schema = (categoryQuery.data?.fieldSchema ?? []) as {
			key: string;
			label: string;
			unit: string | null;
		}[];
		const data = (item?.data ?? {}) as Record<string, unknown>;
		return schema
			.filter((f) => data[f.key] !== undefined && data[f.key] !== null)
			.map((f) => ({ field: f, value: data[f.key] }));
	});

	const moveMutation = createMutation(() => ({
		mutationFn: (body: unknown) => api.moveItem(sku, body),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['item', sku] });
			queryClient.invalidateQueries({ queryKey: ['movements', sku] });
			queryClient.invalidateQueries({ queryKey: ['items'] });
			delta = '';
			reference = '';
			moveError = null;
		},
	}));

	const deleteMutation = createMutation(() => ({
		mutationFn: () => api.deleteItem(sku),
		onSuccess: () => goto(resolve('/items')),
	}));

	let delta = $state('');
	let reason = $state('received');
	let reference = $state('');
	let moveError = $state<string | null>(null);

	const moveApiError = $derived(
		moveMutation.error instanceof ApiError ? moveMutation.error.message : null,
	);

	function submitMove() {
		const n = Number(delta);
		if (!Number.isFinite(n) || n === 0) {
			moveError = 'Delta must be a non-zero number.';
			return;
		}
		moveError = null;
		moveMutation.mutate({ delta: n, reason, reference: reference || null });
	}

	function displayValue(value: unknown, unit: string | null): string {
		if (value === null || value === undefined) return '—';
		const s = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
		return unit ? `${s} ${unit}` : s;
	}
</script>

{#if itemQuery.isPending}
	<p class="text-sm text-neutral-500">Loading…</p>
{:else if itemQuery.isError}
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold">Item not found</h1>
		<p class="text-sm text-neutral-500">
			{itemQuery.error instanceof ApiError ? itemQuery.error.message : 'Failed to load item.'}
		</p>
		<a href={resolve('/items')} class="text-sm underline">← Back to items</a>
	</div>
{:else if item}
	<div class="space-y-6">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<p class="font-mono text-xs text-neutral-500">{item.sku}</p>
				<h1 class="text-2xl font-semibold">{item.name}</h1>
				{#if item.description}
					<p class="text-sm text-neutral-500">{item.description}</p>
				{/if}
			</div>
			<div class="flex flex-wrap gap-2">
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={api.labelsPrintUrl([item.sku], 'a5')}
					target="_blank"
					rel="noopener noreferrer"
					class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
				>
					Print label
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				<button
					class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
					onclick={() =>
						confirm(
							`Delete ${item.sku}? This only works when stock is 0 and nothing is reserved.`,
						) && deleteMutation.mutate()}
				>
					Delete
				</button>
			</div>
		</div>

		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			<div class="rounded-lg border border-neutral-200 bg-white p-3">
				<div class="text-lg font-semibold">{item.quantityOnHand}</div>
				<div class="text-xs text-neutral-500">on hand{item.unit ? ` (${item.unit})` : ''}</div>
			</div>
			<div class="rounded-lg border border-neutral-200 bg-white p-3">
				<div class="text-lg font-semibold">{item.quantityOnHand - item.available}</div>
				<div class="text-xs text-neutral-500">reserved</div>
			</div>
			<div class="rounded-lg border border-neutral-200 bg-white p-3">
				<div class="text-lg font-semibold">{item.available}</div>
				<div class="text-xs text-neutral-500">available</div>
			</div>
			<div class="rounded-lg border border-neutral-200 bg-white p-3">
				<div class="text-lg font-semibold">
					{item.unitCost !== null ? `$${item.unitCost.toFixed(3)}` : '—'}
				</div>
				<div class="text-xs text-neutral-500">unit cost (USD)</div>
			</div>
		</div>

		<div class="flex flex-wrap gap-4 text-sm text-neutral-600">
			<span>Category: {item.category?.name ?? '—'}</span>
			<span>Location: {item.location ?? '—'}</span>
		</div>

		{#if fieldEntries.length > 0}
			<section>
				<h2 class="mb-2 text-sm font-semibold text-neutral-700">Specifications</h2>
				<dl class="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
					{#each fieldEntries as { field, value } (field.key)}
						<div class="flex justify-between border-b border-neutral-100 py-1 text-sm">
							<dt class="text-neutral-500">{field.label}</dt>
							<dd class="font-medium">{displayValue(value, field.unit)}</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/if}

		<section class="rounded-lg border border-neutral-200 bg-white p-4">
			<h2 class="mb-3 text-sm font-semibold text-neutral-700">Label</h2>
			<div class="flex flex-wrap items-end gap-6">
				<div>
					<div class="mb-1 text-xs text-neutral-500">Code 128 (SKU)</div>
					<img
						src={api.itemLabelUrl(item.sku, { format: 'png', size: 'code128' })}
						alt={`Code 128 barcode for ${item.sku}`}
						class="h-16 w-auto border border-neutral-100 bg-white"
					/>
				</div>
				<div>
					<div class="mb-1 text-xs text-neutral-500">QR (SKU)</div>
					<img
						src={api.itemLabelUrl(item.sku, { format: 'png', size: 'qr' })}
						alt={`QR code for ${item.sku}`}
						class="h-24 w-24 border border-neutral-100 bg-white"
					/>
				</div>
				<div class="text-xs text-neutral-500">
					SKU is encoded in both symbologies. Use <a href={resolve('/labels')} class="underline">
						Labels
					</a> for batch print sheets.
				</div>
			</div>
		</section>

		<section class="rounded-lg border border-neutral-200 bg-white p-4">
			<h2 class="mb-3 text-sm font-semibold text-neutral-700">Move quantity</h2>
			<form
				class="flex flex-wrap items-center gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					submitMove();
				}}
			>
				<input
					type="number"
					step="any"
					bind:value={delta}
					placeholder="± delta (e.g. 10 or -3.5)"
					class="w-44 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
				/>
				<select
					bind:value={reason}
					class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
				>
					<option value="received">received</option>
					<option value="used">used</option>
					<option value="adjusted">adjusted</option>
					<option value="counted">counted</option>
				</select>
				<input
					type="text"
					bind:value={reference}
					placeholder="reference (optional)"
					class="w-40 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
				/>
				<button
					type="submit"
					disabled={moveMutation.isPending}
					class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
				>
					{moveMutation.isPending ? 'Saving…' : 'Apply move'}
				</button>
			</form>
			{#if moveError ?? moveApiError}
				<p class="mt-2 text-sm text-red-700">{moveError ?? moveApiError}</p>
			{/if}
		</section>

		<section>
			<h2 class="mb-2 text-sm font-semibold text-neutral-700">History</h2>
			{#if movementsQuery.isPending}
				<p class="text-sm text-neutral-500">Loading…</p>
			{:else}
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b border-neutral-300 text-left text-neutral-500">
							<th class="py-2 pr-4 font-medium">When</th>
							<th class="py-2 pr-4 text-right font-medium">Delta</th>
							<th class="py-2 pr-4 text-right font-medium">Resulting</th>
							<th class="py-2 pr-4 font-medium">Reason</th>
							<th class="py-2 pr-4 font-medium">Reference</th>
						</tr>
					</thead>
					<tbody>
						{#each movementsQuery.data?.movements ?? [] as m (m.id)}
							<tr class="border-b border-neutral-100">
								<td class="py-2 pr-4 text-neutral-500">{new Date(m.createdAt).toLocaleString()}</td>
								<td
									class="py-2 pr-4 text-right {m.delta > 0
										? 'text-emerald-700'
										: m.delta < 0
											? 'text-red-700'
											: 'text-neutral-500'}"
								>
									{m.delta > 0 ? `+${m.delta}` : m.delta}
								</td>
								<td class="py-2 pr-4 text-right">{m.resultingQty}</td>
								<td class="py-2 pr-4">{m.reason}</td>
								<td class="py-2 pr-4 text-neutral-500">{m.reference ?? '—'}</td>
							</tr>
						{:else}
							<tr>
								<td class="py-4 text-center text-neutral-500" colspan="5">No movements yet.</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	</div>
{/if}
