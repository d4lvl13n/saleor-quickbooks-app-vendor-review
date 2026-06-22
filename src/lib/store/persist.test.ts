import { describe, expect, it, vi } from "vitest";

import { persistWithRetry } from "./persist";

const noopLogger = { warn: () => {} };

describe("persistWithRetry", () => {
	it("returns true and writes once when the write succeeds first try", async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const ok = await persistWithRetry(noopLogger, "thing", write, { baseDelayMs: 1 });
		expect(ok).toBe(true);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it("retries and eventually succeeds", async () => {
		const write = vi
			.fn()
			.mockRejectedValueOnce(new Error("blip"))
			.mockRejectedValueOnce(new Error("blip"))
			.mockResolvedValue(undefined);
		const ok = await persistWithRetry(noopLogger, "thing", write, { baseDelayMs: 1 });
		expect(ok).toBe(true);
		expect(write).toHaveBeenCalledTimes(3);
	});

	it("returns false after exhausting all attempts", async () => {
		const write = vi.fn().mockRejectedValue(new Error("down"));
		const warn = vi.fn();
		const ok = await persistWithRetry({ warn }, "thing", write, { attempts: 3, baseDelayMs: 1 });
		expect(ok).toBe(false);
		expect(write).toHaveBeenCalledTimes(3);
		expect(warn).toHaveBeenCalledTimes(3);
	});
});
