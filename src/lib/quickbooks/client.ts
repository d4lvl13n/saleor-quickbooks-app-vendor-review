import { env, QBO_API_BASE } from "@/env";
import { createLogger } from "@/lib/logger";
import { acquireLock, refreshLockKey, releaseLock } from "@/lib/store/locks";
import { getConnection, saveConnection, type QboConnection } from "@/lib/store/qbo-connection";
import { sleep } from "@/lib/util/sleep";
import { refreshTokens } from "./oauth";
import {
	qboEntityResponseSchema,
	qboFaultSchema,
	qboQueryResponseSchema,
	type RefundReceiptInput,
	type SalesReceiptInput,
} from "./types";

const logger = createLogger("qbo:client");
const REQUEST_TIMEOUT_MS = 15_000;
const ACCESS_TOKEN_SKEW_MS = 60_000;
const REFRESH_LOCK_TTL_S = 30;
const REFRESH_WAIT_MS = 250;
const REFRESH_WAIT_TRIES = 16; // ~4s waiting for a peer's refresh to land

export class QboNotConnectedError extends Error {
	constructor() {
		super("QuickBooks is not connected. Run the /api/qbo/connect OAuth flow first.");
		this.name = "QboNotConnectedError";
	}
}

export class QboApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly raw?: unknown,
	) {
		super(message);
		this.name = "QboApiError";
	}
}

function applyTokens(conn: QboConnection, t: Awaited<ReturnType<typeof refreshTokens>>): QboConnection {
	const now = Date.now();
	return {
		...conn,
		accessToken: t.accessToken,
		refreshToken: t.refreshToken,
		accessTokenExpiresAt: now + t.expiresIn * 1000,
		refreshTokenExpiresAt: now + t.refreshExpiresIn * 1000,
		updatedAt: now,
	};
}

function tokenIsFresh(conn: QboConnection): boolean {
	return Date.now() < conn.accessTokenExpiresAt - ACCESS_TOKEN_SKEW_MS;
}

