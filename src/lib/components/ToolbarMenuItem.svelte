<script lang="ts">
	import type { ResolvedPathname } from '$app/types';

	type Props = {
		targetNav?: ResolvedPathname;
		text?: string;
		Icon?: any;
		onclick?: () => void;
	};
	let { targetNav, text, Icon, onclick }: Props = $props();
</script>

<div>
	{#if targetNav}
		<a class="btn btn-primary flex w-full flex-row border-0" href={targetNav} onclick={onclick}>
			<span class="grow text-start">{text}</span>
			<span class="badge bg-primary/80 border-0">
				<Icon />
			</span>
		</a>
	{:else}
		<button type="button" class="btn btn-primary flex w-full flex-row border-0" onclick={onclick}>
			<span class="grow text-start">{text}</span>
			<span class="badge bg-primary/80 border-0">
				<Icon />
			</span>
		</button>
	{/if}
</div>
