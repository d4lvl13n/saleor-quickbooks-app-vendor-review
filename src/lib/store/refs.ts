import { getRedis } from "./redis";
import { qboStoreKey } from "./namespace";

function refsKey(realmId: string): string {
	return qboStoreKey("realm", realmId, "refs");
}

/**
 * Cached QuickBooks entity ids the app reuses on every order so it doesn't
 * re-query/re-create the "Online Sales" customer, the generic income items and
 * the income/deposit accounts each time.
 */
export interface QboRefs {
	customerId?: string;
	itemPeptidesId?: string;
	itemSuppliesId?: string;
	incomeAccountId?: string;
	depositAccountId?: string;
	/** Only populated when QBO_SHIPPING_ENABLED. */
	shippingItemId?: string;
	shippingIncomeAccountId?: string;
}

export async function getRefs(realmId: string): Promise<QboRefs> {
	return (await getRedis().get<QboRefs>(refsKey(realmId))) ?? {};
}

export async function saveRefs(realmId: string, refs: QboRefs): Promise<void> {
	await getRedis().set(refsKey(realmId), refs);
}

export async function clearRefs(realmId: string): Promise<void> {
	await getRedis().del(refsKey(realmId));
}
