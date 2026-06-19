import { DOMAIN_LOOKUP_ERROR_CODES, DomainLookupError, type NormalizedDomain } from './domainUtils';

export const BOOTSTRAP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 5_000;
export const IANA_RDAP_DNS_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';

const FALLBACK_RDAP_URLS = ['https://rdap.org/domain/', 'https://www.rdap.net/domain/'];
const DAY_MS = 24 * 60 * 60 * 1000;

export interface HttpRequestOptions {
	method: 'GET';
	url: string;
	headers?: Record<string, string>;
	timeout?: number;
	json?: boolean;
	returnFullResponse?: boolean;
	ignoreHttpStatusErrors?: boolean;
}

export type HttpRequest = (options: HttpRequestOptions) => Promise<unknown>;

export interface LookupSource {
	protocol: 'rdap';
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
	error?: {
		code: string;
		message: string;
	};
}

interface BootstrapCache {
	expiresAt: number;
	body: unknown;
}

interface RequestSuccess {
	kind: 'success';
	body: unknown;
	fetchedAt: string;
}

interface RequestNotFound {
	kind: 'notFound';
	fetchedAt: string;
}

interface RequestFailure {
	kind: 'failure';
	message: string;
}

type RequestResult = RequestSuccess | RequestNotFound | RequestFailure;

let bootstrapCache: BootstrapCache | undefined;

export async function lookupDomainRegistration(
	normalized: NormalizedDomain,
	httpRequest: HttpRequest,
	now = new Date(),
): Promise<DomainLookupOutput> {
	const bootstrap = await getBootstrap(httpRequest);
	const authoritativeBaseUrls = findBootstrapUrls(bootstrap, normalized.tld);

	if (authoritativeBaseUrls.length === 0) {
		throw new DomainLookupError(
			`IANA RDAP bootstrap does not include TLD "${normalized.tld}"`,
			DOMAIN_LOOKUP_ERROR_CODES.TLD_RDAP_NOT_SUPPORTED,
		);
	}

	for (const baseUrl of authoritativeBaseUrls) {
		const url = buildRdapDomainUrl(baseUrl, normalized.asciiDomain);
		const result = await requestRdap(url, httpRequest);
		const output = outputFromRequestResult(result, normalized, 'authoritative', url, now);

		if (output) {
			return output;
		}
	}

	for (const baseUrl of FALLBACK_RDAP_URLS) {
		const url = `${baseUrl}${encodeURIComponent(normalized.asciiDomain)}`;
		const result = await requestRdap(url, httpRequest);
		const output = outputFromRequestResult(result, normalized, 'fallback', url, now);

		if (output) {
			return output;
		}
	}

	throw new DomainLookupError(
		'All RDAP sources failed',
		DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE,
	);
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

export function clearRdapBootstrapCache(): void {
	bootstrapCache = undefined;
}

export function findBootstrapUrls(bootstrap: unknown, tld: string): string[] {
	if (!isRecord(bootstrap) || !Array.isArray(bootstrap.services)) {
		return [];
	}

	const urls: string[] = [];
	const seen = new Set<string>();
	const normalizedTld = tld.toLowerCase();

	for (const service of bootstrap.services) {
		if (!Array.isArray(service) || service.length < 2) {
			continue;
		}

		const tlds = service[0];
		const baseUrls = service[1];

		if (!Array.isArray(tlds) || !Array.isArray(baseUrls)) {
			continue;
		}

		const hasTld = tlds.some((candidate) => {
			return typeof candidate === 'string' && candidate.toLowerCase() === normalizedTld;
		});

		if (!hasTld) {
			continue;
		}

		for (const baseUrl of baseUrls) {
			if (typeof baseUrl !== 'string' || seen.has(baseUrl)) {
				continue;
			}

			seen.add(baseUrl);
			urls.push(baseUrl);
		}
	}

	return urls;
}

export function mapRdapDomainObject(
	body: unknown,
	normalized: NormalizedDomain,
	source: LookupSource,
	now = new Date(),
): DomainLookupOutput | null {
	if (!isRdapDomainObject(body)) {
		return null;
	}

	const dates = extractDates(body);
	const expiresAtMs = dates.expiresAt ? Date.parse(dates.expiresAt) : Number.NaN;
	const hasValidExpiry = Number.isFinite(expiresAtMs);

	return {
		asciiDomain: normalized.asciiDomain,
		publicSuffix: normalized.publicSuffix,
		isRegistered: true,
		status: extractStatus(body),
		dates,
		expiry: {
			daysUntilExpiration: hasValidExpiry
				? Math.floor((expiresAtMs - now.getTime()) / DAY_MS)
				: null,
			isExpired: hasValidExpiry ? expiresAtMs <= now.getTime() : null,
		},
		nameservers: extractNameservers(body),
		source,
	};
}

function outputFromRequestResult(
	result: RequestResult,
	normalized: NormalizedDomain,
	sourceType: LookupSource['type'],
	url: string,
	now: Date,
): DomainLookupOutput | null {
	if (result.kind === 'failure') {
		return null;
	}

	const source: LookupSource = {
		protocol: 'rdap',
		type: sourceType,
		url,
		fetchedAt: result.fetchedAt,
	};

	if (result.kind === 'notFound') {
		return createNotFoundOutput(normalized, source);
	}

	return mapRdapDomainObject(result.body, normalized, source, now);
}

function createNotFoundOutput(
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
	};
}

