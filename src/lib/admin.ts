import type { NextApiRequest, NextApiResponse } from "next";

import { requireAdminSecret } from "@/env";
import { safeEqual } from "@/lib/util/safe-equal";

/**
 * Gate an admin endpoint behind QBO_ADMIN_SECRET. The secret may be supplied as
 * `?secret=` (convenient for a one-time browser visit) or, preferably, the
 * `x-admin-secret` header (kept out of access logs / referrers). Comparison is
 * constant-time.
 *
 * Returns true when authorized. On failure it writes the response and returns
 * false, so callers do `if (!requireAdmin(req, res)) return;`.
 */
export function requireAdmin(req: NextApiRequest, res: NextApiResponse): boolean {
	let secret: string;
	try {
		secret = requireAdminSecret();
	} catch (error) {
		res.status(500).json({ error: error instanceof Error ? error.message : "config error" });
		return false;
	}

	const headerSecret = req.headers["x-admin-secret"];
	const provided =
		typeof req.query.secret === "string"
			? req.query.secret
			: typeof headerSecret === "string"
				? headerSecret
				: "";

	if (!safeEqual(provided, secret)) {
		res.status(401).json({ error: "unauthorized" });
		return false;
	}
	return true;
}
