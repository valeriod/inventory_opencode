<script lang="ts">
	import { api, ApiError } from '#lib/api';
	import { createMutation, createQuery, getQueryClientContext } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';

	const qc = getQueryClientContext();

	const projects = createQuery(() => ({
		queryKey: ['projects'],
		queryFn: api.listProjects,
		select: (res: {
			projects: {
				id: string;
				name: string;
				status: string;
				activeAllocations: number;
				reservedQuantity: number;
				description: string | null;
			}[];
		}) => res.projects,
	}));

	let name = $state('');
	let description = $state('');
	let createError = $state<string | null>(null);

	const create = createMutation(() => ({
		mutationFn: (body: { name: string; description: string | null }) => api.createProject(body),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['projects'] });
			name = '';
			description = '';
			createError = null;
		},
		onError: (err: unknown) => {
			createError = err instanceof ApiError ? err.message : 'Failed to create project.';
		},
	}));

	function submit() {
		const n = name.trim();
		if (!n) {
			createError = 'Name is required.';
			return;
		}
		create.mutate({ name: n, description: description.trim() || null });
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">Projects</h1>
	</div>

	<section class="rounded-lg border border-neutral-200 bg-white p-4">
		<h2 class="mb-3 text-sm font-semibold text-neutral-700">New project</h2>
		<form
			class="flex flex-wrap items-end gap-3"
			onsubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-neutral-600">Name</span>
				<input
					bind:value={name}
					required
					class="w-56 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
					placeholder="e.g. Blinkenlights"
				/>
			</label>
			<label class="flex flex-1 flex-col gap-1 text-sm">
				<span class="text-neutral-600">Description</span>
				<input
					bind:value={description}
					class="min-w-48 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
					placeholder="optional"
				/>
			</label>
			<button
				type="submit"
				disabled={create.isPending}
				class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
			>
				{create.isPending ? 'Creating…' : 'Create'}
			</button>
		</form>
		{#if createError}
			<p class="mt-2 text-sm text-red-700">{createError}</p>
		{/if}
	</section>

	<section>
		{#if projects.isPending}
			<p class="text-sm text-neutral-500">Loading…</p>
		{:else if projects.isError}
			<p class="text-sm text-red-700">Failed to load projects.</p>
		{:else}
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="border-b border-neutral-300 text-left text-neutral-500">
						<th class="py-2 pr-4 font-medium">Name</th>
						<th class="py-2 pr-4 font-medium">Status</th>
						<th class="py-2 pr-4 text-right font-medium">Active allocations</th>
						<th class="py-2 pr-4 text-right font-medium">Reserved qty</th>
					</tr>
				</thead>
				<tbody>
					{#each projects.data ?? [] as p (p.id)}
						<tr class="border-b border-neutral-100 hover:bg-neutral-100">
							<td class="py-2 pr-4">
								<a
									href={resolve('/projects/[id]', { id: p.id })}
									class="font-medium hover:underline"
								>
									{p.name}
								</a>
								{#if p.description}
									<div class="text-xs text-neutral-500">{p.description}</div>
								{/if}
							</td>
							<td class="py-2 pr-4">
								<span
									class="rounded-full px-2 py-0.5 text-xs {p.status === 'active'
										? 'bg-emerald-100 text-emerald-800'
										: 'bg-neutral-200 text-neutral-700'}"
								>
									{p.status}
								</span>
							</td>
							<td class="py-2 pr-4 text-right">{p.activeAllocations}</td>
							<td class="py-2 pr-4 text-right">{p.reservedQuantity}</td>
						</tr>
					{:else}
						<tr>
							<td class="py-6 text-center text-neutral-500" colspan="4">No projects yet.</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
</div>
