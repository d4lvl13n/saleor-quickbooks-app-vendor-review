import type { APL } from "@saleor/app-sdk/APL";
import { EnvAPL } from "@saleor/app-sdk/APL/env";
import { FileAPL } from "@saleor/app-sdk/APL/file";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";

import { env } from "@/env";

/**
 * APL = where the *Saleor* install token lives.
 *
 * EnvAPL on Vercel (one static token per project, no shared datastore) — this
 * deliberately avoids UpstashAPL, which keys auth records by saleorApiUrl alone
 * and lets co-located apps overwrite each other's tokens. The rotating
 * QuickBooks OAuth token is a separate concern and lives in Upstash via
 * `src/lib/store/*`, never in the APL.
 */
function buildApl(): APL {
	if (process.env.VERCEL === "1" || env.APL === "env") {
		return new EnvAPL({
			env: {
				token: process.env.SALEOR_APP_TOKEN ?? "",
				appId: process.env.SALEOR_APP_ID ?? "",
				saleorApiUrl: process.env.SALEOR_API_URL ?? "",
			},
			// Until the token is configured, print the auth data on install so it can
			// be copied from the logs into env. Auto-disables once the token is set.
			printAuthDataOnRegister: !process.env.SALEOR_APP_TOKEN,
		});
	}

	return new FileAPL({
		fileName: env.APL_FILE_PATH,
	});
}

export const saleorApp = new SaleorApp({
	apl: buildApl(),
});
