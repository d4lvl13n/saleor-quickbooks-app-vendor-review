import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest } from "@saleor/app-sdk/types";

import packageJson from "../../../package.json";
import { orderFullyPaidWebhook } from "./webhooks/saleor/order-fully-paid";
import { orderRefundedWebhook } from "./webhooks/saleor/order-refunded";

export default createManifestHandler({
	async manifestFactory({ appBaseUrl }) {
		const iframeBaseUrl = process.env.APP_IFRAME_BASE_URL ?? appBaseUrl;
		const apiBaseUrl = process.env.APP_API_BASE_URL ?? appBaseUrl;

		const manifest: AppManifest = {
			name: "InfinityBio QuickBooks",
			id: "infinitybio.app.quickbooks",
			version: packageJson.version,
			appUrl: iframeBaseUrl,
			tokenTargetUrl: `${apiBaseUrl}/api/register`,
			author: "InfinityBio Labs",
			permissions: ["MANAGE_ORDERS", "HANDLE_PAYMENTS"],
			webhooks: [
				orderFullyPaidWebhook.getWebhookManifest(apiBaseUrl),
				orderRefundedWebhook.getWebhookManifest(apiBaseUrl),
			],
			extensions: [],
		};

		return manifest;
	},
});
