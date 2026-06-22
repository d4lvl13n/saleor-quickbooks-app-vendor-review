import { describe, expect, it } from "vitest";

import { shortenSaleorOrderId } from "./order-id";

describe("shortenSaleorOrderId", () => {
	it("extracts the inner UUID from a base64 Saleor order id", () => {
		const inner = "9339cd37-e730-4467-835e-ea02f27e3001";
		const saleorId = Buffer.from(`Order:${inner}`, "utf8").toString("base64");
		expect(shortenSaleorOrderId(saleorId)).toBe(inner);
	});

	it("passes through a value that is not a base64 Saleor id", () => {
		expect(shortenSaleorOrderId("already-short")).toBe("already-short");
	});
});