async function getBootstrap(httpRequest: HttpRequest): Promise<unknown> {
	const now = Date.now();
	if (bootstrapCache && bootstrapCache.expiresAt > now) {
		return bootstrapCache.body;
	}

	const result = await requestJson(IANA_RDAP_DNS_BOOTSTRAP_URL, httpRequest);
	if (result.kind !== 'success') {
		throw new DomainLookupError(
			'IANA RDAP bootstrap is unavailable',
			DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE,
		);
	}

	if (!isRecord(result.body) || !Array.isArray(result.body.services)) {
		throw new DomainLookupError(
			'IANA RDAP bootstrap response is invalid',
			DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE,
		);
	}

	bootstrapCache = {
		expiresAt: now + BOOTSTRAP_CACHE_TTL_MS,
		body: result.body,
	};

	return result.body;
}

async function requestRdap(url: string, httpRequest: HttpRequest): Promise<RequestResult> {
	const result = await requestJson(url, httpRequest);
	if (result.kind !== 'success') {
		return result;
	}

	if (!isRdapDomainObject(result.body)) {
		return {
			kind: 'failure',
			message: 'RDAP response is not a domain object',
		};
	}

	return result;
}

async function requestJson(url: string, httpRequest: HttpRequest): Promise<RequestResult> {
	try {
		const response = await httpRequest({
			method: 'GET',
			url,
			headers: {
				Accept: 'application/rdap+json, application/json',
			},
			timeout: REQUEST_TIMEOUT_MS,
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		});

		const statusCode = getStatusCode(response);
		const fetchedAt = new Date().toISOString();

		if (statusCode === 404) {
			return {
				kind: 'notFound',
				fetchedAt,
			};
		}

		if (!statusCode || statusCode < 200 || statusCode >= 300) {
			return {
				kind: 'failure',
				message: `HTTP ${statusCode ?? 'unknown'} from ${url}`,
			};
		}

		const body = getResponseBody(response);
		if (typeof body === 'string') {
			try {
				return {
					kind: 'success',
					body: JSON.parse(body) as unknown,
					fetchedAt,
				};
			} catch {
				return {
					kind: 'failure',
					message: 'Response body is not valid JSON',
				};
			}
		}

		return {
			kind: 'success',
			body,
			fetchedAt,
		};
	} catch (error) {
		const statusCode = getErrorStatusCode(error);
		if (statusCode === 404) {
			return {
				kind: 'notFound',
				fetchedAt: new Date().toISOString(),
			};
		}

		return {
			kind: 'failure',
			message: error instanceof Error ? error.message : 'Request failed',
		};
	}
}

function getStatusCode(response: unknown): number | null {
	if (!isRecord(response)) {
		return 200;
	}

	const statusCode = response.statusCode ?? response.status;
	return typeof statusCode === 'number' ? statusCode : null;
}

function getErrorStatusCode(error: unknown): number | null {
	if (!isRecord(error)) {
		return null;
	}

	const response = error.response;
	if (isRecord(response)) {
		const statusCode = response.statusCode ?? response.status;
		if (typeof statusCode === 'number') {
			return statusCode;
		}
	}

	const statusCode = error.statusCode ?? error.status ?? error.httpCode;
	return typeof statusCode === 'number' ? statusCode : null;
}

function getResponseBody(response: unknown): unknown {
	if (!isRecord(response)) {
		return response;
	}

	if ('body' in response) {
		return response.body;
	}

	if ('data' in response) {
		return response.data;
	}

	return response;
}

function buildRdapDomainUrl(baseUrl: string, asciiDomain: string): string {
	const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	return `${normalizedBaseUrl}domain/${encodeURIComponent(asciiDomain)}`;
}

function isRdapDomainObject(body: unknown): body is Record<string, unknown> {
	if (!isRecord(body)) {
		return false;
	}

	if (typeof body.objectClassName === 'string') {
		return body.objectClassName.toLowerCase() === 'domain';
	}

	return typeof body.ldhName === 'string' || Array.isArray(body.events);
}

function extractDates(body: Record<string, unknown>): DomainLookupOutput['dates'] {
	const dates: DomainLookupOutput['dates'] = {
		registeredAt: null,
		expiresAt: null,
		lastChangedAt: null,
		dataUpdatedAt: null,
	};

	if (!Array.isArray(body.events)) {
		return dates;
	}

	for (const event of body.events) {
		if (!isRecord(event) || typeof event.eventAction !== 'string') {
			continue;
		}

		const eventDate = typeof event.eventDate === 'string' ? toIsoDate(event.eventDate) : null;
		if (!eventDate) {
			continue;
		}

		switch (event.eventAction.trim().toLowerCase()) {
			case 'registration':
				dates.registeredAt ??= eventDate;
				break;
			case 'expiration':
				dates.expiresAt ??= eventDate;
				break;
			case 'last changed':
				dates.lastChangedAt ??= eventDate;
				break;
			case 'last update of rdap database':
				dates.dataUpdatedAt ??= eventDate;
				break;
		}
	}

	return dates;
}

function extractStatus(body: Record<string, unknown>): string[] {
	if (!Array.isArray(body.status)) {
		return [];
	}

	return uniqueSortedStrings(body.status);
}

function extractNameservers(body: Record<string, unknown>): string[] {
	if (!Array.isArray(body.nameservers)) {
		return [];
	}

	const nameservers: string[] = [];
	for (const nameserver of body.nameservers) {
		if (!isRecord(nameserver) || typeof nameserver.ldhName !== 'string') {
			continue;
		}

		nameservers.push(nameserver.ldhName);
	}

	return uniqueSortedStrings(nameservers);
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

function toIsoDate(value: string): string | null {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		return null;
	}

	return new Date(timestamp).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
