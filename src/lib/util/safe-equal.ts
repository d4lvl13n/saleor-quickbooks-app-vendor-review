import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. Returns false (without leaking length via
 * timing) when the inputs differ in length. Used for the admin secret check so
 * a `===` early-out can't be timed.
 */
export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a, "utf8");
	const bb = Buffer.from(b, "utf8");
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}
