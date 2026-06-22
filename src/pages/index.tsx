import type { NextPage } from "next";
import Head from "next/head";

const HomePage: NextPage = () => {
	return (
		<>
			<Head>
				<title>InfinityBio QuickBooks</title>
			</Head>
			<main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 760 }}>
				<h1>InfinityBio × QuickBooks Online</h1>
				<p>
					This Saleor app posts each paid order to QuickBooks Online as a <strong>SalesReceipt</strong>{" "}
					and each refund as a <strong>RefundReceipt</strong>, against a single &ldquo;Online
					Sales&rdquo; customer with generic income items. There is no UI to configure — it runs via
					webhooks.
				</p>
				<h2>Setup</h2>
				<ol>
					<li>Install the app in the Saleor Dashboard (it registers the ORDER_FULLY_PAID and ORDER_REFUNDED webhooks).</li>
					<li>
						Connect QuickBooks once: open <code>/api/qbo/connect?secret=$QBO_ADMIN_SECRET</code> and
						complete the Intuit consent screen.
					</li>
					<li>
						Verify with <code>/api/qbo/status?secret=$QBO_ADMIN_SECRET</code>.
					</li>
				</ol>
				<p>
					Inspect <code>/api/manifest</code> to see the registered webhooks.
				</p>
			</main>
		</>
	);
};

export default HomePage;
