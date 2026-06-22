import { describe, expect, it } from "vitest";

import { safeEqual } from "./safe-equal";

describe("safeEqual", () => {
	it("is true for identical strings", () => {
		expect(safeEqual("a-very-long-admin-secret", "a-very-long-admin-secret")).toBe(true);
	});

	it("is false for different strings of equal length", () => {
		expect(safeEqual("abcdef", "abcxef")).toBe(false);
	});

	it("is false for different lengths without throwing", () => {
		expect(safeEqual("short", "longer-value")).toBe(false);
		expect(safeEqual("", "x")).toBe(false);
	});

	it("is true for two empty strings", () => {
		expect(safeEqual("", "")).toBe(true);
	});
});
