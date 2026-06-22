import { describe, expect, it } from "vitest";

import { isRealPspReference, selectChargePspReference } from "./transaction";

describe("selectChargePspReference", () => {
	it("picks the real processor reference over the saleor-tx placeholder", () => {
		const txns = [
			{ pspReference: "saleor-tx:9f2c-placeholder" },
			{ pspReference: "order_01K8ZQ7M9F3STRIPEREF" },
		];
		expect(selectChargePspReference(txns)).toBe("order_01K8ZQ7M9F3STRIPEREF");
	});

	it("ignores order regardless — placeholder is skipped even if listed second", () => {
		const txns = [
			{ pspReference: "order_01K8ZQ7M9F3STRIPEREF" },
			{ pspReference: "saleor-tx:placeholder" },
		];
		expect(selectChargePspReference(txns)).toBe("order_01K8ZQ7M9F3STRIPEREF");
	});

	it("returns null when only a placeholder exists", () => {
		expect(selectChargePspReference([{ pspReference: "saleor-tx:only" }])).toBeNull();
	});

	it("returns null for an empty list or null references", () => {
		expect(selectChargePspReference([])).toBeNull();
		expect(selectChargePspReference([{ pspReference: null }])).toBeNull();
	});
});

describe("isRealPspReference", () => {
	it("is false for placeholders and empty values", () => {
		expect(isRealPspReference("saleor-tx:x")).toBe(false);
		expect(isRealPspReference(null)).toBe(false);
		expect(isRealPspReference(undefined)).toBe(false);
	});
	it("is true for a real reference", () => {
		expect(isRealPspReference("re_3Tbyy5abc")).toBe(true);
	});
});
