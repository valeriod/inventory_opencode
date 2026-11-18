<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
	import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';
	import { api, ApiError } from '#lib/api';
	import { resolve } from '$app/paths';

	type Mode = 'idle' | 'starting' | 'scanning' | 'stopped';
	type NativeDetector = {
		detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
	};

	let mode = $state<Mode>('idle');
	let status = $state('Ready to scan. Camera access requires HTTPS (or localhost).');
	let error = $state<string | null>(null);
	let devices = $state<MediaDeviceInfo[]>([]);
	let deviceId = $state('');
	let continuous = $state(true);
	let lastCode = $state('');
	let lastResult = $state<string | null>(null);
	let videoEl = $state<HTMLVideoElement | null>(null);

	let controls: IScannerControls | null = null;
	let nativeTimer: number | null = null;
	let nativeDetector: NativeDetector | null = null;
	let mediaStream: MediaStream | null = null;
	let processing = false;
	let cooldownUntil = 0;

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- ZXing hint map, not reactive state
	const hints = new Map<DecodeHintType, unknown>();
	hints.set(DecodeHintType.POSSIBLE_FORMATS, [
		BarcodeFormat.CODE_128,
		BarcodeFormat.CODE_39,
		BarcodeFormat.EAN_13,
		BarcodeFormat.UPC_A,
		BarcodeFormat.ITF,
		BarcodeFormat.QR_CODE,
		BarcodeFormat.DATA_MATRIX,
	]);

	async function refreshDevices() {
		try {
			const all = await navigator.mediaDevices.enumerateDevices();
			devices = all.filter((d) => d.kind === 'videoinput');
			if (!deviceId && devices[0]) deviceId = devices[0].deviceId;
		} catch {
			// ignore; may need permission first
		}
	}

	function normalize(code: string): string {
		return code.trim();
	}

	function feedback() {
		try {
			navigator.vibrate?.(40);
		} catch {
			// ignore
		}
	}

	async function handleCode(raw: string) {
		const code = normalize(raw);
		if (!code) return;
		const now = Date.now();
		if (processing || now < cooldownUntil) return;
		if (!continuous && lastCode === code) return;
		processing = true;
		lastCode = code;
		lastResult = null;
		try {
			const item = await api.getItem(code);
			feedback();
			lastResult = `Found ${item.sku} — ${item.name}`;
			if (!continuous) {
				await stop();
				await goto(resolve('/items/[sku]', { sku: item.sku }));
				return;
			}
			status = `Matched ${item.sku}.`;
			cooldownUntil = Date.now() + 1500;
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) {
				lastResult = `Unknown code: ${code}`;
				status = 'Unknown code — you can create an item with this SKU.';
			} else {
				error = e instanceof Error ? e.message : 'Lookup failed.';
			}
			cooldownUntil = Date.now() + 1200;
		} finally {
			processing = false;
		}
	}

	async function startNative(): Promise<boolean> {
		const BD = (window as unknown as { BarcodeDetector?: new (o?: unknown) => NativeDetector })
			.BarcodeDetector;
		if (!BD || !videoEl) return false;
		try {
			nativeDetector = new BD({
				formats: ['code_128', 'code_39', 'ean_13', 'upc_a', 'itf', 'qr_code', 'data_matrix'],
			});
		} catch {
			nativeDetector = null;
			return false;
		}
		mediaStream = await navigator.mediaDevices.getUserMedia({
			video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' },
			audio: false,
		});
		videoEl.srcObject = mediaStream;
		await videoEl.play();
		const tick = async () => {
			if (!nativeDetector || !videoEl || mode !== 'scanning') return;
			if (videoEl.readyState >= 2) {
				try {
					const codes = await nativeDetector.detect(videoEl);
					const value = codes[0]?.rawValue;
					if (value) await handleCode(value);
				} catch {
					// detection can throw on some frames/devices
				}
			}
			nativeTimer = window.setTimeout(tick, 200);
		};
		nativeTimer = window.setTimeout(tick, 200);
		return true;
	}

	async function startZxing() {
		if (!videoEl) return;
		const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 200 });
		controls = await reader.decodeFromVideoDevice(
			deviceId || undefined,
			videoEl,
			async (result, err) => {
				if (result) {
					await handleCode(result.getText());
					return;
				}
				if (err && !(err instanceof NotFoundException)) {
					// non-fatal frame errors are common; only surface persistent issues
					error = err.message;
				}
			},
		);
	}

	async function start() {
		error = null;
		lastResult = null;
		lastCode = '';
		if (!navigator.mediaDevices?.getUserMedia) {
			error = 'Camera API unavailable. Use HTTPS (or localhost) and a supported browser.';
			return;
		}
		mode = 'starting';
		status = 'Starting camera…';
		try {
			const usedNative = await startNative();
			if (!usedNative) await startZxing();
			mode = 'scanning';
			status = usedNative ? 'Scanning (BarcodeDetector)…' : 'Scanning (ZXing fallback)…';
			await refreshDevices();
		} catch (e) {
			mode = 'idle';
			error = e instanceof Error ? e.message : 'Failed to start camera.';
			await stop();
		}
	}

	async function stop() {
		if (nativeTimer != null) {
			window.clearTimeout(nativeTimer);
			nativeTimer = null;
		}
		nativeDetector = null;
		try {
			controls?.stop();
		} catch {
			// ignore
		}
		controls = null;
		if (mediaStream) {
			for (const t of mediaStream.getTracks()) t.stop();
			mediaStream = null;
		}
		if (videoEl) videoEl.srcObject = null;
		if (mode !== 'idle') {
			mode = 'stopped';
			status = 'Camera stopped.';
		}
	}

	onDestroy(() => {
		void stop();
	});

	$effect(() => {
		void refreshDevices();
	});

	function createWithSku() {
		if (!lastCode) return;
		const sku = encodeURIComponent(lastCode);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- externalized query string
		void goto(`${resolve('/items/new')}?sku=${sku}`);
	}
