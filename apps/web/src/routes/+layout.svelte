<script lang="ts">
	import '../app.css';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';

	const client = new QueryClient();
	let { children }: { children: Snippet } = $props();
	let online = $state(true);

	onMount(() => {
		online = navigator.onLine;
		const up = () => (online = true);
		const down = () => (online = false);
		window.addEventListener('online', up);
		window.addEventListener('offline', down);
		return () => {
			window.removeEventListener('online', up);
			window.removeEventListener('offline', down);
		};
	});
</script>

<QueryClientProvider {client}>
	<div class="min-h-screen bg-neutral-50 text-neutral-900">
		{#if !online}
			<div
				class="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 print:hidden"
				role="status"
			>
				Offline — browsing cached data; inventory changes need a connection.
			</div>
		{/if}
		<header class="border-b border-neutral-200 bg-white print:hidden">
			<div class="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
				<a href={resolve('/')} class="text-lg font-semibold tracking-tight">Inventory</a>
				<nav class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
					<a href={resolve('/items')} class="hover:underline">Items</a>
					<a href={resolve('/items/new')} class="hover:underline">New item</a>
					<a href={resolve('/categories')} class="hover:underline">Categories</a>
					<a href={resolve('/projects')} class="hover:underline">Projects</a>
					<a href={resolve('/reports')} class="hover:underline">Reports</a>
					<a href={resolve('/scan')} class="hover:underline">Scan</a>
					<a href={resolve('/labels')} class="hover:underline">Labels</a>
				</nav>
			</div>
		</header>
		<main class="mx-auto max-w-5xl px-4 py-6">
			{@render children()}
		</main>
	</div>
</QueryClientProvider>
