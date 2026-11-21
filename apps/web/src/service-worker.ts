/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
export {};

const build: string[] = [];
const files: string[] = [];
const prerendered: string[] = [];
const version = 'dev';
try {
	// SvelteKit injects $service-worker at build; dev typecheck falls back safely.
	// @ts-expect-error - virtual module in build, unavailable in plain typecheck
	const sw = await import('$service-worker');
	build.push(...sw.build);
	files.push(...sw.files);
	prerendered.push(...sw.prerendered);
} catch {
	// dev/typecheck fallback
}

const CACHE = `inventory-cache-${version}`;
const ASSETS = [...build, ...files, ...prerendered];

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(ASSETS);
			await self.skipWaiting();
		})(),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await self.clients.claim();
		})(),
	);
});

function isApiRead(request: Request, url: URL): boolean {
	return (
		request.method === 'GET' &&
		url.origin === self.location.origin &&
		url.pathname.startsWith('/api/')
	);
}

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					const response = await fetch(request);
					const cache = await caches.open(CACHE);
					cache.put(request, response.clone());
					return response;
				} catch {
					const cached = await caches.match(request);
					if (cached) return cached;
					const fallback = await caches.match('/');
					return fallback ?? new Response('Offline', { status: 503, statusText: 'Offline' });
				}
			})(),
		);
		return;
	}

	if (isApiRead(request, url)) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE);
				const cached = await cache.match(request);
				const network = fetch(request)
					.then((response) => {
						if (response.ok) cache.put(request, response.clone());
						return response;
					})
					.catch(() => undefined);
				if (cached) {
					void network;
					return cached;
				}
				const response = await network;
				return response ?? new Response('Offline', { status: 503, statusText: 'Offline' });
			})(),
		);
		return;
	}

	if (ASSETS.includes(url.pathname) || request.destination !== '') {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE);
				const cached = await cache.match(request);
				if (cached) return cached;
				const response = await fetch(request);
				if (response.ok) cache.put(request, response.clone());
				return response;
			})(),
		);
	}
});
