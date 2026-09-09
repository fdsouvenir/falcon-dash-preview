// Retire in-flight reads and selected secrets independently of DOM rendering.
export class ViewLifetime {
	constructor(signal) {
		this.signal = signal;
		this.revision = 0;
		this.dead = false;
		this.cleanups = new Set();
		signal?.addEventListener('abort', () => this.dispose(), { once: true });
	}
	ticket() {
		const revision = ++this.revision;
		return () => !this.dead && !this.signal?.aborted && revision === this.revision;
	}
	clear() {
		this.revision++;
		for (const clear of this.cleanups) clear();
	}
	own(clear) {
		this.cleanups.add(clear);
		return () => this.cleanups.delete(clear);
	}
	dispose() {
		this.dead = true;
		this.clear();
		this.cleanups.clear();
	}
}
export function message(error) {
	const code = error?.details?.code ?? error?.error?.details?.code;
	return code === 'version_conflict' ||
		/version_conflict|version changed|Work changed/i.test(error?.message ?? '')
		? 'This record changed. Your input is preserved; refresh the record and review before reapplying.'
		: code === 'vault_locked'
			? 'Protected storage did not start. Check the Gateway service health for the Vault failure.'
			: 'This operation is unavailable or not authorized. Your input is preserved. Retry after checking connection and access.';
}
