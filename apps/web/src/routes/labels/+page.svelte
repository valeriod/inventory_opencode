<script lang="ts">
	import { api } from '#lib/api';

	let input = $state('');
	let layout = $state<'a5' | '4x6'>('a5');

	function parseSkus(text: string): string[] {
		return Array.from(
			new Set(
				text
					.split(/[\s,;]+/)
					.map((s) => s.trim())
					.filter(Boolean),
			),
		);
	}

	const skus = $derived(parseSkus(input));
	const printUrl = $derived(skus.length ? api.labelsPrintUrl(skus, layout) : '');
</script>

<svelte:head>
	<title>Labels — Inventory</title>
</svelte:head>

<div class="space-y-5">
	<div>
		<h1 class="text-2xl font-semibold">Labels</h1>
		<p class="text-sm text-neutral-500">
			Batch-print SKU labels (Code 128 + QR). Each label shows name, SKU, quantity, and location.
		</p>
	</div>

	<div class="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
		<section class="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
			<label class="block">
				<span class="mb-1 block text-sm font-medium text-neutral-700">SKUs</span>
				<textarea
					bind:value={input}
					rows="8"
					placeholder="One per line or comma-separated&#10;e.g. RES-10K-1%&#10;CAP-100N"
					class="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
				></textarea>
			</label>

			<label class="block">
				<span class="mb-1 block text-sm font-medium text-neutral-700">Layout</span>
				<select
					bind:value={layout}
					class="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
				>
					<option value="a5">A5 sheet</option>
					<option value="4x6">4×6 in</option>
				</select>
			</label>

			<div class="text-sm text-neutral-600">{skus.length} SKU(s)</div>

			<div class="flex gap-2">
				{#if printUrl}
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						href={printUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
					>
						Open printable sheet
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{:else}
					<span class="rounded-md bg-neutral-200 px-3 py-1.5 text-sm text-neutral-500">
						Open printable sheet
					</span>
				{/if}
			</div>

			<p class="text-xs text-neutral-500">
				Use your browser’s Print dialog (choose “Save as PDF” or a printer). For best results, set
				margins to “None”/“Minimum” and scale to 100%.
			</p>
		</section>

		<section class="space-y-2">
			<h2 class="text-sm font-semibold text-neutral-700">Preview</h2>
			{#if printUrl}
				<iframe
					title="Label sheet preview"
					src={printUrl}
					class="h-[70vh] w-full rounded-lg border border-neutral-200 bg-white"
				></iframe>
			{:else}
				<div
					class="flex h-48 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-500"
				>
					Enter one or more SKUs to preview a printable sheet.
				</div>
			{/if}
		</section>
	</div>
</div>
