<script lang="ts">
	import { page } from '$app/state';
	import { api, ApiError } from '#lib/api';
	import { createMutation, createQuery, getQueryClientContext } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';

	const id = $derived.by(() => page.params.id ?? '');
	const qc = getQueryClientContext();

	const projectQuery = createQuery(() => ({
		queryKey: ['project', id],
		queryFn: () => api.getProject(id),
	}));

	const itemsQuery = createQuery(() => ({
		queryKey: ['items', 'all-for-allocation'],
		queryFn: () => api.listItems({ pageSize: 200, sort: 'sku' }),
	}));

	let tab = $state<'active' | 'history'>('active');
	let sku = $state('');
	let quantity = $state('');
	let note = $state('');
	let allocError = $state<string | null>(null);

	function invalidate() {
		qc.invalidateQueries({ queryKey: ['project', id] });
		qc.invalidateQueries({ queryKey: ['projects'] });
		qc.invalidateQueries({ queryKey: ['items'] });
	}

	const allocate = createMutation(() => ({
		mutationFn: (body: { projectId: string; sku: string; quantity: number; note: string | null }) =>
			api.createAllocation(body),
		onSuccess: () => {
			invalidate();
			quantity = '';
			note = '';
			allocError = null;
		},
		onError: (err: unknown) => {
			allocError = err instanceof ApiError ? err.message : 'Failed to reserve parts.';
		},
	}));

	const release = createMutation(() => ({
		mutationFn: (allocationId: string) => api.updateAllocation(allocationId, { release: true }),
		onSuccess: () => invalidate(),
	}));

	const closeProject = createMutation(() => ({
		mutationFn: (status: 'active' | 'closed') => api.updateProject(id, { status }),
		onSuccess: () => invalidate(),
	}));

	function submitAllocation() {
		const q = Number(quantity);
		if (!sku) {
			allocError = 'Select an item.';
			return;
		}
		if (!Number.isFinite(q) || q <= 0) {
			allocError = 'Quantity must be a positive number.';
			return;
		}
		allocError = null;
		allocate.mutate({ projectId: id, sku, quantity: q, note: note.trim() || null });
	}

	const project = $derived(projectQuery.data?.project);
	const items = $derived(itemsQuery.data?.items ?? []);
</script>

