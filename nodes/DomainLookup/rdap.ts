import {
	DOMAIN_LOOKUP_ERROR_CODES,
	DomainLookupError,
	type DomainLookupErrorCode,
	type NormalizedDomain,
} from './domainUtils';
import { lookupCnDomainRegistration } from './whoisCn';
import { isRegistryWhoisTld, lookupRegistryWhoisDomainRegistration } from './whoisRegistry';
import {
	createFailureOutput,
	createNotFoundOutput,
	createRegisteredOutput,
	type DomainLookupOutput,
	type LookupSource,
} from './output';

export const BOOTSTRAP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 5_000;
export const IANA_RDAP_DNS_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';

const FALLBACK_RDAP_URLS = ['https://www.rdap.net/domain/'];

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
	code: DomainLookupErrorCode;
	fallbackEligible: boolean;
}

type RequestResult = RequestSuccess | RequestNotFound | RequestFailure;

let bootstrapCache: BootstrapCache | undefined;

export async function lookupDomainRegistration(
	normalized: NormalizedDomain,
	httpRequest: HttpRequest,
	now = new Date(),
): Promise<DomainLookupOutput> {
	if (normalized.tld === 'cn') {
		return lookupCnDomainRegistration(normalized, now);
	}

	if (isRegistryWhoisTld(normalized.tld)) {
		return lookupRegistryWhoisDomainRegistration(normalized, now);
	}

	const bootstrap = await getBootstrap(httpRequest);
	const authoritativeBaseUrls = findBootstrapUrls(bootstrap, normalized.tld);

	if (authoritativeBaseUrls.length === 0) {
		return createFailureOutput(
			normalized,
			DOMAIN_LOOKUP_ERROR_CODES.TLD_NOT_SUPPORTED,
			`TLD ".${normalized.tld}" is not supported. This package supports .cn, .io, and .co through WHOIS and TLDs published in the IANA RDAP DNS bootstrap.`,
		);
	}

	const failures: RequestFailure[] = [];

	for (const baseUrl of authoritativeBaseUrls) {
		const url = buildRdapDomainUrl(baseUrl, normalized.asciiDomain);
		const result = await requestRdap(url, httpRequest);
		const output = outputFromRequestResult(result, normalized, 'authoritative', url, now);

		if (output) {
			return output;
		}

		if (result.kind === 'failure') {
			failures.push(result);
		}
	}

	const blockingFailure = failures.find((failure) => !failure.fallbackEligible);
	if (blockingFailure) {
		throw new DomainLookupError(blockingFailure.message, blockingFailure.code);
	}

	if (failures.length === 0) {
		throw new DomainLookupError(
			'All authoritative RDAP sources failed',
			DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE,
		);
	}

	const fallbackFailures: RequestFailure[] = [];

	for (const baseUrl of FALLBACK_RDAP_URLS) {
		const url = `${baseUrl}${encodeURIComponent(normalized.asciiDomain)}`;
		const result = await requestRdap(url, httpRequest);
		const output = outputFromRequestResult(result, normalized, 'fallback', url, now);

		if (output) {
			return output;
		}

		if (result.kind === 'failure') {
			fallbackFailures.push(result);
		}
	}

	const lastFailure =
		fallbackFailures[fallbackFailures.length - 1] ?? failures[failures.length - 1];
	throw new DomainLookupError(
		lastFailure?.message ?? 'All RDAP sources failed',
		lastFailure?.code ?? DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE,
	);
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

	return createRegisteredOutput(
		normalized,
		source,
		{
			status: extractStatus(body),
			registeredAt: dates.registeredAt,
			expiresAt: dates.expiresAt,
			lastChangedAt: dates.lastChangedAt,
			dataUpdatedAt: dates.dataUpdatedAt,
			nameservers: extractNameservers(body),
		},
		now,
	);
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

async function getBootstrap(httpRequest: HttpRequest): Promise<unknown> {
	const now = Date.now();
	if (bootstrapCache && bootstrapCache.expiresAt > now) {
		return bootstrapCache.body;
	}

	const result = await requestJson(IANA_RDAP_DNS_BOOTSTRAP_URL, httpRequest);
	if (result.kind !== 'success') {
		throw new DomainLookupError(
			'IANA RDAP bootstrap is unavailable',
			DOMAIN_LOOKUP_ERROR_CODES.RDAP_BOOTSTRAP_UNAVAILABLE,
		);
	}

	if (!isRecord(result.body) || !Array.isArray(result.body.services)) {
		throw new DomainLookupError(
			'IANA RDAP bootstrap response is invalid',
			DOMAIN_LOOKUP_ERROR_CODES.RDAP_BOOTSTRAP_UNAVAILABLE,
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
			code: DOMAIN_LOOKUP_ERROR_CODES.RDAP_RESPONSE_PARSE_FAILED,
			fallbackEligible: true,
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
				code: DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE,
				fallbackEligible: isFallbackEligibleHttpStatus(statusCode),
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
					code: DOMAIN_LOOKUP_ERROR_CODES.RDAP_RESPONSE_PARSE_FAILED,
					fallbackEligible: true,
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
			code: DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE,
			fallbackEligible: isFallbackEligibleHttpStatus(statusCode),
		};
	}
}

function isFallbackEligibleHttpStatus(statusCode: number | null): boolean {
	if (statusCode === null) {
		return true;
	}

	return statusCode === 429 || statusCode >= 500;
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
