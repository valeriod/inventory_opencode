<script lang="ts">
	import { FIELD_TYPES, type FieldDefinition } from '@inventory/db';
	import { api, ApiError, type Category } from '#lib/api';
	import { createMutation, createQuery, getQueryClientContext } from '@tanstack/svelte-query';

	interface FieldRow {
		key: string;
		label: string;
		type: string;
		required: boolean;
		searchable: boolean;
		unit: string;
		options: string;
	}

	function toRow(f: FieldDefinition): FieldRow {
		return {
			key: f.key,
			label: f.label,
			type: f.type,
			required: f.required ?? false,
			searchable: f.searchable ?? false,
			unit: f.unit ?? '',
			options: (f.options ?? []).join(', '),
		};
	}

	const queryClient = getQueryClientContext();
	const categories = createQuery(() => ({
		queryKey: ['categories'],
		queryFn: api.listCategories,
		select: (res: { categories: Category[] }) => res.categories,
	}));

	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editDescription = $state('');
	let fields = $state<FieldRow[]>([]);
	let warnings = $state<string[]>([]);
	let saveError = $state<string | null>(null);

	const editing = $derived(categories.data?.find((c) => c.id === editingId) ?? null);

	function startEdit(c: Category) {
		editingId = c.id;
		editName = c.name;
		editDescription = c.description ?? '';
		fields = c.fieldSchema.map(toRow);
		warnings = [];
		saveError = null;
	}

	function newCategory() {
		editingId = 'new';
		editName = '';
		editDescription = '';
		fields = [];
		warnings = [];
		saveError = null;
	}

	function addField() {
		fields.push({
			key: '',
			label: '',
			type: 'string',
			required: false,
			searchable: false,
			unit: '',
			options: '',
		});
	}

	function removeField(index: number) {
		fields.splice(index, 1);
	}

	function buildFieldSchema(rows: FieldRow[]): FieldDefinition[] {
		return rows
			.filter((r) => r.key.trim() !== '' && r.label.trim() !== '')
			.map((r) => {
				const field: FieldDefinition = {
					key: r.key.trim(),
					label: r.label.trim(),
					type: r.type as FieldDefinition['type'],
					required: r.required,
					searchable: r.searchable,
				};
				if (r.type === 'select')
					field.options = r.options
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean);
				if (r.unit.trim()) field.unit = r.unit.trim();
				return field;
			});
	}

	const saveMutation = createMutation(() => ({
		mutationFn: async () => {
			const fieldSchema = buildFieldSchema(fields);
			if (!editingId)
				throw new ApiError(400, { error: 'request_error', message: 'nothing to save' });
			if (editingId === 'new') {
				const res = await api.createCategory({
					name: editName.trim(),
					description: editDescription.trim() || null,
					fieldSchema,
				});
				return { warnings: [] as string[], category: res.category };
			}
			const res = await api.updateCategory(editingId, {
				name: editName.trim(),
				description: editDescription.trim() || null,
				fieldSchema,
			});
			return res;
		},
		onSuccess: (res) => {
			queryClient.invalidateQueries({ queryKey: ['categories'] });
			queryClient.invalidateQueries({ queryKey: ['category'] });
			warnings = res.warnings;
			editingId = null;
			saveError = null;
		},
		onError: (err) => {
			saveError = err instanceof ApiError ? err.message : 'Save failed.';
		},
	}));
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">Categories</h1>
		<button
			class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
			onclick={newCategory}
		>
			+ New category
		</button>
	</div>

	{#if editing}
		<div class="rounded-lg border border-neutral-200 bg-white p-4">
			<h2 class="mb-3 text-sm font-semibold">Edit category</h2>
			<div class="mb-3 flex gap-4">
				<input
					bind:value={editName}
					required
					class="w-64 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
					placeholder="Name"
				/>
				<input
					bind:value={editDescription}
					class="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
					placeholder="Description"
				/>
			</div>

			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="border-b border-neutral-300 text-left text-neutral-500">
						<th class="py-1.5 pr-3 font-medium">Key</th>
						<th class="py-1.5 pr-3 font-medium">Label</th>
						<th class="py-1.5 pr-3 font-medium">Type</th>
						<th class="py-1.5 pr-3 font-medium">Options / unit</th>
						<th class="py-1.5 pr-3 font-medium">Req.</th>
						<th class="py-1.5 pr-3 font-medium">Search</th>
						<th class="py-1.5 font-medium"></th>
					</tr>
				</thead>
				<tbody>
					{#each fields as row, i (i)}
						<tr class="border-b border-neutral-100">
							<td class="py-1.5 pr-3">
								<input
									bind:value={row.key}
									class="w-28 rounded border border-neutral-300 px-2 py-1 font-mono text-xs"
								/>
							</td>
							<td class="py-1.5 pr-3">
								<input
									bind:value={row.label}
									class="w-40 rounded border border-neutral-300 px-2 py-1 text-xs"
								/>
							</td>
							<td class="py-1.5 pr-3">
								<select
									bind:value={row.type}
									class="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
								>
									{#each FIELD_TYPES as t (t)}
										<option value={t}>{t}</option>
									{/each}
								</select>
							</td>
							<td class="py-1.5 pr-3">
								{#if row.type === 'select'}
									<input
										bind:value={row.options}
										placeholder="opt1, opt2, …"
										class="w-44 rounded border border-neutral-300 px-2 py-1 text-xs"
									/>
								{:else}
									<input
										bind:value={row.unit}
										placeholder="unit (e.g. Ω)"
										class="w-28 rounded border border-neutral-300 px-2 py-1 text-xs"
									/>
								{/if}
							</td>
							<td class="py-1.5 pr-3 text-center">
								<input type="checkbox" bind:checked={row.required} class="size-3.5" />
							</td>
							<td class="py-1.5 pr-3 text-center">
								<input type="checkbox" bind:checked={row.searchable} class="size-3.5" />
							</td>
							<td class="py-1.5 text-right">
								<button class="text-red-600 hover:underline" onclick={() => removeField(i)}>
									remove
								</button>
							</td>
						</tr>
					{:else}
						<tr>
							<td class="py-3 text-center text-neutral-500" colspan="7">No fields yet.</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="mt-3 flex items-center gap-3">
				<button class="text-sm underline" onclick={addField}>+ Add field</button>
				<span class="flex-1"></span>
				<button
					class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
					onclick={() => (editingId = null)}
				>
					Cancel
				</button>
				<button
					class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
					disabled={saveMutation.isPending}
					onclick={() => saveMutation.mutate()}
				>
					{saveMutation.isPending ? 'Saving…' : 'Save'}
				</button>
			</div>

			{#if saveError}
				<p class="mt-2 text-sm text-red-700">{saveError}</p>
			{/if}
		</div>
	{:else if warnings.length > 0}
		<div class="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
			Saved with schema-evolution warnings (existing data keeps old values):
			<ul class="mt-1 list-inside list-disc">
				{#each warnings as w (w)}
					<li>{w}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<table class="w-full border-collapse text-sm">
		<thead>
			<tr class="border-b border-neutral-300 text-left text-neutral-500">
				<th class="py-2 pr-4 font-medium">Name</th>
				<th class="py-2 pr-4 font-medium">Description</th>
				<th class="py-2 pr-4 text-right font-medium">Fields</th>
				<th class="py-2 font-medium"></th>
			</tr>
		</thead>
		<tbody>
			{#each categories.data ?? [] as c (c.id)}
				<tr class="border-b border-neutral-100">
					<td class="py-2 pr-4 font-medium">{c.name}</td>
					<td class="py-2 pr-4 text-neutral-500">{c.description ?? '—'}</td>
					<td class="py-2 pr-4 text-right">{c.fieldSchema.length}</td>
					<td class="py-2 text-right">
						<button class="underline hover:no-underline" onclick={() => startEdit(c)}>Edit</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