</script>

<svelte:head>
	<title>Scan — Inventory</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-center gap-3">
		<h1 class="text-2xl font-semibold">Scan</h1>
		<p class="text-sm text-neutral-500">Barcode / QR → open item or create by SKU.</p>
	</div>

	<div class="overflow-hidden rounded-lg border border-neutral-200 bg-black">
		<video bind:this={videoEl} class="aspect-video w-full object-contain" playsinline muted></video>
	</div>

	<div class="flex flex-wrap items-center gap-3">
		{#if mode === 'scanning'}
			<button
				class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
				onclick={stop}
			>
				Stop
			</button>
		{:else}
			<button
				class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
				disabled={mode === 'starting'}
				onclick={start}
			>
				{mode === 'starting' ? 'Starting…' : 'Start camera'}
			</button>
		{/if}

		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={continuous} />
			Continuous (scan again)
		</label>

		{#if devices.length > 1}
			<select
				bind:value={deviceId}
				class="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
				disabled={mode === 'scanning'}
			>
				{#each devices as d, i (d.deviceId || i)}
					<option value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
				{/each}
			</select>
		{/if}
	</div>

	<div class="rounded-md border border-neutral-200 bg-white p-3 text-sm">
		<div class="text-neutral-700">{status}</div>
		{#if error}
			<div class="mt-1 text-red-700">{error}</div>
		{/if}
		{#if lastResult}
			<div class="mt-2 font-medium">{lastResult}</div>
			{#if lastResult.startsWith('Unknown code') && lastCode}
				<button
					class="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
					onclick={createWithSku}
				>
					Create item with SKU “{lastCode}”
				</button>
			{/if}
		{/if}
	</div>

	<p class="text-xs text-neutral-500">
		Supported: Code 128, Code 39, EAN-13/UPC, ITF, QR, DataMatrix. Phone cameras require HTTPS in
		production (or localhost). For LAN use, serve behind a TLS reverse proxy (e.g. Caddy) or a
		trusted cert.
	</p>
</div>
