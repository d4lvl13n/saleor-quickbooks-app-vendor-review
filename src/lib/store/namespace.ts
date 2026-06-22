import { env } from "@/env";

interface QboStoreNamespaceEnv {
	QBO_ENVIRONMENT: "sandbox" | "production";
	QBO_STORE_NAMESPACE?: string;
}

export function buildQboStorePrefix(config: QboStoreNamespaceEnv): string {
	const namespace = config.QBO_STORE_NAMESPACE?.trim() || config.QBO_ENVIRONMENT;
	return `qbo:${namespace}`;
}

export function qboStorePrefix(): string {
	return buildQboStorePrefix(env);
}

export function qboStoreKey(...parts: string[]): string {
	return [qboStorePrefix(), ...parts].join(":");
}
