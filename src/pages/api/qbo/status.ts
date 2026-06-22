import type { NextApiRequest, NextApiResponse } from "next";

import { env } from "@/env";
import { requireAdmin } from "@/lib/admin";
import { getConnection } from "@/lib/store/qbo-connection";
import { qboStorePrefix } from "@/lib/store/namespace";
import { getRefs } from "@/lib/store/refs";

/** Admin health check: is QuickBooks connected, and what entity refs are cached. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!requireAdmin(req, res)) return;

	const connection = await getConnection();
	const refs = connection ? await getRefs(connection.realmId) : {};

	return res.status(200).json({
		environment: env.QBO_ENVIRONMENT,
		storePrefix: qboStorePrefix(),
		connected: Boolean(connection),
		realmId: connection?.realmId ?? null,
		accessTokenExpiresAt: connection?.accessTokenExpiresAt ?? null,
		refreshTokenExpiresAt: connection?.refreshTokenExpiresAt ?? null,
		refs,
	});
}
