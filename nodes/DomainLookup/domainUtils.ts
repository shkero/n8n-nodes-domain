import { parse } from 'tldts';

export const DOMAIN_LOOKUP_ERROR_CODES = {
	INVALID_INPUT: 'INVALID_INPUT',
	RDAP_SOURCE_UNAVAILABLE: 'RDAP_SOURCE_UNAVAILABLE',
	TLD_RDAP_NOT_SUPPORTED: 'TLD_RDAP_NOT_SUPPORTED',
} as const;

export type DomainLookupErrorCode =
	(typeof DOMAIN_LOOKUP_ERROR_CODES)[keyof typeof DOMAIN_LOOKUP_ERROR_CODES];

export class DomainLookupError extends Error {
	constructor(
		message: string,
		readonly code: DomainLookupErrorCode,
	) {
		super(message);
		this.name = 'DomainLookupError';
	}
}

export interface NormalizedDomain {
	asciiDomain: string;
	publicSuffix: string;
	tld: string;
}

const HTTP_PROTOCOL_PATTERN = /^https?:\/\//i;
const PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const EMAIL_PATTERN = /^[^/@\s]+@[^/@\s]+\.[^/@\s]+$/;
const ASCII_PATTERN = /^[\x00-\x7F]+$/;

export function normalizeDomainInput(input: unknown): NormalizedDomain {
	if (typeof input !== 'string') {
		throwInvalidInput('Domain must be a string');
	}

	const value = input.trim();
	if (value.length === 0) {
		throwInvalidInput('Domain is required');
	}

	if (/\s/.test(value)) {
		throwInvalidInput('Domain must not contain whitespace');
	}

	if (!ASCII_PATTERN.test(value)) {
		throwInvalidInput('Only ASCII domains are supported');
	}

	if (EMAIL_PATTERN.test(value)) {
		throwInvalidInput('Email addresses are not supported');
	}

	const protocolMatch = value.match(PROTOCOL_PATTERN);
	if (protocolMatch && !HTTP_PROTOCOL_PATTERN.test(value)) {
		throwInvalidInput('Only http:// and https:// URLs are supported');
	}

	if (value.startsWith('//')) {
		throwInvalidInput('Protocol-relative URLs are not supported');
	}

	const hostname = extractHostname(value);
	const asciiHostname = hostname.toLowerCase().replace(/\.$/, '');

	validateHostname(asciiHostname);

	const parsed = parse(asciiHostname, {
		allowPrivateDomains: false,
		extractHostname: false,
	});

	if (parsed.isIp) {
		throwInvalidInput('IP addresses are not supported');
	}

	if (!parsed.domain || !parsed.publicSuffix) {
		throwInvalidInput('Could not determine a registrable domain');
	}

	return {
		asciiDomain: parsed.domain.toLowerCase(),
		publicSuffix: parsed.publicSuffix.toLowerCase(),
		tld: getTld(parsed.domain),
	};
}

function extractHostname(value: string): string {
	const urlValue = HTTP_PROTOCOL_PATTERN.test(value) ? value : `https://${value}`;

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(urlValue);
	} catch {
		throwInvalidInput('Domain could not be parsed');
	}

	if (parsedUrl.username || parsedUrl.password) {
		throwInvalidInput('URLs with username or password are not supported');
	}

	if (!parsedUrl.hostname) {
		throwInvalidInput('Hostname is required');
	}

	return parsedUrl.hostname;
}

function validateHostname(hostname: string): void {
	if (!ASCII_PATTERN.test(hostname)) {
		throwInvalidInput('Only ASCII domains are supported');
	}

	if (hostname === 'localhost') {
		throwInvalidInput('localhost is not supported');
	}

	if (hostname.includes('*')) {
		throwInvalidInput('Wildcard domains are not supported');
	}

	if (hostname.length > 253) {
		throwInvalidInput('Hostname must be 253 characters or fewer');
	}

	if (hostname.length === 0 || hostname.includes('..')) {
		throwInvalidInput('Hostname is invalid');
	}

	const labels = hostname.split('.');
	for (const label of labels) {
		if (label.length === 0) {
			throwInvalidInput('Hostname labels must not be empty');
		}

		if (label.length > 63) {
			throwInvalidInput('Hostname labels must be 63 characters or fewer');
		}

		if (label.startsWith('xn--')) {
			throwInvalidInput('IDN domains are not supported');
		}
	}
}

function getTld(domain: string): string {
	const labels = domain.split('.');
	return labels[labels.length - 1] ?? domain;
}

function throwInvalidInput(message: string): never {
	throw new DomainLookupError(message, DOMAIN_LOOKUP_ERROR_CODES.INVALID_INPUT);
}
