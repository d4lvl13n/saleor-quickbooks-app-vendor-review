import { shortenSaleorOrderId } from "@/lib/saleor/order-id";
import {
	groupByKind,
	itemLine,
	round2,
	type OrderMapRefs,
	type SaleorOrderLineForQbo,
} from "./map-saleor-order";
import type { QboSalesItemLine, RefundReceiptInput } from "./types";

export interface RefundMapParams {
	/** The incremental amount being refunded now (delta since last sync). */
	amount: number;
	currency: string;
	orderNumber: string;
	orderId: string;
	refs: OrderMapRefs;
	/** Original order lines — used to split the refund across income buckets. */
	lines: ReadonlyArray<SaleorOrderLineForQbo>;
	/** Original order shipping charge — split proportionally when shipping is enabled. */
	shipping?: number;
	suppliesCategorySlug?: string;
	pspReference?: string | null;
	txnDate?: string;
}

/**
 * Builds a RefundReceipt for a (partial or full) refund, splitting the refunded
 * amount across the Peptides/Supplies/Shipping income items in the same
 * proportion as the original sale. Peptides absorbs any rounding residual so the
 * refunded lines always sum exactly to the refund amount.
 */
export function mapRefundToRefundReceipt(params: RefundMapParams): RefundReceiptInput {
	const suppliesSlug = params.suppliesCategorySlug ?? "supplies";
	const { peptides, supplies } = groupByKind(params.lines, suppliesSlug);
	// Shipping only participates when enabled (the ref exists) and was charged.
	const shipping =
		params.refs.items.shipping && (params.shipping ?? 0) > 0 ? round2(params.shipping!) : 0;
	const base = round2(peptides + supplies + shipping);

	const amount = round2(params.amount);
	// Supplies/shipping by ratio; peptides is the catch-all remainder.
	const suppliesAmount = base > 0 ? round2(amount * (supplies / base)) : 0;
	const shippingAmount = base > 0 ? round2(amount * (shipping / base)) : 0;
	const peptidesAmount = round2(amount - suppliesAmount - shippingAmount);

	const lines: QboSalesItemLine[] = [];
	if (peptidesAmount > 0) lines.push(itemLine(params.refs.items.peptides, peptidesAmount, "Peptides refund"));
	if (suppliesAmount > 0) lines.push(itemLine(params.refs.items.supplies, suppliesAmount, "Supplies refund"));
	if (shippingAmount > 0 && params.refs.items.shipping) {
		lines.push(itemLine(params.refs.items.shipping, shippingAmount, "Shipping refund"));
	}
	if (lines.length === 0) lines.push(itemLine(params.refs.items.peptides, amount, "Refund"));

	const memoParts = [`Refund for Saleor order #${params.orderNumber} (${shortenSaleorOrderId(params.orderId)})`];
	if (params.pspReference) memoParts.push(params.pspReference);

	return {
		CustomerRef: { value: params.refs.customerRef },
		Line: lines,
		...(params.txnDate ? { TxnDate: params.txnDate } : {}),
		CurrencyRef: { value: params.currency },
		PrivateNote: memoParts.join(" · "),
		...(params.refs.depositAccountRef
			? { DepositToAccountRef: { value: params.refs.depositAccountRef } }
			: {}),
	};
}
