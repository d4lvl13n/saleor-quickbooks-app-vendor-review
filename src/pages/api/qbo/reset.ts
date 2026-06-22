import type { NextApiRequest, NextApiResponse } from "next";

import { requireAdmin } from "@/lib/admin";
import { createLogger } from "@/lib/logger";
import { deleteOrderSync, deleteRefundState } from "@/lib/store/sync-store";

const logger = createLogger("qbo:reset");

/**
 * Admin recovery: clears the stored sync record for one order so a Saleor
 * webhook redelivery reprocesses it. Use after resolving whatever caused an
 * `error` (e.g. a fixed mapping/config). POST to avoid accidental link visits.
 *
 *   POST /api/qbo/reset?orderId=<saleorOrderId>&scope=order|refund
 *   header: x-admin-secret: <QBO_ADMIN_SECRET>
 *
 * NOTE: only clears this app's idempotency record — it does NOT delete anything
 * already created in QuickBooks. Verify QBO before redelivering to avoid a
 * duplicate document.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!requireAdmin(req, res)) return;

	if (req.method !== "POST") {
		res.setHeader("Allow", "POST");
		return res.status(405).json({ error: "method_not_allowed" });
	}

	const orderId = typeof req.query.orderId === "string" ? req.query.orderId : "";
	if (!orderId) {
		return res.status(400).json({ error: "orderId query param is required" });
	}

	const scope = req.query.scope === "refund" ? "refund" : "order";
	if (scope === "refund") {
		await deleteRefundState(orderId);
	} else {
		await deleteOrderSync(orderId);
	}

	logger.warn("Admin cleared sync record", { orderId, scope });
	return res.status(200).json({ ok: true, orderId, scope, cleared: true });
}