async function getAccessContext(forceRefresh = false): Promise<{ token: string; realmId: string }> {
	const conn = await getConnection();
	if (!conn) throw new QboNotConnectedError();

	if (!forceRefresh && tokenIsFresh(conn)) {
		return { token: conn.accessToken, realmId: conn.realmId };
	}

	// Intuit rotates the refresh token on every use, so two concurrent refreshes
	// would invalidate each other. Serialize them with a short Redis lock.
	const lockKey = refreshLockKey(conn.realmId);
	const gotLock = await acquireLock(lockKey, REFRESH_LOCK_TTL_S);

	if (!gotLock) {
		// A peer is already refreshing — wait for the rotated token to be persisted.
		for (let i = 0; i < REFRESH_WAIT_TRIES; i++) {
			await sleep(REFRESH_WAIT_MS);
			const latest = await getConnection();
			if (latest && tokenIsFresh(latest)) {
				return { token: latest.accessToken, realmId: latest.realmId };
			}
		}
		// Holder didn't finish in time — surface as transient so the caller retries.
		throw new QboApiError("Timed out waiting for a peer QuickBooks token refresh", 503);
	}

	try {
		// Re-read inside the lock: a peer may have just refreshed before we won it.
		const latest = (await getConnection()) ?? conn;
		if (!forceRefresh && tokenIsFresh(latest)) {
			return { token: latest.accessToken, realmId: latest.realmId };
		}
		logger.info("Refreshing QuickBooks access token", { realmId: latest.realmId, forceRefresh });
		const refreshed = await refreshTokens(latest.refreshToken);
		const updated = applyTokens(latest, refreshed);
		// Persist immediately — the refresh token rotates and the old one is now invalid.
		await saveConnection(updated);
		return { token: updated.accessToken, realmId: updated.realmId };
	} finally {
		await releaseLock(lockKey);
	}
}

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function qboRequest(
	path: string,
	{ method = "GET", body }: { method?: "GET" | "POST"; body?: unknown } = {},
	retryOn401 = true,
): Promise<unknown> {
	const { token, realmId } = await getAccessContext();
	const sep = path.includes("?") ? "&" : "?";
	const url = `${QBO_API_BASE}/v3/company/${realmId}/${path}${sep}minorversion=${env.QBO_MINOR_VERSION}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				...(body !== undefined ? { "Content-Type": "application/json" } : {}),
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});

		if (res.status === 401 && retryOn401) {
			logger.warn("QuickBooks returned 401 — forcing token refresh and retrying once");
			await getAccessContext(true);
			return qboRequest(path, { method, body }, false);
		}

		const text = await res.text();
		const json = text ? safeJsonParse(text) : null;

		if (!res.ok) {
			const fault = qboFaultSchema.safeParse(json);
			const message = fault.success
				? fault.data.Fault.Error.map((e) => e.Detail || e.Message || e.code || "error").join("; ")
				: `QuickBooks HTTP ${res.status} ${res.statusText}`;
			logger.warn("QuickBooks API error", { url, status: res.status, message });
			throw new QboApiError(message, res.status, json);
		}

		return json;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new QboApiError(`QuickBooks request timed out after ${REQUEST_TIMEOUT_MS}ms`, 504);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

function esc(value: string): string {
	return value.replace(/'/g, "''");
}

async function query(statement: string) {
	const raw = await qboRequest(`query?query=${encodeURIComponent(statement)}`);
	const parsed = qboQueryResponseSchema.safeParse(raw);
	if (!parsed.success) throw new QboApiError("Unrecognized QuickBooks query response", 502, raw);
	return parsed.data.QueryResponse;
}

export const qboClient = {
	async createSalesReceipt(input: SalesReceiptInput): Promise<{ id: string; docNumber?: string }> {
		const raw = await qboRequest("salesreceipt", { method: "POST", body: input });
		const parsed = qboEntityResponseSchema.safeParse(raw);
		const sr = parsed.success ? parsed.data.SalesReceipt : undefined;
		if (!sr) throw new QboApiError("Unexpected create-SalesReceipt response shape", 502, raw);
		return { id: sr.Id, docNumber: sr.DocNumber };
	},

	async createRefundReceipt(input: RefundReceiptInput): Promise<{ id: string; docNumber?: string }> {
		const raw = await qboRequest("refundreceipt", { method: "POST", body: input });
		const parsed = qboEntityResponseSchema.safeParse(raw);
		const rr = parsed.success ? parsed.data.RefundReceipt : undefined;
		if (!rr) throw new QboApiError("Unexpected create-RefundReceipt response shape", 502, raw);
		return { id: rr.Id, docNumber: rr.DocNumber };
	},

	async ensureCustomer(displayName: string): Promise<string> {
		const found = await query(`select Id, DisplayName from Customer where DisplayName = '${esc(displayName)}'`);
		const existing = found.Customer?.[0]?.Id;
		if (existing) return existing;
		const raw = await qboRequest("customer", { method: "POST", body: { DisplayName: displayName } });
		const parsed = qboEntityResponseSchema.safeParse(raw);
		const id = parsed.success ? parsed.data.Customer?.Id : undefined;
		if (!id) throw new QboApiError("Could not create Customer", 502, raw);
		return id;
	},

	async ensureAccount(name: string, accountType: string, accountSubType?: string): Promise<string> {
		const found = await query(`select Id, Name from Account where Name = '${esc(name)}'`);
		const existing = found.Account?.[0]?.Id;
		if (existing) return existing;
		const raw = await qboRequest("account", {
			method: "POST",
			body: { Name: name, AccountType: accountType, ...(accountSubType ? { AccountSubType: accountSubType } : {}) },
		});
		const parsed = qboEntityResponseSchema.safeParse(raw);
		const id = parsed.success ? parsed.data.Account?.Id : undefined;
		if (!id) throw new QboApiError(`Could not create Account "${name}"`, 502, raw);
		return id;
	},

	async ensureItem(name: string, incomeAccountId: string): Promise<string> {
		const found = await query(`select Id, Name from Item where Name = '${esc(name)}'`);
		const existing = found.Item?.[0]?.Id;
		if (existing) return existing;
		const raw = await qboRequest("item", {
			method: "POST",
			body: { Name: name, Type: "Service", IncomeAccountRef: { value: incomeAccountId } },
		});
		const parsed = qboEntityResponseSchema.safeParse(raw);
		const id = parsed.success ? parsed.data.Item?.Id : undefined;
		if (!id) throw new QboApiError(`Could not create Item "${name}"`, 502, raw);
		return id;
	},
};
