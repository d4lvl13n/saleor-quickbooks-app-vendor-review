import { getRedis } from "./redis";
import { qboStoreKey } from "./namespace";

function connectionKey(): string {
	return qboStoreKey("connection");
}

/**
 * Persisted QuickBooks OAuth state. The refresh token ROTATES on every refresh
 * (Intuit re-issues it), so this record is rewritten each time — which is why
 * env-only storage cannot be used for QBO.
 */
export interface QboConnection {
	realmId: string;
	accessToken: string;
	refreshToken: string;
	/** epoch ms */
	accessTokenExpiresAt: number;
	/** epoch ms — refresh token validity (~100 days, resets on use) */
	refreshTokenExpiresAt: number;
	updatedAt: number;
}

export async function getConnection(): Promise<QboConnection | null> {
	return (await getRedis().get<QboConnection>(connectionKey())) ?? null;
}

export async function saveConnection(connection: QboConnection): Promise<void> {
	await getRedis().set(connectionKey(), connection);
}

export async function clearConnection(): Promise<void> {
	await getRedis().del(connectionKey());
}

// --- One-time OAuth CSRF state nonces ---

const STATE_TTL_SECONDS = 600;

function oauthStateKey(state: string): string {
	return qboStoreKey("oauth-state", state);
}

export async function rememberOAuthState(state: string): Promise<void> {
	await getRedis().set(oauthStateKey(state), 1, { ex: STATE_TTL_SECONDS });
}

/** Returns true if the state was present (and consumes it), false otherwise. */
export async function consumeOAuthState(state: string): Promise<boolean> {
	const existed = await getRedis().getdel(oauthStateKey(state));
	return existed !== null && existed !== undefined;
}
