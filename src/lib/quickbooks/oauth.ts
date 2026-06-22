import { env, requireQboOAuthConfig } from "@/env";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export class QboOAuthError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = "QboOAuthError";
	}
}

export interface TokenResult {
	accessToken: string;
	refreshToken: string;
	/** seconds */
	expiresIn: number;
	/** seconds */
	refreshExpiresIn: number;
}

export function buildAuthorizeUrl(state: string): string {
	const { clientId, redirectUri } = requireQboOAuthConfig();
	const params = new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		scope: env.QBO_SCOPES,
		redirect_uri: redirectUri,
		state,
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResult> {
	const { clientId, clientSecret } = requireQboOAuthConfig();
	const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: {
			Authorization: `Basic ${basic}`,
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body,
	});

	const text = await res.text();
	if (!res.ok) {
		throw new QboOAuthError(`QuickBooks token endpoint returned ${res.status}: ${text}`, res.status);
	}

	const json = JSON.parse(text) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		x_refresh_token_expires_in: number;
	};

	return {
		accessToken: json.access_token,
		refreshToken: json.refresh_token,
		expiresIn: json.expires_in,
		refreshExpiresIn: json.x_refresh_token_expires_in,
	};
}

export async function exchangeCode(code: string): Promise<TokenResult> {
	const { redirectUri } = requireQboOAuthConfig();
	return tokenRequest(
		new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
		}),
	);
}

export async function refreshTokens(refreshToken: string): Promise<TokenResult> {
	return tokenRequest(
		new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
	);
}
