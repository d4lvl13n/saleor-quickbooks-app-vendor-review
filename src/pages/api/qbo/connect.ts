import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import { requireAdmin } from "@/lib/admin";
import { createLogger } from "@/lib/logger";
import { buildAuthorizeUrl } from "@/lib/quickbooks/oauth";
import { rememberOAuthState } from "@/lib/store/qbo-connection";

const logger = createLogger("qbo:connect");

/**
 * One-time admin action: starts the QuickBooks OAuth consent flow.
 * Gate with ?secret=$QBO_ADMIN_SECRET so randoms can't initiate a connect.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!requireAdmin(req, res)) return;

	const state = randomUUID();
	await rememberOAuthState(state);
	const authorizeUrl = buildAuthorizeUrl(state);
	logger.info("Redirecting to QuickBooks consent");
	return res.redirect(authorizeUrl);
}
