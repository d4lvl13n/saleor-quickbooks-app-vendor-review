import { shortenSaleorOrderId } from "@/lib/saleor/order-id";
import type { QboSalesItemLine, SalesReceiptInput } from "./types";

/** Minimal Saleor order shape consumed by the QuickBooks mappers. Hand-typed for
 *  Phase 1; switch to graphql-codegen once the webhook contract stabilises. */
export interface SaleorOrderLineForQbo {
	productName: string;
	quantity: number;
	totalPrice: { gross: { amount: number } };
	variant: { product: { category: { slug: string } | null } | null } | null;
}

export interface SaleorOrderForQbo {
	id: string;
	number: string;
	created: string;
	total: { gross: { amount: number; currency: string } };
	lines: SaleorOrderLineForQbo[];
	/** Order-level shipping charge (separate from line totals). */
	shippingPrice?: { gross: { amount: number } } | null;
}

/** Resolved QuickBooks ids the mapper needs (from bootstrap/ensureRefs). */
export interface OrderMapRefs {
	customerRef: string;
	/** `shipping` is present only when QBO_SHIPPING_ENABLED. */
	items: { peptides: string; supplies: string; shipping?: string };
	depositAccountRef?: string;
}

export interface OrderMapOptions {
	suppliesCategorySlug?: string;
	/** Real processor reference (Stripe), for the memo. */
	pspReference?: string | null;
}

export function round2(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function itemLine(itemRef: string, amount: number, description: string): QboSalesItemLine {
	return {
		DetailType: "SalesItemLineDetail",
		Amount: round2(amount),
		Description: description,
		SalesItemLineDetail: { ItemRef: { value: itemRef } },
	};
}

/** Splits order line revenue into the two generic income buckets. */
export function groupByKind(
	lines: ReadonlyArray<SaleorOrderLineForQbo>,
	suppliesCategorySlug: string,
): { peptides: number; supplies: number } {
	let peptides = 0;
	let supplies = 0;
	for (const line of lines) {
		const slug = line.variant?.product?.category?.slug ?? null;
		const amount = line.totalPrice.gross.amount;
		if (slug === suppliesCategorySlug) supplies += amount;
		else peptides += amount;
	}
	return { peptides: round2(peptides), supplies: round2(supplies) };
}

export function mapSaleorOrderToSalesReceipt(
	order: SaleorOrderForQbo,
	refs: OrderMapRefs,
	options: OrderMapOptions = {},
): SalesReceiptInput {
	const suppliesSlug = options.suppliesCategorySlug ?? "supplies";
	const total = round2(order.total.gross.amount);

	let { peptides, supplies } = groupByKind(order.lines, suppliesSlug);

	// Book shipping on its own line only when shipping is enabled (the ref exists)
	// and the order actually carries a shipping charge. When disabled, shipping is
	// left in the reconciliation delta below (absorbed into Peptides, as before).
	const shippingCharge = round2(order.shippingPrice?.gross?.amount ?? 0);
	const shipping = refs.items.shipping && shippingCharge > 0 ? shippingCharge : 0;

	// Defensive reconciliation: products + booked shipping should equal the order
	// total. Any remaining delta (tax/discount, or shipping when disabled) is dumped
	// onto the peptides line so the receipt total always matches Saleor.
	const accounted = round2(peptides + supplies + shipping);
	if (accounted !== total) {
		peptides = round2(peptides + (total - accounted));
	}

	const lines: QboSalesItemLine[] = [];
	if (peptides > 0) lines.push(itemLine(refs.items.peptides, peptides, "Peptides"));
	if (supplies > 0) lines.push(itemLine(refs.items.supplies, supplies, "Supplies"));
	if (shipping > 0 && refs.items.shipping) {
		lines.push(itemLine(refs.items.shipping, shipping, "Shipping"));
	}
	// Total > 0 but nothing bucketed (shouldn't happen post-reconcile) → one line.
	if (lines.length === 0 && total > 0) {
		lines.push(itemLine(refs.items.peptides, total, "Peptides"));
	}

	const memoParts = [`Saleor order #${order.number} (${shortenSaleorOrderId(order.id)})`];
	if (options.pspReference) memoParts.push(options.pspReference);

	return {
		CustomerRef: { value: refs.customerRef },
		Line: lines,
		TxnDate: order.created ? order.created.slice(0, 10) : undefined,
		CurrencyRef: { value: order.total.gross.currency },
		PrivateNote: memoParts.join(" · "),
		...(refs.depositAccountRef ? { DepositToAccountRef: { value: refs.depositAccountRef } } : {}),
	};
}
