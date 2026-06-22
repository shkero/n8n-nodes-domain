import net from 'node:net';
import { DOMAIN_LOOKUP_ERROR_CODES, DomainLookupError, type NormalizedDomain } from './domainUtils';
import {
	createNotFoundOutput,
	createRegisteredOutput,
	type DomainLookupOutput,
	type LookupSource,
} from './output';

const WHOIS_PORT = 43;
const WHOIS_REQUEST_TIMEOUT_MS = 5_000;

const REGISTRY_WHOIS_PROVIDERS = {
	co: {
		host: 'whois.registry.co',
		notFoundPatterns: [/DOMAIN NOT FOUND/i, /queried object does not exist/i],
	},
	io: {
		host: 'whois.nic.io',
		notFoundPatterns: [/Domain not found\./i],
	},
} as const;

type RegistryWhoisTld = keyof typeof REGISTRY_WHOIS_PROVIDERS;
type RegistryWhoisProvider = (typeof REGISTRY_WHOIS_PROVIDERS)[RegistryWhoisTld];

export function isRegistryWhoisTld(tld: string): tld is RegistryWhoisTld {
	return tld in REGISTRY_WHOIS_PROVIDERS;
}

export async function lookupRegistryWhoisDomainRegistration(
	normalized: NormalizedDomain,
	now = new Date(),
	createFetchedAt = () => new Date().toISOString(),
): Promise<DomainLookupOutput> {
	if (!isRegistryWhoisTld(normalized.tld)) {
		throw new DomainLookupError(
			`TLD ".${normalized.tld}" does not have a registry WHOIS provider`,
			DOMAIN_LOOKUP_ERROR_CODES.TLD_NOT_SUPPORTED,
		);
	}

	const provider = REGISTRY_WHOIS_PROVIDERS[normalized.tld];
	const response = await queryRegistryWhois(provider.host, normalized.asciiDomain);
	const output = mapRegistryWhoisResponse(
		response,
		normalized,
		createRegistryWhoisSource(normalized, provider, ''),
		provider,
		now,
	);

	return withSourceFetchedAt(output, createFetchedAt());
}

function createRegistryWhoisSource(
	normalized: NormalizedDomain,
	provider: RegistryWhoisProvider,
	fetchedAt: string,
): LookupSource {
	return {
		protocol: 'whois',
		type: 'authoritative',
		url: `whois://${provider.host}:${WHOIS_PORT}/${normalized.asciiDomain}`,
		fetchedAt,
	};
}

function withSourceFetchedAt(output: DomainLookupOutput, fetchedAt: string): DomainLookupOutput {
	if (!output.source) {
		return output;
	}

	return {
		...output,
		source: {
			...output.source,
			fetchedAt,
		},
	};
}

export function mapRegistryWhoisResponse(
	response: string,
	normalized: NormalizedDomain,
	source: LookupSource,
	provider: RegistryWhoisProvider,
	now = new Date(),
): DomainLookupOutput {
	const trimmedResponse = response.trim();
	if (trimmedResponse.length === 0) {
		throw new DomainLookupError(
			'Registry WHOIS returned an empty response',
			DOMAIN_LOOKUP_ERROR_CODES.WHOIS_RESPONSE_PARSE_FAILED,
		);
	}

	if (isRateLimitedResponse(trimmedResponse)) {
		throw new DomainLookupError(
			'Registry WHOIS query was rate limited',
			DOMAIN_LOOKUP_ERROR_CODES.WHOIS_RATE_LIMITED,
		);
	}

	if (provider.notFoundPatterns.some((pattern) => pattern.test(trimmedResponse))) {
		return createNotFoundOutput(normalized, source);
	}

	const fields = parseWhoisFields(trimmedResponse);
	const domainName = fields.get('domain name')?.[0]?.toLowerCase();

	if (!domainName) {
		const snippet = trimmedResponse.slice(0, 200).replace(/\r?\n/g, ' ');
		throw new DomainLookupError(
			`Registry WHOIS response does not contain a domain name: "${snippet}"`,
			DOMAIN_LOOKUP_ERROR_CODES.WHOIS_RESPONSE_PARSE_FAILED,
		);
	}

	if (domainName !== normalized.asciiDomain) {
		throw new DomainLookupError(
			`Registry WHOIS response domain "${domainName}" does not match requested domain "${normalized.asciiDomain}"`,
			DOMAIN_LOOKUP_ERROR_CODES.WHOIS_RESPONSE_PARSE_FAILED,
		);
	}

	return createRegisteredOutput(
		normalized,
		source,
		{
			status: normalizeStatus(fields.get('domain status') ?? []),
			registeredAt: parseWhoisDate(firstField(fields, ['creation date', 'created on'])),
			expiresAt: parseWhoisDate(
				firstField(fields, ['registry expiry date', 'expiration date', 'expiry date']),
			),
			lastChangedAt: parseWhoisDate(firstField(fields, ['updated date', 'last updated'])),
			dataUpdatedAt: parseWhoisDate(firstField(fields, ['last update of whois database'])),
			nameservers: fields.get('name server') ?? [],
		},
		now,
	);
}

function queryRegistryWhois(host: string, domain: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(
			{
				host,
				port: WHOIS_PORT,
			},
			() => {
				socket.write(`${domain}\r\n`);
			},
		);

		let response = '';
		let settled = false;

		socket.setEncoding('utf8');
		socket.setTimeout(WHOIS_REQUEST_TIMEOUT_MS);

		socket.on('data', (chunk) => {
			response += chunk;
		});

		socket.on('timeout', () => {
			socket.destroy(new Error('Registry WHOIS request timed out'));
		});

		socket.on('error', (error) => {
			if (settled) {
				return;
			}

			settled = true;
			reject(
				new DomainLookupError(error.message, DOMAIN_LOOKUP_ERROR_CODES.WHOIS_SOURCE_UNAVAILABLE),
			);
		});

		socket.on('close', () => {
			if (settled) {
				return;
			}

			settled = true;
			resolve(response);
		});
	});
}

function parseWhoisFields(response: string): Map<string, string[]> {
	const fields = new Map<string, string[]>();

	for (const line of response.split(/\r?\n/)) {
		const cleanedLine = line
			.trim()
			.replace(/^>>>\s*/, '')
			.replace(/\s*<<<$/, '');
		const separatorIndex = cleanedLine.indexOf(':');
		if (separatorIndex === -1) {
			continue;
		}

		const key = cleanedLine.slice(0, separatorIndex).trim().toLowerCase();
		const value = cleanedLine.slice(separatorIndex + 1).trim();
		if (!key || !value) {
			continue;
		}

		const values = fields.get(key) ?? [];
		values.push(value);
		fields.set(key, values);
	}

	return fields;
}

function firstField(fields: Map<string, string[]>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = fields.get(key)?.[0];
		if (value) {
			return value;
		}
	}

	return undefined;
}

function normalizeStatus(values: string[]): string[] {
	return values
		.map((value) => value.trim().split(/\s+/)[0])
		.filter((value): value is string => Boolean(value));
}

function parseWhoisDate(value: string | undefined): string | null {
	if (!value) {
		return null;
	}

	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		return null;
	}

	return new Date(timestamp).toISOString();
}

function isRateLimitedResponse(response: string): boolean {
	return /WHOIS LIMIT EXCEEDED|too many connections|query rate limit exceeded|rate limit exceeded/i.test(
		response,
	);
}
