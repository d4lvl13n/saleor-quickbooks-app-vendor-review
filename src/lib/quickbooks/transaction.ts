/**
 * Saleor often carries two transaction items per order: a placeholder created
 * by the checkout flow (psp reference prefixed `saleor-tx:`) and the real
 * processor charge (e.g. a Stripe `order_…` / `pi_…` reference). Refunds land
 * on the real one. We always want the real processor reference.
 */

const PLACEHOLDER_PREFIX = "saleor-tx:";

export interface SaleorPspTransaction {
	pspReference: string | null;
}

export function isRealPspReference(ref: string | null | undefined): boolean {
	return Boolean(ref && !ref.startsWith(PLACEHOLDER_PREFIX));
}

/** Returns the first real processor psp reference, or null if there is none. */
export function selectChargePspReference(
	transactions: ReadonlyArray<SaleorPspTransaction>,
): string | null {
	const real = transactions.find((t) => isRealPspReference(t.pspReference));
	return real?.pspReference ?? null;
}
