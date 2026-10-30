<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';

	/**
	 * @type {{
	 *   children: Snippet
	 *   drag?: Snippet
	 *   classs?: string
	 *   delay?: number
	 *   ondragstart?: (event: DragEvent) => void
	 *   setDragElement: (clientX: number, clientY: number, preview: Snippet, rect: DOMRect) => void
	 * }}
	 */
	const { children, drag, classs = '', delay, ondragstart, setDragElement } = $props();

	/** @type {HTMLDivElement} */
	let container: HTMLDivElement | undefined = $state();

	/** @type {ReturnType<typeof setTimeout> | 0} */
	let timeout: ReturnType<typeof setTimeout> | 0;
	onDestroy(() => {
		if (timeout) clearTimeout(timeout);
	});

	/** @param {{ clientX: number, clientY: number }} event */
	const handle_mousedown = ({ clientX, clientY }: { clientX: number; clientY: number }) => {
		if (delay) timeout = setTimeout(start_drag, delay, clientX, clientY);
		else start_drag(clientX, clientY);
	};
	const handle_mouseup = () => {
		if (timeout) {
			clearTimeout(timeout);
			timeout = 0;
		}
	};
	/** @param {TouchEvent} event */
	const handle_touchstart = (event: TouchEvent) => {
		handle_mousedown(event.touches[0]);
	};
	const handle_touchend = () => {
		handle_mouseup();
	};
	/**
	 * @param {number} client_x
	 * @param {number} client_y
	 */
	const start_drag = (client_x: number, client_y: number) => {
		if (!container) return;
		timeout = 0;
		setDragElement(client_x, client_y, drag ?? children, container.getBoundingClientRect());
		ondragstart?.(new DragEvent('dragstart'));
	};
</script>

<svelte:window
	onmouseup={handle_mouseup}
	ontouchend={handle_touchend}
	ontouchcancel={handle_touchend}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={container}
	class={classs}
	style="touch-action:none;user-select:none;width:fit-content;"
	onmousedown={handle_mousedown}
	ontouchstart={handle_touchstart}
>
	{@render children()}
</div>
