import { getRedis } from "./redis";
import { qboStoreKey, qboStorePrefix } from "./namespace";

/**
 * Durable idempotency + audit for everything the app posts to QuickBooks.
 * Financial documents must never double-post, so the record of "already synced"
 * lives in Upstash (survives across Vercel lambda instances), not in memory.
 */

const CLAIM_TTL_SECONDS = 120;

function orderKey(saleorOrderId: string): string {
	return qboStoreKey("order", saleorOrderId);
}

function refundKey(saleorOrderId: string): string {
	return qboStoreKey("refund", saleorOrderId);
}

function orderClaimKey(saleorOrderId: string): string {
	return qboStoreKey("claim", "order", saleorOrderId);
}

function refundClaimKey(saleorOrderId: string): string {
	return qboStoreKey("claim", "refund", saleorOrderId);
}

export interface OrderSync {
	saleorOrderId: string;
	number: string;
	status: "synced" | "error";
	qboDocId?: string;
	pspReference?: string | null;
	total?: number;
	currency?: string;
	error?: string;
	syncedAt: number;
}

export async function getOrderSync(saleorOrderId: string): Promise<OrderSync | null> {
	return (await getRedis().get<OrderSync>(orderKey(saleorOrderId))) ?? null;
}

export async function saveOrderSync(record: OrderSync): Promise<void> {
	await getRedis().set(orderKey(record.saleorOrderId), record);
}

export async function deleteOrderSync(saleorOrderId: string): Promise<void> {
	await getRedis().del(orderKey(saleorOrderId));
}

/**
 * Lists order-sync records currently in the `error` state so an operator can see
 * which paid orders failed to book (4xx errors are acked, so Saleor won't retry
 * them). SCAN-based; bounded by `limit`.
 */
export async function listErroredOrders(limit = 100): Promise<OrderSync[]> {
	const redis = getRedis();
	const match = `${qboStorePrefix()}:order:*`;
	const errored: OrderSync[] = [];
	let cursor = "0";
	do {
		const [next, keys] = await redis.scan(cursor, { match, count: 200 });
		cursor = next;
		for (const key of keys) {
			if (errored.length >= limit) break;
			const record = await redis.get<OrderSync>(key);
			if (record && record.status === "error") errored.push(record);
		}
	} while (cursor !== "0" && errored.length < limit);
	return errored;
}

/**
 * Best-effort short-lived lock so two concurrent deliveries of the same order
 * don't both create a SalesReceipt. Returns true if the caller acquired it.
 */
export async function claimOrder(saleorOrderId: string): Promise<boolean> {
	const res = await getRedis().set(orderClaimKey(saleorOrderId), 1, {
		nx: true,
		ex: CLAIM_TTL_SECONDS,
	});
	return res === "OK";
}

export async function releaseOrderClaim(saleorOrderId: string): Promise<void> {
	await getRedis().del(orderClaimKey(saleorOrderId));
}

export interface RefundState {
	saleorOrderId: string;
	/** Cumulative amount already pushed to QBO as RefundReceipts. */
	refundedTotal: number;
	currency?: string;
	receipts: Array<{ qboDocId: string; amount: number; at: number }>;
	updatedAt: number;
}

export async function getRefundState(saleorOrderId: string): Promise<RefundState | null> {
	return (await getRedis().get<RefundState>(refundKey(saleorOrderId))) ?? null;
}

export async function saveRefundState(state: RefundState): Promise<void> {
	await getRedis().set(refundKey(state.saleorOrderId), state);
}

export async function deleteRefundState(saleorOrderId: string): Promise<void> {
	await getRedis().del(refundKey(saleorOrderId));
}

/**
 * Short-lived lock around refund delta calculation + QBO post. Without this, two
 * duplicate Saleor deliveries can both see the same previous state and double-post.
 */
export async function claimRefund(saleorOrderId: string): Promise<boolean> {
	const res = await getRedis().set(refundClaimKey(saleorOrderId), 1, {
		nx: true,
		ex: CLAIM_TTL_SECONDS,
	});
	return res === "OK";
}

export async function releaseRefundClaim(saleorOrderId: string): Promise<void> {
	await getRedis().del(refundClaimKey(saleorOrderId));
}
