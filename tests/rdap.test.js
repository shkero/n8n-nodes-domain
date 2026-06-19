const assert = require('node:assert/strict');
const test = require('node:test');

const {
	clearRdapBootstrapCache,
	findBootstrapUrls,
	lookupDomainRegistration,
	mapRdapDomainObject,
} = require('../dist/nodes/DomainLookup/rdap');

const normalized = {
	asciiDomain: 'example.com',
	publicSuffix: 'com',
	tld: 'com',
};

const bootstrap = {
	services: [[['com'], ['https://rdap.example.test/']]],
};

test('finds authoritative RDAP URLs by TLD', () => {
	assert.deepEqual(findBootstrapUrls(bootstrap, 'com'), ['https://rdap.example.test/']);
	assert.deepEqual(findBootstrapUrls(bootstrap, 'invalid'), []);
});

test('maps RDAP domain fields to stable output', () => {
	const output = mapRdapDomainObject(
		{
			objectClassName: 'domain',
			ldhName: 'EXAMPLE.COM',
			status: ['ACTIVE', 'active', 'client transfer prohibited'],
			events: [
				{ eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
				{ eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
				{ eventAction: 'last changed', eventDate: '2026-01-01T00:00:00Z' },
				{
					eventAction: 'last update of RDAP database',
					eventDate: '2026-06-19T00:00:00Z',
				},
			],
			nameservers: [{ ldhName: 'B.IANA-SERVERS.NET' }, { ldhName: 'a.iana-servers.net' }],
		},
		normalized,
		{
			protocol: 'rdap',
			type: 'authoritative',
			url: 'https://rdap.example.test/domain/example.com',
			fetchedAt: '2026-06-19T03:20:00.000Z',
		},
		new Date('2026-06-19T00:00:00Z'),
	);

	assert.equal(output.isRegistered, true);
	assert.deepEqual(output.status, ['active', 'client transfer prohibited']);
	assert.deepEqual(output.dates, {
		registeredAt: '1995-08-14T04:00:00.000Z',
		expiresAt: '2027-08-13T04:00:00.000Z',
		lastChangedAt: '2026-01-01T00:00:00.000Z',
		dataUpdatedAt: '2026-06-19T00:00:00.000Z',
	});
	assert.deepEqual(output.expiry, {
		daysUntilExpiration: 420,
		isExpired: false,
	});
	assert.deepEqual(output.nameservers, ['a.iana-servers.net', 'b.iana-servers.net']);
});

test('maps missing expiration to null expiry', () => {
	const output = mapRdapDomainObject(
		{
			objectClassName: 'domain',
			events: [{ eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' }],
		},
		normalized,
		{
			protocol: 'rdap',
			type: 'authoritative',
			url: 'https://rdap.example.test/domain/example.com',
			fetchedAt: '2026-06-19T03:20:00.000Z',
		},
		new Date('2026-06-19T00:00:00Z'),
	);

	assert.equal(output.expiry.daysUntilExpiration, null);
	assert.equal(output.expiry.isExpired, null);
});

test('maps expired domains to negative whole days', () => {
	const output = mapRdapDomainObject(
		{
			objectClassName: 'domain',
			events: [{ eventAction: 'expiration', eventDate: '2026-06-17T12:00:00Z' }],
		},
		normalized,
		{
			protocol: 'rdap',
			type: 'authoritative',
			url: 'https://rdap.example.test/domain/example.com',
			fetchedAt: '2026-06-19T03:20:00.000Z',
		},
		new Date('2026-06-19T00:00:00Z'),
	);

	assert.deepEqual(output.expiry, {
		daysUntilExpiration: -2,
		isExpired: true,
	});
});

test('returns authoritative success and preserves source URL', async () => {
	clearRdapBootstrapCache();
	const calls = [];
	const output = await lookupDomainRegistration(normalized, async (options) => {
		calls.push(options.url);
		if (options.url === 'https://data.iana.org/rdap/dns.json') {
			return { statusCode: 200, body: bootstrap };
		}

		return {
			statusCode: 200,
			body: {
				objectClassName: 'domain',
				events: [{ eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' }],
			},
		};
	});

	assert.deepEqual(calls, [
		'https://data.iana.org/rdap/dns.json',
		'https://rdap.example.test/domain/example.com',
	]);
	assert.equal(output.isRegistered, true);
	assert.equal(output.source.type, 'authoritative');
	assert.equal(output.source.url, 'https://rdap.example.test/domain/example.com');
});

test('returns not found on authoritative 404 without fallback', async () => {
	clearRdapBootstrapCache();
	const calls = [];
	const output = await lookupDomainRegistration(normalized, async (options) => {
		calls.push(options.url);
		if (options.url === 'https://data.iana.org/rdap/dns.json') {
			return { statusCode: 200, body: bootstrap };
		}

		return { statusCode: 404, body: { errorCode: 404 } };
	});

	assert.equal(output.isRegistered, false);
	assert.equal(output.source.type, 'authoritative');
	assert.deepEqual(calls, [
		'https://data.iana.org/rdap/dns.json',
		'https://rdap.example.test/domain/example.com',
	]);
});

test('falls back after authoritative provider failures', async () => {
	clearRdapBootstrapCache();
	const calls = [];
	const output = await lookupDomainRegistration(normalized, async (options) => {
		calls.push(options.url);
		if (options.url === 'https://data.iana.org/rdap/dns.json') {
			return { statusCode: 200, body: bootstrap };
		}

		if (options.url === 'https://rdap.org/domain/example.com') {
			return {
				statusCode: 200,
				body: {
					objectClassName: 'domain',
					events: [{ eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' }],
				},
			};
		}

		return { statusCode: 500, body: {} };
	});

	assert.deepEqual(calls, [
		'https://data.iana.org/rdap/dns.json',
		'https://rdap.example.test/domain/example.com',
		'https://rdap.org/domain/example.com',
	]);
	assert.equal(output.isRegistered, true);
	assert.equal(output.source.type, 'fallback');
});

test('throws when IANA bootstrap does not support the TLD', async () => {
	clearRdapBootstrapCache();
	const calls = [];
	await assert.rejects(
		lookupDomainRegistration(
			{ asciiDomain: 'example.invalid', publicSuffix: 'invalid', tld: 'invalid' },
			async (options) => {
				calls.push(options.url);
				return { statusCode: 200, body: bootstrap };
			},
		),
		/TLD "invalid"/,
	);
	assert.deepEqual(calls, ['https://data.iana.org/rdap/dns.json']);
});

test('throws when every RDAP source fails', async () => {
	clearRdapBootstrapCache();
	await assert.rejects(
		lookupDomainRegistration(normalized, async (options) => {
			if (options.url === 'https://data.iana.org/rdap/dns.json') {
				return { statusCode: 200, body: bootstrap };
			}

			return { statusCode: 500, body: {} };
		}),
		/All RDAP sources failed/,
	);
});
