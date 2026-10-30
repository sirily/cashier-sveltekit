/** Latest-request-only state, shared by the two posting reports. */
export class ReportRequest<T> {
	value = $state<T | null>(null);
	error = $state<string | null>(null);
	pending = $state(true);
	private generation = 0;

	cancel() {
		this.generation++;
		this.value = null;
		this.error = null;
		this.pending = true;
	}

	async run(task: () => Promise<T>, isCurrent: () => boolean) {
		this.cancel();
		const generation = this.generation;
		try {
			const value = await task();
			if (generation === this.generation && isCurrent()) {
				this.value = value;
				this.pending = false;
			}
		} catch (error) {
			if (generation === this.generation && isCurrent()) {
				this.error = error instanceof Error ? error.message : String(error);
				this.pending = false;
			}
		}
	}
}
