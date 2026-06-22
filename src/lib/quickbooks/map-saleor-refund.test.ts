import { describe, expect, it } from "vitest";

import { mapRefundToRefundReceipt } from "./map-saleor-refund";
import type { OrderMapRefs, SaleorOrderLineForQbo } from "./map-saleor-order";

const refs: OrderMapRefs = {
	customerRef: "1",
	items: { peptides: "10", supplies: "11" },
	depositAccountRef: "20",
};

const mixedLines: SaleorOrderLineForQbo[] = [
	{
		productName: "BPC-157",
		quantity: 1,
		totalPrice: { gross: { amount: 70 } },
		variant: { product: { category: { slug: "cytoprotective-peptides" } } },
	},
	{
		productName: "Supplies",
		quantity: 1,
		totalPrice: { gross: { amount: 35 } },
		variant: { product: { category: { slug: "supplies" } } },
	},
];

describe("mapRefundToRefundReceipt", () => {
	it("splits a full refund proportionally to the original sale", () => {
		const rr = mapRefundToRefundReceipt({
			amount: 105,
			currency: "USD",
			orderNumber: "1042",
			orderId: "T3JkZXI6YWJj",
			refs,
			lines: mixedLines,
			suppliesCategorySlug: "supplies",
			txnDate: "2026-05-31",
		});

		expect(rr.CustomerRef.value).toBe("1");
		expect(rr.TxnDate).toBe("2026-05-31");
		expect(rr.DepositToAccountRef?.value).toBe("20");
		const peptides = rr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "10");
		const supplies = rr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "11");
		expect(peptides?.Amount).toBe(70);
		expect(supplies?.Amount).toBe(35);
		expect(rr.Line.reduce((a, l) => a + l.Amount, 0)).toBe(105);
	});

	it("splits a partial refund in the same proportion", () => {
		const rr = mapRefundToRefundReceipt({
			amount: 15,
			currency: "USD",
			orderNumber: "1042",
			orderId: "T3JkZXI6YWJj",
			refs,
			lines: mixedLines,
		});
		const peptides = rr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "10");
		const supplies = rr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "11");
		expect(peptides?.Amount).toBe(10);
		expect(supplies?.Amount).toBe(5);
	});

	it("uses a single peptides line when the order had no supplies", () => {
		const rr = mapRefundToRefundReceipt({
			amount: 70,
			currency: "USD",
			orderNumber: "1043",
			orderId: "T3JkZXI6ZGVm",
			refs,
			lines: [mixedLines[0]!],
		});
		expect(rr.Line).toHaveLength(1);
		expect(rr.Line[0]?.SalesItemLineDetail.ItemRef.value).toBe("10");
		expect(rr.Line[0]?.Amount).toBe(70);
	});

	const shippingRefs: OrderMapRefs = {
		customerRef: "1",
		items: { peptides: "10", supplies: "11", shipping: "12" },
		depositAccountRef: "20",
	};

	it("splits a full refund across peptides, supplies and shipping", () => {
		// Original sale: peptides 70, supplies 35, shipping 15 → base 120.
		const rr = mapRefundToRefundReceipt({
			amount: 120,
			currency: "USD",
			orderNumber: "1044",
			orderId: "T3JkZXI6YWJj",
			refs: shippingRefs,
			lines: mixedLines,
			shipping: 15,
		});
		const peptides = rr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "10");
		const supplies = rr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "11");
		const shipping = rr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "12");
		expect(peptides?.Amount).toBe(70);
		expect(supplies?.Amount).toBe(35);
		expect(shipping?.Amount).toBe(15);
		expect(rr.Line.reduce((a, l) => a + l.Amount, 0)).toBe(120);
	});

	it("ignores shipping when no shipping item ref is present (disabled)", () => {
		const rr = mapRefundToRefundReceipt({
			amount: 105,
			currency: "USD",
			orderNumber: "1045",
			orderId: "T3JkZXI6YWJj",
			refs, // no items.shipping
			lines: mixedLines,
			shipping: 15,
		});
		expect(rr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "12")).toBeUndefined();
		expect(rr.Line.reduce((a, l) => a + l.Amount, 0)).toBe(105);
	});

	it("keeps refunded lines summing to the amount under uneven rounding", () => {
		// peptides 70, supplies 0, shipping 10 → base 80; partial refund 15.
		const rr = mapRefundToRefundReceipt({
			amount: 15,
			currency: "USD",
			orderNumber: "1046",
			orderId: "T3JkZXI6ZGVm",
			refs: shippingRefs,
			lines: [mixedLines[0]!],
			shipping: 10,
		});
		// No supplies line; peptides absorbs the rounding residual.
		expect(rr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "11")).toBeUndefined();
		expect(rr.Line.reduce((a, l) => a + l.Amount, 0)).toBe(15);
	});
});
