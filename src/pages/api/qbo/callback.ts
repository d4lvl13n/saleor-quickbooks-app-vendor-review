import type { NextApiRequest, NextApiResponse } from "next";

import { createLogger } from "@/lib/logger";
import { exchangeCode } from "@/lib/quickbooks/oauth";
import { consumeOAuthState, saveConnection } from "@/lib/store/qbo-connection";

const logger = createLogger("qbo:callback");

/** Intuit redirects here with ?code, ?realmId, ?state after the user consents. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const code = typeof req.query.code === "string" ? req.query.code : null;
	const realmId = typeof req.query.realmId === "string" ? req.query.realmId : null;
	const state = typeof req.query.state === "string" ? req.query.state : null;

	if (!code || !realmId || !state) {
		return res.status(400).send("Missing code, realmId or state.");
	}

	const validState = await consumeOAuthState(state);
	if (!validState) {
		return res.status(400).send("Invalid or expired OAuth state. Restart the connect flow.");
	}

	try {
		const tokens = await exchangeCode(code);
		const now = Date.now();
		await saveConnection({
			realmId,
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			accessTokenExpiresAt: now + tokens.expiresIn * 1000,
			refreshTokenExpiresAt: now + tokens.refreshExpiresIn * 1000,
			updatedAt: now,
		});
		logger.info("QuickBooks connected", { realmId });
		return res
			.status(200)
			.send("QuickBooks connected successfully. You can close this window.");
	} catch (error) {
		logger.error("OAuth code exchange failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		return res.status(500).send("Failed to exchange the QuickBooks authorization code.");
	}
}
