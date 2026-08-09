/** One owner for aborting superseded UI requests and rejecting stale completions. */
export class LatestRequestGate {
	private current: AbortController | null = null;

	start(): AbortController {
		this.current?.abort();
		this.current = new AbortController();
		return this.current;
	}

	isCurrent(controller: AbortController): boolean {
		return this.current === controller && !controller.signal.aborted;
	}

	finish(controller: AbortController): boolean {
		if (this.current !== controller) return false;
		this.current = null;
		return !controller.signal.aborted;
	}

	cancel(): void {
		this.current?.abort();
		this.current = null;
	}
}
