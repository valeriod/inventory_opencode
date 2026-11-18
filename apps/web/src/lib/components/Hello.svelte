<script lang="ts">
	let { message = 'Inventory App' }: { message?: string } = $props();
</script>

<h1>{message}</h1>
<p>
	SvelteKit PWA scaffold (M0). API health check: <a href="http://localhost:3000/api/health">
		/api/health
	</a>
</p>