{#if projectQuery.isPending}
	<p class="text-sm text-neutral-500">Loading…</p>
{:else if projectQuery.isError || !project}
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold">Project not found</h1>
		<a href={resolve('/projects')} class="text-sm underline">← Back to projects</a>
	</div>
{:else}
	<div class="space-y-6">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<a href={resolve('/projects')} class="text-sm text-neutral-500 hover:underline">
					← Projects
				</a>
				<h1 class="mt-1 text-2xl font-semibold">{project.name}</h1>
				{#if project.description}
					<p class="text-sm text-neutral-500">{project.description}</p>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<span
					class="rounded-full px-2 py-0.5 text-xs {project.status === 'active'
						? 'bg-emerald-100 text-emerald-800'
						: 'bg-neutral-200 text-neutral-700'}"
				>
					{project.status}
				</span>
				{#if project.status === 'active'}
					<button
						class="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
						onclick={() => closeProject.mutate('closed')}
						disabled={closeProject.isPending}
					>
						Close project
					</button>
				{:else}
					<button
						class="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
						onclick={() => closeProject.mutate('active')}
						disabled={closeProject.isPending}
					>
						Reopen
					</button>
				{/if}
			</div>
		</div>

		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
			<div class="rounded-lg border border-neutral-200 bg-white p-3">
				<div class="text-lg font-semibold">{project.activeAllocations}</div>
				<div class="text-xs text-neutral-500">active allocations</div>
			</div>
			<div class="rounded-lg border border-neutral-200 bg-white p-3">
				<div class="text-lg font-semibold">{project.reservedQuantity}</div>
				<div class="text-xs text-neutral-500">reserved quantity</div>
			</div>
		</div>

		<section class="rounded-lg border border-neutral-200 bg-white p-4">
			<h2 class="mb-3 text-sm font-semibold text-neutral-700">Set parts aside</h2>
			<form
				class="flex flex-wrap items-end gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					submitAllocation();
				}}
			>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-neutral-600">Item</span>
					<select
						bind:value={sku}
						class="min-w-56 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
						required
					>
						<option value="">Select item…</option>
						{#each items as item (item.sku)}
							<option value={item.sku}>
								{item.sku} — {item.name} (on hand {item.quantityOnHand})
							</option>
						{/each}
					</select>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-neutral-600">Quantity</span>
					<input
						type="number"
						step="any"
						min="0"
						bind:value={quantity}
						required
						class="w-28 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
					/>
				</label>
				<label class="flex flex-1 flex-col gap-1 text-sm">
					<span class="text-neutral-600">Note</span>
					<input
						bind:value={note}
						placeholder="optional"
						class="min-w-40 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
					/>
				</label>
				<button
					type="submit"
					disabled={allocate.isPending}
					class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
				>
					{allocate.isPending ? 'Reserving…' : 'Reserve'}
				</button>
			</form>
			{#if allocError}
				<p class="mt-2 text-sm text-red-700">{allocError}</p>
			{/if}
		</section>

		<section>
			<div class="mb-2 flex gap-2 border-b border-neutral-200">
				<button
					class="px-3 py-2 text-sm {tab === 'active'
						? 'border-b-2 border-neutral-900 font-medium'
						: 'text-neutral-500 hover:text-neutral-800'}"
					onclick={() => (tab = 'active')}
				>
					Active allocations ({project.allocations.length})
				</button>
				<button
					class="px-3 py-2 text-sm {tab === 'history'
						? 'border-b-2 border-neutral-900 font-medium'
						: 'text-neutral-500 hover:text-neutral-800'}"
					onclick={() => (tab = 'history')}
				>
					History ({project.history.length})
				</button>
			</div>

			{#if tab === 'active'}
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b border-neutral-300 text-left text-neutral-500">
							<th class="py-2 pr-4 font-medium">SKU</th>
							<th class="py-2 pr-4 text-right font-medium">Qty</th>
							<th class="py-2 pr-4 font-medium">Note</th>
							<th class="py-2 pr-4 font-medium">Reserved</th>
							<th class="py-2 pr-4 font-medium"></th>
						</tr>
					</thead>
					<tbody>
						{#each project.allocations as a (a.id)}
							<tr class="border-b border-neutral-100">
								<td class="py-2 pr-4">
									<a
										href={resolve('/items/[sku]', { sku: a.sku })}
										class="font-mono hover:underline"
									>
										{a.sku}
									</a>
								</td>
								<td class="py-2 pr-4 text-right">{a.quantity}</td>
								<td class="py-2 pr-4 text-neutral-500">{a.note ?? '—'}</td>
								<td class="py-2 pr-4 text-neutral-500">
									{new Date(a.reservedAt).toLocaleString()}
								</td>
								<td class="py-2 pr-4">
									<button
										class="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
										onclick={() => release.mutate(a.id)}
										disabled={release.isPending}
									>
										Release
									</button>
								</td>
							</tr>
						{:else}
							<tr>
								<td class="py-6 text-center text-neutral-500" colspan="5">
									No active allocations.
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b border-neutral-300 text-left text-neutral-500">
							<th class="py-2 pr-4 font-medium">SKU</th>
							<th class="py-2 pr-4 text-right font-medium">Qty</th>
							<th class="py-2 pr-4 font-medium">Note</th>
							<th class="py-2 pr-4 font-medium">Reserved</th>
							<th class="py-2 pr-4 font-medium">Released</th>
						</tr>
					</thead>
					<tbody>
						{#each project.history as a (a.id)}
							<tr class="border-b border-neutral-100">
								<td class="py-2 pr-4">
									<a
										href={resolve('/items/[sku]', { sku: a.sku })}
										class="font-mono hover:underline"
									>
										{a.sku}
									</a>
								</td>
								<td class="py-2 pr-4 text-right">{a.quantity}</td>
								<td class="py-2 pr-4 text-neutral-500">{a.note ?? '—'}</td>
								<td class="py-2 pr-4 text-neutral-500">
									{new Date(a.reservedAt).toLocaleString()}
								</td>
								<td class="py-2 pr-4 text-neutral-500">
									{a.releasedAt ? new Date(a.releasedAt).toLocaleString() : '—'}
								</td>
							</tr>
						{:else}
							<tr>
								<td class="py-6 text-center text-neutral-500" colspan="5">
									No released allocations.
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	</div>
{/if}
