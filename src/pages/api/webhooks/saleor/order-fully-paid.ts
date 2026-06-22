import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import gql from "graphql-tag";

import { env } from "@/env";
import { saleorApp } from "@/saleor-app";
import { createLogger } from "@/lib/logger";
import { ensureRefs } from "@/lib/quickbooks/bootstrap";
import { QboApiError, QboNotConnectedError, qboClient } from "@/lib/quickbooks/client";
import {
	groupByKind,
	mapSaleorOrderToSalesReceipt,
	round2,
	type SaleorOrderForQbo,
} from "@/lib/quickbooks/map-saleor-order";
import { selectChargePspReference } from "@/lib/quickbooks/transaction";
import { persistWithRetry } from "@/lib/store/persist";
import {
	claimOrder,
	getOrderSync,
	releaseOrderClaim,
	saveOrderSync,
} from "@/lib/store/sync-store";

/** Anything above this (in currency units) between order total and line revenue
 *  means tax/shipping/discount is present — out of Phase-1 scope. */
const DRIFT_TOLERANCE = 0.01;

const logger = createLogger("webhook:order-fully-paid");

const SUBSCRIPTION = gql`
	subscription OrderFullyPaid {
		event {
			... on OrderFullyPaid {
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
					}
				}
			}
		}
	}
`;

interface OrderFullyPaidPayload {
	order: (SaleorOrderForQbo & { transactions: Array<{ pspReference: string | null }> }) | null;
}

export const orderFullyPaidWebhook = new SaleorAsyncWebhook<OrderFullyPaidPayload>({
	name: "InfinityBio QuickBooks — Order Fully Paid",
	webhookPath: "api/webhooks/saleor/order-fully-paid",
	event: "ORDER_FULLY_PAID",
	apl: saleorApp.apl,
	query: SUBSCRIPTION,
});

export default orderFullyPaidWebhook.createHandler(async (req, res, ctx) => {
	const order = ctx.payload.order;
	if (!order) {
		logger.warn("ORDER_FULLY_PAID received without an order payload");
		return res.status(200).json({ skipped: "no_order_payload" });
	}

	const total = order.total.gross.amount;
	if (total <= 0) {
		logger.info("Skipping zero-total order", { saleorOrderId: order.id });
		return res.status(200).json({ skipped: "zero_total" });
	}

	// Durable idempotency — never double-post a SalesReceipt.
	const existing = await getOrderSync(order.id);
	if (existing?.status === "synced") {
		logger.info("Order already synced", { saleorOrderId: order.id, qboDocId: existing.qboDocId });
		return res.status(200).json({ ok: true, duplicate: true, qboDocId: existing.qboDocId });
	}

	const claimed = await claimOrder(order.id);
	if (!claimed) {
		logger.info("Concurrent delivery in flight — skipping", { saleorOrderId: order.id });
		return res.status(200).json({ skipped: "concurrent_delivery" });
	}

	const pspReference = selectChargePspReference(order.transactions);

	// Whatever the mapper can't account for (always tax/discount; plus shipping when
	// QBO_SHIPPING_ENABLED is off) gets absorbed into Peptides income. Warn loudly so
	// that accounting assumption stays visible rather than silent.
	const lineRevenue = (() => {
		const g = groupByKind(order.lines, env.QBO_SUPPLIES_CATEGORY_SLUG);
		return round2(g.peptides + g.supplies);
	})();
	const shippingCharge = round2(order.shippingPrice?.gross?.amount ?? 0);
	const accounted = env.QBO_SHIPPING_ENABLED ? round2(lineRevenue + shippingCharge) : lineRevenue;
	if (Math.abs(total - accounted) > DRIFT_TOLERANCE) {
		logger.warn(
			`Order total exceeds accounted revenue — tax/discount${env.QBO_SHIPPING_ENABLED ? "" : "/shipping"} present; delta booked to Peptides income. Verify accounting treatment.`,
			{
				saleorOrderId: order.id,
				total,
				lineRevenue,
				shippingCharge,
				shippingEnabled: env.QBO_SHIPPING_ENABLED,
				delta: round2(total - accounted),
			},
		);
	}

	try {
		const refs = await ensureRefs();
		const salesReceipt = mapSaleorOrderToSalesReceipt(order, refs, {
			suppliesCategorySlug: env.QBO_SUPPLIES_CATEGORY_SLUG,
			pspReference,
		});
		const created = await qboClient.createSalesReceipt(salesReceipt);

		// The document now exists in QuickBooks. We MUST record that, or a Saleor
		// retry would create a duplicate. Retry the write; if it still fails, ack
		// (200) so Saleor stops retrying and log loudly for manual reconciliation.
		const persisted = await persistWithRetry(logger, "order sync record", () =>
			saveOrderSync({
				saleorOrderId: order.id,
				number: order.number,
				status: "synced",
				qboDocId: created.id,
				pspReference,
				total,
				currency: order.total.gross.currency,
				syncedAt: Date.now(),
			}),
		);

		if (!persisted) {
			logger.error(
				"CRITICAL: SalesReceipt created in QuickBooks but its sync record could not be persisted. Acking to avoid a duplicate — reconcile this order manually.",
				{ saleorOrderId: order.id, number: order.number, qboDocId: created.id },
			);
			return res.status(200).json({ ok: true, qboDocId: created.id, persisted: false });
		}

		logger.info("SalesReceipt created", { saleorOrderId: order.id, qboDocId: created.id });
		return res.status(200).json({ ok: true, qboDocId: created.id });
	} catch (error) {
		await releaseOrderClaim(order.id);

		if (error instanceof QboNotConnectedError) {
			logger.error("QuickBooks not connected — returning 503 so Saleor retries", {
				saleorOrderId: order.id,
			});
			return res.status(503).json({ ok: false, reason: "qbo_not_connected" });
		}

		if (error instanceof QboApiError) {
			// 4xx = our payload is bad → ack so Saleor stops retrying, record the error.
			// 5xx = transient → 502 so Saleor retries per its policy.
			const ack = error.status >= 400 && error.status < 500;
			if (ack) {
				await saveOrderSync({
					saleorOrderId: order.id,
					number: order.number,
					status: "error",
					pspReference,
					total,
					currency: order.total.gross.currency,
					error: error.message,
					syncedAt: Date.now(),
				});
			}
			logger.error("QuickBooks API rejected the SalesReceipt", {
				saleorOrderId: order.id,
				status: error.status,
				message: error.message,
				ack,
			});
			return res.status(ack ? 200 : 502).json({ ok: false, reason: error.message, ackedDespiteFailure: ack });
		}

		logger.error("Unhandled error in ORDER_FULLY_PAID handler", {
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
