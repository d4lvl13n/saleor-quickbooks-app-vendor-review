import { qboStoreKey } from "./namespace";
import { getRedis } from "./redis";

/**
 * Short-lived distributed locks (Redis SET NX EX). Used to serialize operations
 * that read-modify-write shared QuickBooks state across Vercel lambda instances:
 * token refresh (the refresh token rotates) and the cold-start ref bootstrap
 * (avoid creating duplicate QBO customer/items/accounts).
 */

/** Returns true if the lock was acquired. */
export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
	const res = await getRedis().set(key, 1, { nx: true, ex: ttlSeconds });
	return res === "OK";
}

export async function releaseLock(key: string): Promise<void> {
	await getRedis().del(key);
}

export function refreshLockKey(realmId: string): string {
	return qboStoreKey("lock", "refresh", realmId);
}

export function refsLockKey(realmId: string): string {
	return qboStoreKey("lock", "refs", realmId);
}
