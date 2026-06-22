import { describe, expect, it } from "vitest";

import {
	mapSaleorOrderToSalesReceipt,
	type OrderMapRefs,
	type SaleorOrderForQbo,
} from "./map-saleor-order";

const refs: OrderMapRefs = {
	customerRef: "1",
	items: { peptides: "10", supplies: "11" },
	depositAccountRef: "20",
};

function order(partial: Partial<SaleorOrderForQbo> = {}): SaleorOrderForQbo {
	return {
		id: Buffer.from("Order:9339cd37-e730-4467-835e-ea02f27e3001", "utf8").toString("base64"),
		number: "1042",
		created: "2026-05-30T12:00:00Z",
		total: { gross: { amount: 105, currency: "USD" } },
		lines: [
			{
				productName: "BPC-157",
				quantity: 1,
				totalPrice: { gross: { amount: 70 } },
				variant: { product: { category: { slug: "cytoprotective-peptides" } } },
			},
			{
				productName: "Bacteriostatic Water",
				quantity: 1,
				totalPrice: { gross: { amount: 15 } },
				variant: { product: { category: { slug: "supplies" } } },
			},
			{
				productName: "Empty Vials",
				quantity: 1,
				totalPrice: { gross: { amount: 20 } },
				variant: { product: { category: { slug: "supplies" } } },
			},
		],
		...partial,
	};
}

describe("mapSaleorOrderToSalesReceipt", () => {
	it("splits revenue into Peptides and Supplies income items", () => {
		const sr = mapSaleorOrderToSalesReceipt(order(), refs, {
			suppliesCategorySlug: "supplies",
			pspReference: "order_01K8ZQ7STRIPE",
		});

		expect(sr.CustomerRef.value).toBe("1");
		expect(sr.CurrencyRef?.value).toBe("USD");
		expect(sr.DepositToAccountRef?.value).toBe("20");
		expect(sr.TxnDate).toBe("2026-05-30");
		expect(sr.Line).toHaveLength(2);

		const peptides = sr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "10");
		const supplies = sr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "11");
		expect(peptides?.Amount).toBe(70);
		expect(supplies?.Amount).toBe(35);

		// Receipt total matches the Saleor order total.
		const sum = sr.Line.reduce((acc, l) => acc + l.Amount, 0);
		expect(sum).toBe(105);

		expect(sr.PrivateNote).toContain("#1042");
		expect(sr.PrivateNote).toContain("order_01K8ZQ7STRIPE");
		expect(sr.PrivateNote).toContain("9339cd37-e730-4467-835e-ea02f27e3001");
	});

	it("produces a single line for a peptides-only order", () => {
		const sr = mapSaleorOrderToSalesReceipt(
			order({
				total: { gross: { amount: 70, currency: "USD" } },
				lines: [
					{
						productName: "BPC-157",
						quantity: 1,
						totalPrice: { gross: { amount: 70 } },
						variant: { product: { category: { slug: "cytoprotective-peptides" } } },
					},
				],
			}),
			refs,
		);
		expect(sr.Line).toHaveLength(1);
		expect(sr.Line[0]?.SalesItemLineDetail.ItemRef.value).toBe("10");
		expect(sr.Line[0]?.Amount).toBe(70);
	});

	it("reconciles line drift so the receipt total equals the order total", () => {
		// Lines sum to 95 but the order total says 100 → the $5 delta lands on peptides.
		const sr = mapSaleorOrderToSalesReceipt(
			order({
				total: { gross: { amount: 100, currency: "USD" } },
				lines: [
					{
						productName: "BPC-157",
						quantity: 1,
						totalPrice: { gross: { amount: 95 } },
						variant: { product: { category: { slug: "cytoprotective-peptides" } } },
					},
				],
			}),
			refs,
		);
		const sum = sr.Line.reduce((acc, l) => acc + l.Amount, 0);
		expect(sum).toBe(100);
	});

	it("omits DepositToAccountRef when not configured", () => {
		const sr = mapSaleorOrderToSalesReceipt(order(), {
			customerRef: "1",
			items: { peptides: "10", supplies: "11" },
		});
		expect(sr.DepositToAccountRef).toBeUndefined();
	});

	it("books shipping on its own line when a shipping item ref is present", () => {
		const sr = mapSaleorOrderToSalesReceipt(
			order({
				total: { gross: { amount: 115, currency: "USD" } },
				shippingPrice: { gross: { amount: 10 } },
			}),
			{ ...refs, items: { peptides: "10", supplies: "11", shipping: "12" } },
			{ suppliesCategorySlug: "supplies" },
		);
		const peptides = sr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "10");
		const supplies = sr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "11");
		const shipping = sr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "12");
		expect(peptides?.Amount).toBe(70);
		expect(supplies?.Amount).toBe(35);
		expect(shipping?.Amount).toBe(10);
		expect(sr.Line.reduce((a, l) => a + l.Amount, 0)).toBe(115);
	});

	it("absorbs shipping into Peptides when no shipping item ref is present (disabled)", () => {
		const sr = mapSaleorOrderToSalesReceipt(
			order({
				total: { gross: { amount: 115, currency: "USD" } },
				shippingPrice: { gross: { amount: 10 } },
			}),
			refs, // no items.shipping
			{ suppliesCategorySlug: "supplies" },
		);
		expect(sr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "12")).toBeUndefined();
		const peptides = sr.Line.find((l) => l.SalesItemLineDetail.ItemRef.value === "10");
		// 70 products + 10 unaccounted shipping → 80 on peptides.
		expect(peptides?.Amount).toBe(80);
		expect(sr.Line.reduce((a, l) => a + l.Amount, 0)).toBe(115);
	});
});
