import type { Logger } from "@/lib/logger";
import { sleep } from "@/lib/util/sleep";

/**
 * Retry a Redis write a few times before giving up. After a financial document
 * is created in QuickBooks the caller MUST be able to record that it happened —
 * otherwise a Saleor retry could double-post. This buys resilience against
 * transient Upstash blips; if it still fails the caller acks loudly so Saleor
 * does not retry into a duplicate.
 *
 * Returns true if the write eventually succeeded.
 */
export async function persistWithRetry(
	logger: Pick<Logger, "warn">,
	label: string,
	write: () => Promise<void>,
	{ attempts = 4, baseDelayMs = 150 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<boolean> {
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			await write();
			return true;
		} catch (error) {
			logger.warn(`Failed to persist ${label}`, {
				attempt,
				attempts,
				error: error instanceof Error ? error.message : String(error),
			});
			if (attempt < attempts) await sleep(baseDelayMs * attempt);
		}
	}
	return false;
}
