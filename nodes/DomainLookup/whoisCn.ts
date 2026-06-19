import net from 'node:net';
import { DOMAIN_LOOKUP_ERROR_CODES, DomainLookupError, type NormalizedDomain } from './domainUtils';
import {
	createNotFoundOutput,
	createRegisteredOutput,
	type DomainLookupOutput,
	type LookupSource,
} from './output';

const CNNIC_WHOIS_HOST = 'whois.cnnic.cn';
const CNNIC_WHOIS_PORT = 43;
const CNNIC_WHOIS_BASE_URL = `whois://${CNNIC_WHOIS_HOST}:${CNNIC_WHOIS_PORT}`;
const WHOIS_REQUEST_TIMEOUT_MS = 5_000;

export async function lookupCnDomainRegistration(
	normalized: NormalizedDomain,
	now = new Date(),
): Promise<DomainLookupOutput> {
	const source: LookupSource = {
		protocol: 'whois',
		type: 'authoritative',
		url: `${CNNIC_WHOIS_BASE_URL}/${normalized.asciiDomain}`,
		fetchedAt: new Date().toISOString(),
	};

	const response = await queryCnnicWhois(normalized.asciiDomain);
	return mapCnnicWhoisResponse(response, normalized, source, now);
}

export function mapCnnicWhoisResponse(
	response: string,
	normalized: NormalizedDomain,
	source: LookupSource,
	now = new Date(),
): DomainLookupOutput {
	if (/No matching record\./i.test(response)) {
		return createNotFoundOutput(normalized, source);
	}

	const fields = parseWhoisFields(response);
	const domainName = fields.get('domain name')?.[0]?.toLowerCase();
	if (domainName !== normalized.asciiDomain) {
		throw new DomainLookupError(
			'CNNIC WHOIS response is not a valid domain record',
			DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE,
		);
	}

	return createRegisteredOutput(
		normalized,
		source,
		{
			status: fields.get('domain status') ?? [],
			registeredAt: parseCnnicDate(fields.get('registration time')?.[0]),
			expiresAt: parseCnnicDate(fields.get('expiration time')?.[0]),
			lastChangedAt: null,
			dataUpdatedAt: null,
			nameservers: fields.get('name server') ?? [],
		},
		now,
	);
}

function queryCnnicWhois(domain: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(
			{
				host: CNNIC_WHOIS_HOST,
				port: CNNIC_WHOIS_PORT,
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
			socket.destroy(new Error('CNNIC WHOIS request timed out'));
		});

		socket.on('error', (error) => {
			if (settled) {
				return;
			}

			settled = true;
			reject(
				new DomainLookupError(error.message, DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE),
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
		const separatorIndex = line.indexOf(':');
		if (separatorIndex === -1) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim().toLowerCase();
		const value = line.slice(separatorIndex + 1).trim();
		if (!key || !value) {
			continue;
		}

		const values = fields.get(key) ?? [];
		values.push(value);
		fields.set(key, values);
	}

	return fields;
}

function parseCnnicDate(value: string | undefined): string | null {
	if (!value) {
		return null;
	}

	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
	if (!match) {
		return null;
	}

	const [, year, month, day, hour, minute, second] = match;
	return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
}
