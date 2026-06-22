import { z } from "zod";

// ── Request payloads (what we POST to QuickBooks) ──

export interface QboRef {
	value: string;
	name?: string;
}

export interface QboSalesItemLine {
	DetailType: "SalesItemLineDetail";
	Amount: number;
	Description?: string;
	SalesItemLineDetail: {
		ItemRef: QboRef;
	};
}

export interface SalesReceiptInput {
	CustomerRef: QboRef;
	Line: QboSalesItemLine[];
	TxnDate?: string;
	PrivateNote?: string;
	CurrencyRef?: QboRef;
	DepositToAccountRef?: QboRef;
}

export interface RefundReceiptInput {
	CustomerRef: QboRef;
	Line: QboSalesItemLine[];
	TxnDate?: string;
	PrivateNote?: string;
	CurrencyRef?: QboRef;
	DepositToAccountRef?: QboRef;
}

// ── Response parsing (what we read back) ──

const createdEntity = z.object({ Id: z.string(), DocNumber: z.string().optional() });

export const qboEntityResponseSchema = z.object({
	SalesReceipt: createdEntity.optional(),
	RefundReceipt: createdEntity.optional(),
	Customer: z.object({ Id: z.string() }).optional(),
	Item: z.object({ Id: z.string() }).optional(),
	Account: z.object({ Id: z.string() }).optional(),
});

export const qboQueryResponseSchema = z.object({
	QueryResponse: z
		.object({
			Customer: z.array(z.object({ Id: z.string(), DisplayName: z.string().optional() })).optional(),
			Item: z.array(z.object({ Id: z.string(), Name: z.string().optional() })).optional(),
			Account: z.array(z.object({ Id: z.string(), Name: z.string().optional() })).optional(),
		})
		.default({}),
});

export const qboFaultSchema = z.object({
	Fault: z.object({
		Error: z.array(
			z.object({
				Message: z.string().optional(),
				Detail: z.string().optional(),
				code: z.string().optional(),
			}),
		),
		type: z.string().optional(),
	}),
});
