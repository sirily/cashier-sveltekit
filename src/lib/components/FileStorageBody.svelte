<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { FileTreeEntry } from '#lib/utils/opfslib';
	import OpfsFilePicker from './OpfsFilePicker.svelte';

	let {
		selectedFile = $bindable(null),
		ondeleteclick
	}: {
		selectedFile?: string | null;
		ondeleteclick?: (path: string) => void;
	} = $props();
	let picker = $state<ReturnType<typeof OpfsFilePicker>>();

	export async function refresh() {
		await picker?.refresh();
	}

	function openFile(entry: FileTreeEntry) {
		return goto(resolve(`/opfs/edit-file?${new URLSearchParams({ file: entry.path })}`));
	}
</script>

<OpfsFilePicker
	bind:this={picker}
	bind:selectedFile
	onfileselect={openFile}
	{ondeleteclick}
	showDeleteButtons={Boolean(ondeleteclick)}
/>
