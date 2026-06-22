import { describe, expect, it } from "vitest";

import { buildQboStorePrefix } from "./namespace";

describe("buildQboStorePrefix", () => {
	it("defaults to the QuickBooks environment", () => {
		expect(buildQboStorePrefix({ QBO_ENVIRONMENT: "sandbox" })).toBe("qbo:sandbox");
		expect(buildQboStorePrefix({ QBO_ENVIRONMENT: "production" })).toBe("qbo:production");
	});

	it("uses an explicit namespace when one is configured", () => {
		expect(
			buildQboStorePrefix({
				QBO_ENVIRONMENT: "production",
				QBO_STORE_NAMESPACE: "infinitybio-prod",
			}),
		).toBe("qbo:infinitybio-prod");
	});

	it("ignores an all-whitespace namespace", () => {
		expect(
			buildQboStorePrefix({
				QBO_ENVIRONMENT: "sandbox",
				QBO_STORE_NAMESPACE: "  ",
			}),
		).toBe("qbo:sandbox");
	});
});
