<script lang="ts">
	import '../app.css';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';

	const client = new QueryClient();
</script>

<QueryClientProvider {client}>
	<div class="min-h-screen bg-neutral-50 text-neutral-900">
		<header class="border-b border-neutral-200 bg-white print:hidden">
			<div class="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
				<a href={resolve('/')} class="text-lg font-semibold tracking-tight">Inventory</a>
				<nav class="flex gap-4 text-sm">
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
			<slot />
		</main>
	</div>
</QueryClientProvider>
