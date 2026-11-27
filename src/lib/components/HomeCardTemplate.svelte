<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		icon?: Snippet;
		title?: Snippet;
		menu?: Snippet;
		header?: Snippet;
		content?: Snippet;
		footer?: Snippet;
		headerStyle?: string;
	};
	let { icon, title, menu, header, content, footer, headerStyle }: Props = $props();
</script>

<article class="card bg-base-100 min-w-0 rounded-lg">
	<div class="card-body p-0">
		<div
			class="flex rounded-t-lg px-3 py-2 text-lg"
			class:bg-primary={!headerStyle}
			style={headerStyle}
		>
			{#if header}{@render header()}{/if}
			{#if icon}{@render icon()}{/if}
			<span class="grow pl-3">
				{#if title}{@render title()}{/if}
			</span>
			{#if menu}
				{@render menu()}
			{/if}
		</div>
		<section class="px-1 py-2">
			{#if content}{@render content()}{/if}
		</section>
		{#if footer}
			<footer class="card-actions justify-center p-0 pt-2">
				{@render footer()}
			</footer>
		{/if}
	</div>
</article>
