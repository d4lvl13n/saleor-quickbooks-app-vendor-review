import type { NextApiRequest, NextApiResponse } from "next";

import { env } from "@/env";
import { requireAdmin } from "@/lib/admin";
import { qboStorePrefix } from "@/lib/store/namespace";
import { listErroredOrders } from "@/lib/store/sync-store";

/**
 * Admin visibility: lists orders whose SalesReceipt failed to book and were
 * acked (4xx) so Saleor won't retry them. Use `/api/qbo/reset?orderId=…` to
 * clear a record after fixing the underlying issue, then redeliver from Saleor.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!requireAdmin(req, res)) return;

	const errors = await listErroredOrders();
	return res.status(200).json({
		environment: env.QBO_ENVIRONMENT,
		storePrefix: qboStorePrefix(),
		count: errors.length,
		errors,
	});
}
