/** Promise-based sleep used by the lock/refresh backoff loops. */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
