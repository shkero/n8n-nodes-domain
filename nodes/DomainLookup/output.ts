import type { NormalizedDomain } from './domainUtils';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LookupSource {
	protocol: 'rdap' | 'whois';
	type: 'authoritative' | 'fallback';
	url: string;
	fetchedAt: string;
}

export interface DomainLookupOutput {
	asciiDomain: string;
	publicSuffix: string;
	isRegistered: boolean | null;
	status: string[];
	dates: {
		registeredAt: string | null;
		expiresAt: string | null;
		lastChangedAt: string | null;
		dataUpdatedAt: string | null;
	};
	expiry: {
		daysUntilExpiration: number | null;
		isExpired: boolean | null;
	};
	nameservers: string[];
	source: LookupSource | null;
	error: { code: string; message: string } | null;
}

export function createFailureOutput(
	normalized: NormalizedDomain,
	code: string,
	message: string,
): DomainLookupOutput {
	return {
		asciiDomain: normalized.asciiDomain,
		publicSuffix: normalized.publicSuffix,
		isRegistered: null,
		status: [],
		dates: {
			registeredAt: null,
			expiresAt: null,
			lastChangedAt: null,
			dataUpdatedAt: null,
		},
		expiry: {
			daysUntilExpiration: null,
			isExpired: null,
		},
		nameservers: [],
		source: null,
		error: {
			code,
			message,
		},
	};
}

export function createRegisteredOutput(
	normalized: NormalizedDomain,
	source: LookupSource,
	values: {
		status?: string[];
		registeredAt?: string | null;
		expiresAt?: string | null;
		lastChangedAt?: string | null;
		dataUpdatedAt?: string | null;
		nameservers?: string[];
	},
	now = new Date(),
): DomainLookupOutput {
	const expiresAtMs = values.expiresAt ? Date.parse(values.expiresAt) : Number.NaN;
	const hasValidExpiry = Number.isFinite(expiresAtMs);

	return {
		asciiDomain: normalized.asciiDomain,
		publicSuffix: normalized.publicSuffix,
		isRegistered: true,
		status: uniqueSortedStrings(values.status ?? []),
		dates: {
			registeredAt: values.registeredAt ?? null,
			expiresAt: values.expiresAt ?? null,
			lastChangedAt: values.lastChangedAt ?? null,
			dataUpdatedAt: values.dataUpdatedAt ?? null,
		},
		expiry: {
			daysUntilExpiration: hasValidExpiry
				? Math.floor((expiresAtMs - now.getTime()) / DAY_MS)
				: null,
			isExpired: hasValidExpiry ? expiresAtMs <= now.getTime() : null,
		},
		nameservers: uniqueSortedStrings(values.nameservers ?? []),
		source,
		error: null,
	};
}

export function createNotFoundOutput(
	normalized: NormalizedDomain,
	source: LookupSource,
): DomainLookupOutput {
	return {
		asciiDomain: normalized.asciiDomain,
		publicSuffix: normalized.publicSuffix,
		isRegistered: false,
		status: [],
		dates: {
			registeredAt: null,
			expiresAt: null,
			lastChangedAt: null,
			dataUpdatedAt: null,
		},
		expiry: {
			daysUntilExpiration: null,
			isExpired: null,
		},
		nameservers: [],
		source,
		error: null,
	};
}

function uniqueSortedStrings(values: unknown[]): string[] {
	const seen = new Set<string>();
	for (const value of values) {
		if (typeof value !== 'string') {
			continue;
		}

		const normalized = value.trim().toLowerCase();
		if (normalized.length > 0) {
			seen.add(normalized);
		}
	}

	return Array.from(seen).sort();
}
