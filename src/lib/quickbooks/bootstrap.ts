import { env } from "@/env";
import { acquireLock, refsLockKey, releaseLock } from "@/lib/store/locks";
import { getConnection } from "@/lib/store/qbo-connection";
import { getRefs, saveRefs, type QboRefs } from "@/lib/store/refs";
import { sleep } from "@/lib/util/sleep";
import { QboApiError, QboNotConnectedError, qboClient } from "./client";
import type { OrderMapRefs } from "./map-saleor-order";

const REFS_LOCK_TTL_S = 30;
const REFS_WAIT_MS = 250;
const REFS_WAIT_TRIES = 20; // ~5s waiting for a peer's bootstrap to land

function refsComplete(refs: QboRefs, needDeposit: boolean, needShipping: boolean): boolean {
	return Boolean(
		refs.customerId &&
			refs.itemPeptidesId &&
			refs.itemSuppliesId &&
			(!needDeposit || refs.depositAccountId) &&
			(!needShipping || refs.shippingItemId),
	);
}

function toMapRefs(refs: QboRefs): OrderMapRefs {
	// Guarded by refsComplete before every call site.
	return {
		customerRef: refs.customerId!,
		items: {
			peptides: refs.itemPeptidesId!,
			supplies: refs.itemSuppliesId!,
			shipping: refs.shippingItemId,
		},
		depositAccountRef: refs.depositAccountId,
	};
}

/**
 * Ensures the QuickBooks entities every order needs exist (create-or-get) and
 * caches their ids in Upstash, so steady-state order posting is a single API
 * call. Idempotent and safe to call on every webhook.
 *
 * The create path is serialized with a short Redis lock so two concurrent
 * cold-start webhooks can't each create a duplicate customer/item/account
 * (QuickBooks enforces name uniqueness and would 400 the loser).
 */
export async function ensureRefs(): Promise<OrderMapRefs> {
	const connection = await getConnection();
	if (!connection) throw new QboNotConnectedError();

	const needDeposit = Boolean(env.QBO_DEPOSIT_ACCOUNT);
	const needShipping = env.QBO_SHIPPING_ENABLED;
	const cached = await getRefs(connection.realmId);
	if (refsComplete(cached, needDeposit, needShipping)) return toMapRefs(cached);

	const lockKey = refsLockKey(connection.realmId);
	const gotLock = await acquireLock(lockKey, REFS_LOCK_TTL_S);

	if (!gotLock) {
		// A peer is bootstrapping — wait for the cached refs to be written.
		for (let i = 0; i < REFS_WAIT_TRIES; i++) {
			await sleep(REFS_WAIT_MS);
			const latest = await getRefs(connection.realmId);
			if (refsComplete(latest, needDeposit, needShipping)) return toMapRefs(latest);
		}
		throw new QboApiError("Timed out waiting for a peer QuickBooks ref bootstrap", 503);
	}

	try {
		// Re-read inside the lock: a peer may have finished just before we won it.
		const current = await getRefs(connection.realmId);
		if (refsComplete(current, needDeposit, needShipping)) return toMapRefs(current);

		const incomeAccountId =
			current.incomeAccountId ??
			(await qboClient.ensureAccount(env.QBO_INCOME_ACCOUNT, "Income", "SalesOfProductIncome"));

		const customerId = current.customerId ?? (await qboClient.ensureCustomer(env.QBO_CUSTOMER_NAME));
		const itemPeptidesId =
			current.itemPeptidesId ?? (await qboClient.ensureItem(env.QBO_ITEM_PEPTIDES, incomeAccountId));
		const itemSuppliesId =
			current.itemSuppliesId ?? (await qboClient.ensureItem(env.QBO_ITEM_SUPPLIES, incomeAccountId));

		let depositAccountId = current.depositAccountId;
		if (needDeposit && !depositAccountId && env.QBO_DEPOSIT_ACCOUNT) {
			depositAccountId = await qboClient.ensureAccount(env.QBO_DEPOSIT_ACCOUNT, "Bank", "Checking");
		}

		// Shipping books to its own income account so it shows separately on the P&L.
		let shippingIncomeAccountId = current.shippingIncomeAccountId;
		let shippingItemId = current.shippingItemId;
		if (needShipping && !shippingItemId) {
			shippingIncomeAccountId =
				shippingIncomeAccountId ??
				(await qboClient.ensureAccount(env.QBO_SHIPPING_INCOME_ACCOUNT, "Income", "ServiceFeeIncome"));
			shippingItemId = await qboClient.ensureItem(env.QBO_ITEM_SHIPPING, shippingIncomeAccountId);
		}

		const next: QboRefs = {
			customerId,
			itemPeptidesId,
			itemSuppliesId,
			incomeAccountId,
			depositAccountId,
			shippingItemId,
			shippingIncomeAccountId,
		};
		await saveRefs(connection.realmId, next);
		return toMapRefs(next);
	} finally {
		await releaseLock(lockKey);
	}
}
