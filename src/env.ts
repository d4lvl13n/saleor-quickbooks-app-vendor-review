import { z } from "zod";

const envSchema = z
	.object({
		// --- Saleor App SDK runtime config ---
		APP_API_BASE_URL: z.string().url().optional(),
		APP_IFRAME_BASE_URL: z.string().url().optional(),
		// Restricts which Saleor instance may install this app. Empty = allow any (dev only).
		SALEOR_API_URL: z.string().url().optional(),
		NEXT_PUBLIC_SALEOR_API_URL: z.string().url().optional(),
		// `file` for local dev, `env` for Vercel and any serverless host.
		APL: z.enum(["file", "env"]).default("file"),
		APL_FILE_PATH: z.string().optional(),
		// Required when APL=env. From Saleor Dashboard → Apps → app → Tokens.
		SALEOR_APP_TOKEN: z.string().min(1).optional(),
		SALEOR_APP_ID: z.string().min(1).optional(),

		// --- QuickBooks Online OAuth (Intuit Developer app) ---
		QBO_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
		QBO_CLIENT_ID: z.string().min(1).optional(),
		QBO_CLIENT_SECRET: z.string().min(1).optional(),
		// Must exactly match a redirect URI registered in the Intuit app.
		QBO_REDIRECT_URI: z.string().url().optional(),
		QBO_SCOPES: z.string().default("com.intuit.quickbooks.accounting"),
		QBO_MINOR_VERSION: z.string().default("73"),
		// Optional Redis key namespace when one Upstash DB is shared by multiple deployments.
		QBO_STORE_NAMESPACE: z
			.string()
			.regex(/^[A-Za-z0-9:_-]+$/)
			.optional(),

		// --- QuickBooks mapping config ---
		QBO_CUSTOMER_NAME: z.string().default("Online Sales"),
		QBO_ITEM_PEPTIDES: z.string().default("Peptides"),
		QBO_ITEM_SUPPLIES: z.string().default("Supplies"),
		QBO_INCOME_ACCOUNT: z.string().default("Sales of Product Income"),
		// Shipping: opt-in. When enabled, shipping is booked on its own SalesReceipt
		// line (its own income item/account) instead of being absorbed into Peptides.
		// Leave off until shipping is actually charged in Saleor.
		QBO_SHIPPING_ENABLED: z
			.enum(["true", "false"])
			.default("false")
			.transform((v) => v === "true"),
		QBO_ITEM_SHIPPING: z.string().default("Shipping"),
		QBO_SHIPPING_INCOME_ACCOUNT: z.string().default("Shipping Income"),
		// Optional bank/clearing account to deposit SalesReceipts into so a separate
		// Stripe→QBO payout reconciliation nets out. Omit → QBO "Undeposited Funds".
		QBO_DEPOSIT_ACCOUNT: z.string().optional(),
		// Saleor category slug whose lines book to the "Supplies" income item.
		QBO_SUPPLIES_CATEGORY_SLUG: z.string().default("supplies"),

		// --- Upstash Redis (QBO token + Saleor-order→QBO-doc id-map) ---
		UPSTASH_REDIS_REST_URL: z.string().url().optional(),
		UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

		// Shared secret gating the admin endpoints (connect/bootstrap/status/errors/reset).
		// Compared in constant time; use a long random value (32+ chars recommended).
		QBO_ADMIN_SECRET: z.string().min(16).optional(),

		LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
	});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	// Only *format* errors (bad URL, wrong enum) are fatal. Missing-but-required
	// secrets are NOT validated here on purpose — see warnDeployConfig below.
	// eslint-disable-next-line no-console
	console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
	throw new Error("Invalid environment variables; refusing to start.");
}

export const env = parsed.data;

/**
 * Warn (do NOT throw) about config that's needed for the app to fully function
 * once deployed. Throwing here would 500 the manifest/register endpoints — but
 * those MUST stay reachable so the app can be installed in the first place, and
 * `SALEOR_APP_TOKEN`/`SALEOR_APP_ID` are only obtained *by* installing. Each
 * endpoint lazily requires the specific secret it needs (see requireUpstash /
 * requireQboOAuthConfig / requireAdminSecret below), so a missing secret fails
 * only the relevant request with a clear error, not the whole app.
 */
function warnDeployConfig(data: z.infer<typeof envSchema>): void {
	const deployed = process.env.VERCEL === "1" || data.QBO_ENVIRONMENT === "production";
	if (!deployed) return;

	const missing = (
		[
			"QBO_CLIENT_ID",
			"QBO_CLIENT_SECRET",
			"QBO_REDIRECT_URI",
			"UPSTASH_REDIS_REST_URL",
			"UPSTASH_REDIS_REST_TOKEN",
			"QBO_ADMIN_SECRET",
			"SALEOR_API_URL",
		] as const
	).filter((field) => !data[field]);

	if (missing.length > 0) {
		// eslint-disable-next-line no-console
		console.warn(
			`[env] Config needed for full operation is missing: ${missing.join(", ")}. ` +
				"The manifest will still load, but the relevant endpoints will fail until these are set.",
		);
	}
	if (!data.SALEOR_APP_TOKEN || !data.SALEOR_APP_ID) {
		// eslint-disable-next-line no-console
		console.warn(
			"[env] SALEOR_APP_TOKEN/SALEOR_APP_ID not set yet. Install the app once — the auth data " +
				"is printed to the logs on register (printAuthDataOnRegister) — then set them and redeploy.",
		);
	}
}

warnDeployConfig(parsed.data);

/** Intuit API host — differs between sandbox and production. */
export const QBO_API_BASE =
	env.QBO_ENVIRONMENT === "production"
		? "https://quickbooks.api.intuit.com"
		: "https://sandbox-quickbooks.api.intuit.com";

export function requireQboOAuthConfig() {
	if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET || !env.QBO_REDIRECT_URI) {
		throw new Error(
			"QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI must be set to use the QuickBooks OAuth flow.",
		);
	}
	return {
		clientId: env.QBO_CLIENT_ID,
		clientSecret: env.QBO_CLIENT_SECRET,
		redirectUri: env.QBO_REDIRECT_URI,
	};
}

export function requireUpstash() {
	if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
		throw new Error(
			"UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set (QBO tokens + id-map persistence).",
		);
	}
	return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };
}

export function requireAdminSecret(): string {
	if (!env.QBO_ADMIN_SECRET) {
		throw new Error("QBO_ADMIN_SECRET must be set to gate the OAuth connect flow.");
	}
	return env.QBO_ADMIN_SECRET;
}

export function requireSaleorApiUrl(): string {
	const url = env.SALEOR_API_URL ?? env.NEXT_PUBLIC_SALEOR_API_URL;
	if (!url) {
		throw new Error(
			"SALEOR_API_URL (or NEXT_PUBLIC_SALEOR_API_URL) must be set so we can look up the installed Saleor's auth token.",
		);
	}
	return url;
}
