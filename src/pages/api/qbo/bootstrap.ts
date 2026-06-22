import type { NextApiRequest, NextApiResponse } from "next";

import { env } from "@/env";
import { requireAdmin } from "@/lib/admin";
import { ensureRefs } from "@/lib/quickbooks/bootstrap";
import { QboNotConnectedError } from "@/lib/quickbooks/client";
import { createLogger } from "@/lib/logger";
import { getConnection } from "@/lib/store/qbo-connection";
import { qboStorePrefix } from "@/lib/store/namespace";

const logger = createLogger("qbo:bootstrap");

/**
 * Admin-only preflight endpoint. It verifies the QBO OAuth connection and
 * creates/loads the customer, account and item refs before live order webhooks.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!requireAdmin(req, res)) return;

	try {
		const refs = await ensureRefs();
		const connection = await getConnection();
		logger.info("QuickBooks bootstrap completed", { realmId: connection?.realmId });
		return res.status(200).json({
			ok: true,
			environment: env.QBO_ENVIRONMENT,
			storePrefix: qboStorePrefix(),
			realmId: connection?.realmId ?? null,
			refs,
		});
	} catch (error) {
		if (error instanceof QboNotConnectedError) {
			return res.status(503).json({ ok: false, reason: "qbo_not_connected" });
		}
		logger.error("QuickBooks bootstrap failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		return res
			.status(500)
			.json({ ok: false, reason: error instanceof Error ? error.message : "bootstrap_failed" });
	}
}
