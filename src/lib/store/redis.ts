import { Redis } from "@upstash/redis";

import { requireUpstash } from "@/env";

let client: Redis | null = null;

/**
 * Lazily-constructed Upstash Redis client. Lazy on purpose: importing a store
 * module must not require env (keeps unit tests that import mappers pure).
 */
export function getRedis(): Redis {
	if (client) return client;
	const { url, token } = requireUpstash();
	client = new Redis({ url, token });
	return client;
}
