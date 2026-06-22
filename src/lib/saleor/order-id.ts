/**
 * Saleor exposes order IDs as base64("Order:<uuid>"). For human-readable memos
 * and stable store keys we sometimes want just the inner identifier.
 */

const SALEOR_ID_PREFIX = "Order:";

export function shortenSaleorOrderId(saleorOrderId: string): string {
	const decoded = safeBase64Decode(saleorOrderId);
	if (decoded && decoded.startsWith(SALEOR_ID_PREFIX)) {
		return decoded.slice(SALEOR_ID_PREFIX.length);
	}
	return saleorOrderId;
}

function safeBase64Decode(value: string): string | null {
	if (!/^[A-Za-z0-9+/]+=*$/.test(value)) return null;
	try {
		const decoded = Buffer.from(value, "base64").toString("utf8");
		const reencoded = Buffer.from(decoded, "utf8").toString("base64");
		return reencoded === value ? decoded : null;
	} catch {
		return null;
	}
}
