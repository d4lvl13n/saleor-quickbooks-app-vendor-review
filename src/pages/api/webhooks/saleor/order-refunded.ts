import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import gql from "graphql-tag";

import { env } from "@/env";
import { saleorApp } from "@/saleor-app";
import { createLogger } from "@/lib/logger";
import { ensureRefs } from "@/lib/quickbooks/bootstrap";
import { QboApiError, QboNotConnectedError, qboClient } from "@/lib/quickbooks/client";
import { round2, type SaleorOrderLineForQbo } from "@/lib/quickbooks/map-saleor-order";
import { mapRefundToRefundReceipt } from "@/lib/quickbooks/map-saleor-refund";
import { isRealPspReference, selectChargePspReference } from "@/lib/quickbooks/transaction";
import { persistWithRetry } from "@/lib/store/persist";
import {
	claimRefund,
	getOrderSync,
	getRefundState,
	releaseRefundClaim,
	saveRefundState,
	type RefundState,
} from "@/lib/store/sync-store";

const logger = createLogger("webhook:order-refunded");

const SUBSCRIPTION = gql`
	subscription OrderRefunded {
		event {
			... on OrderRefunded {
				order {
					id
					number
					created
					total {
						gross {
							amount
							currency
						}
					}
					shippingPrice {
						gross {
							amount
						}
					}
					lines {
						productName
						quantity
						totalPrice {
							gross {
								amount
							}
						}
						variant {
							product {
								category {
									slug
								}
							}
						}
					}
					transactions {
						pspReference
						refundedAmount {
							amount
							currency
						}
					}
				}
			}
		}
	}
`;

interface RefundTransaction {
	pspReference: string | null;
	refundedAmount: { amount: number; currency: string } | null;
}

interface OrderRefundedPayload {
	order: {
		id: string;
		number: string;
		created: string;
		total: { gross: { amount: number; currency: string } };
		shippingPrice?: { gross: { amount: number } } | null;
		lines: SaleorOrderLineForQbo[];
		transactions: RefundTransaction[];
	} | null;
}

export const orderRefundedWebhook = new SaleorAsyncWebhook<OrderRefundedPayload>({
	name: "InfinityBio QuickBooks — Order Refunded",
	webhookPath: "api/webhooks/saleor/order-refunded",
	event: "ORDER_REFUNDED",
	apl: saleorApp.apl,
	query: SUBSCRIPTION,
});

export default orderRefundedWebhook.createHandler(async (req, res, ctx) => {
	const order = ctx.payload.order;
	if (!order) {
		logger.warn("ORDER_REFUNDED received without an order payload");
		return res.status(200).json({ skipped: "no_order_payload" });
	}

	const currency = order.total.gross.currency;
	// Cumulative refunded value lives on the real processor transaction(s).
	const currentRefunded = round2(
		order.transactions
			.filter((t) => isRealPspReference(t.pspReference))
			.reduce((sum, t) => sum + (t.refundedAmount?.amount ?? 0), 0),
	);

	const claimed = await claimRefund(order.id);
	if (!claimed) {
		logger.info("Concurrent refund delivery in flight — skipping", { saleorOrderId: order.id });
		return res.status(200).json({ skipped: "concurrent_delivery" });
	}

	const pspReference = selectChargePspReference(order.transactions);

	try {
		const state = await getRefundState(order.id);
		const previouslySynced = state?.refundedTotal ?? 0;
		const delta = round2(currentRefunded - previouslySynced);

		if (delta <= 0.005) {
			await releaseRefundClaim(order.id);
			logger.info("No new refund amount to post", {
				saleorOrderId: order.id,
				currentRefunded,
				previouslySynced,
			});
			return res.status(200).json({ skipped: "no_new_refund" });
		}

		// A refund with no recorded SalesReceipt books a negative entry against a
		// sale QuickBooks never saw. Still post it (the money did move) but warn so
		// it gets reconciled.
		const sale = await getOrderSync(order.id);
		if (!sale || sale.status !== "synced") {
			logger.warn(
				"Refund received for an order with no recorded SalesReceipt — booking the refund anyway. Reconcile manually.",
				{ saleorOrderId: order.id, saleStatus: sale?.status ?? "none" },
			);
		}

		const refs = await ensureRefs();
		const refundReceipt = mapRefundToRefundReceipt({
			amount: delta,
			currency,
			orderNumber: order.number,
			orderId: order.id,
			refs,
			lines: order.lines,
			shipping: order.shippingPrice?.gross?.amount ?? 0,
			suppliesCategorySlug: env.QBO_SUPPLIES_CATEGORY_SLUG,
			pspReference,
		});
		const created = await qboClient.createRefundReceipt(refundReceipt);

		// The refund now exists in QuickBooks. Persisting the new cumulative total
		// is what stops a duplicate delta from posting on a Saleor retry, so retry
		// the write hard; if it still fails, ack (200) and DO NOT release the claim
		// — let it expire so a near-term retry can't recompute the same delta.
		const nextState: RefundState = {
			saleorOrderId: order.id,
			refundedTotal: currentRefunded,
			currency,
			receipts: [
				...(state?.receipts ?? []),
				{ qboDocId: created.id, amount: delta, at: Date.now() },
			],
			updatedAt: Date.now(),
		};
		const persisted = await persistWithRetry(logger, "refund state", () =>
			saveRefundState(nextState),
		);

		if (!persisted) {
			logger.error(
				"CRITICAL: RefundReceipt created in QuickBooks but refund state could not be persisted. Acking to avoid a double refund — reconcile this order manually.",
				{ saleorOrderId: order.id, qboDocId: created.id, amount: delta },
			);
			return res.status(200).json({ ok: true, qboDocId: created.id, amount: delta, persisted: false });
		}
		await releaseRefundClaim(order.id);

		logger.info("RefundReceipt created", {
			saleorOrderId: order.id,
			qboDocId: created.id,
			amount: delta,
		});
		return res.status(200).json({ ok: true, qboDocId: created.id, amount: delta });
	} catch (error) {
		await releaseRefundClaim(order.id);

		if (error instanceof QboNotConnectedError) {
			logger.error("QuickBooks not connected — returning 503 so Saleor retries", {
				saleorOrderId: order.id,
			});
			return res.status(503).json({ ok: false, reason: "qbo_not_connected" });
		}
		if (error instanceof QboApiError) {
			const ack = error.status >= 400 && error.status < 500;
			logger.error("QuickBooks API rejected the RefundReceipt", {
				saleorOrderId: order.id,
				status: error.status,
				message: error.message,
				ack,
			});
			return res
				.status(ack ? 200 : 502)
				.json({ ok: false, reason: error.message, ackedDespiteFailure: ack });
		}
		logger.error("Unhandled error in ORDER_REFUNDED handler", {
			saleorOrderId: order.id,
			error: error instanceof Error ? error.message : String(error),
		});
		return res.status(500).json({ ok: false });
	}
});

export const config = {
	api: {
		bodyParser: false,
	},
};
