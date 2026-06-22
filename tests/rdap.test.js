const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');

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
	services: [
		[['com'], ['https://rdap.example.test/']],
		[['org'], ['https://rdap-org.example.test/']],
		[['xyz'], ['https://rdap-xyz.example.test/']],
	],
};

const commonRdapTlds = [
	{
		asciiDomain: 'example.com',
		publicSuffix: 'com',
		tld: 'com',
		authoritativeUrl: 'https://rdap.example.test/domain/example.com',
	},
	{
		asciiDomain: 'example.org',
		publicSuffix: 'org',
		tld: 'org',
		authoritativeUrl: 'https://rdap-org.example.test/domain/example.org',
	},
	{
		asciiDomain: 'example.xyz',
		publicSuffix: 'xyz',
		tld: 'xyz',
		authoritativeUrl: 'https://rdap-xyz.example.test/domain/example.xyz',
	},
];

test('finds authoritative RDAP URLs by TLD', () => {
	assert.deepEqual(findBootstrapUrls(bootstrap, 'com'), ['https://rdap.example.test/']);
	assert.deepEqual(findBootstrapUrls(bootstrap, 'org'), ['https://rdap-org.example.test/']);
	assert.deepEqual(findBootstrapUrls(bootstrap, 'xyz'), ['https://rdap-xyz.example.test/']);
	assert.deepEqual(findBootstrapUrls(bootstrap, 'invalid'), []);
});

test('looks up common RDAP bootstrap TLDs through authoritative RDAP paths', async () => {
	for (const testCase of commonRdapTlds) {
		clearRdapBootstrapCache();
		const calls = [];
		const output = await lookupDomainRegistration(testCase, async (options) => {
			calls.push(options.url);
			if (options.url === 'https://data.iana.org/rdap/dns.json') {
				return { statusCode: 200, body: bootstrap };
			}

			assert.equal(options.url, testCase.authoritativeUrl);
			return {
				statusCode: 200,
				body: {
					objectClassName: 'domain',
					events: [{ eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' }],
				},
			};
		});

		assert.deepEqual(calls, ['https://data.iana.org/rdap/dns.json', testCase.authoritativeUrl]);
		assert.equal(output.source.type, 'authoritative');
		assert.equal(output.source.protocol, 'rdap');
		assert.equal(output.error, null);
	}
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
		expiresAtTimestamp: Date.parse('2027-08-13T04:00:00.000Z'),
		daysUntilExpiration: 420,
		isExpired: false,
	});
	assert.deepEqual(output.nameservers, ['a.iana-servers.net', 'b.iana-servers.net']);
	assert.equal(output.error, null);
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
	assert.equal(output.expiry.expiresAtTimestamp, null);
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
		expiresAtTimestamp: Date.parse('2026-06-17T12:00:00.000Z'),
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
	assert.equal(output.error, null);
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
	assert.equal(output.expiry.expiresAtTimestamp, null);
	assert.equal(output.error, null);
	assert.deepEqual(calls, [
		'https://data.iana.org/rdap/dns.json',
		'https://rdap.example.test/domain/example.com',
	]);
});

for (const statusCode of [429, 500]) {
	test(`falls back to rdap.net after authoritative HTTP ${statusCode}`, async () => {
		clearRdapBootstrapCache();
		const calls = [];
		const output = await lookupDomainRegistration(normalized, async (options) => {
			calls.push(options.url);
			if (options.url === 'https://data.iana.org/rdap/dns.json') {
				return { statusCode: 200, body: bootstrap };
			}

			if (options.url === 'https://www.rdap.net/domain/example.com') {
				return {
					statusCode: 200,
					body: {
						objectClassName: 'domain',
						events: [{ eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' }],
					},
				};
			}

			return { statusCode, body: {} };
		});

		assert.deepEqual(calls, [
			'https://data.iana.org/rdap/dns.json',
			'https://rdap.example.test/domain/example.com',
			'https://www.rdap.net/domain/example.com',
		]);
		assert.equal(output.isRegistered, true);
		assert.equal(output.source.type, 'fallback');
		assert.equal(output.source.url, 'https://www.rdap.net/domain/example.com');
		assert.equal(output.error, null);
	});
}

test('falls back to rdap.net after authoritative network failure', async () => {
	clearRdapBootstrapCache();
	const calls = [];
	const output = await lookupDomainRegistration(normalized, async (options) => {
		calls.push(options.url);
		if (options.url === 'https://data.iana.org/rdap/dns.json') {
			return { statusCode: 200, body: bootstrap };
		}

		if (options.url === 'https://www.rdap.net/domain/example.com') {
			return {
				statusCode: 200,
				body: {
					objectClassName: 'domain',
					events: [{ eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' }],
				},
			};
		}

		throw new Error('socket hang up');
	});

	assert.deepEqual(calls, [
		'https://data.iana.org/rdap/dns.json',
		'https://rdap.example.test/domain/example.com',
		'https://www.rdap.net/domain/example.com',
	]);
	assert.equal(output.source.type, 'fallback');
});

test('falls back to rdap.net after invalid authoritative RDAP response', async () => {
	clearRdapBootstrapCache();
	const calls = [];
	const output = await lookupDomainRegistration(normalized, async (options) => {
		calls.push(options.url);
		if (options.url === 'https://data.iana.org/rdap/dns.json') {
			return { statusCode: 200, body: bootstrap };
		}

		if (options.url === 'https://www.rdap.net/domain/example.com') {
			return {
				statusCode: 200,
				body: {
					objectClassName: 'domain',
					events: [{ eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' }],
				},
			};
		}

		return { statusCode: 200, body: 'not json' };
	});

	assert.deepEqual(calls, [
		'https://data.iana.org/rdap/dns.json',
		'https://rdap.example.test/domain/example.com',
		'https://www.rdap.net/domain/example.com',
	]);
	assert.equal(output.source.type, 'fallback');
});

for (const statusCode of [400, 401, 403]) {
	test(`does not fallback after authoritative HTTP ${statusCode}`, async () => {
		clearRdapBootstrapCache();
		const calls = [];
		await assert.rejects(
			lookupDomainRegistration(normalized, async (options) => {
				calls.push(options.url);
				if (options.url === 'https://data.iana.org/rdap/dns.json') {
					return { statusCode: 200, body: bootstrap };
				}

				return { statusCode, body: {} };
			}),
			new RegExp(`HTTP ${statusCode}`),
		);

		assert.deepEqual(calls, [
			'https://data.iana.org/rdap/dns.json',
			'https://rdap.example.test/domain/example.com',
		]);
	});
}

test('returns structured output when IANA bootstrap does not support the TLD', async () => {
	clearRdapBootstrapCache();
	const calls = [];
	const output = await lookupDomainRegistration(
		{ asciiDomain: 'example.unsupported', publicSuffix: 'unsupported', tld: 'unsupported' },
		async (options) => {
			calls.push(options.url);
			return { statusCode: 200, body: bootstrap };
		},
	);

	assert.deepEqual(calls, ['https://data.iana.org/rdap/dns.json']);
	assert.equal(output.asciiDomain, 'example.unsupported');
	assert.equal(output.isRegistered, null);
	assert.equal(output.source, null);
	assert.deepEqual(output.error, {
		code: 'TLD_NOT_SUPPORTED',
		message:
			'TLD ".unsupported" is not supported. This package supports .cn through CNNIC WHOIS and TLDs published in the IANA RDAP DNS bootstrap.',
	});
});

test('throws when every RDAP source fails', async () => {
	clearRdapBootstrapCache();
	const calls = [];
	await assert.rejects(
		lookupDomainRegistration(normalized, async (options) => {
			calls.push(options.url);
			if (options.url === 'https://data.iana.org/rdap/dns.json') {
				return { statusCode: 200, body: bootstrap };
			}

			return { statusCode: 500, body: {} };
		}),
		/All RDAP sources failed/,
	);
	assert.deepEqual(calls, [
		'https://data.iana.org/rdap/dns.json',
		'https://rdap.example.test/domain/example.com',
		'https://www.rdap.net/domain/example.com',
	]);
});

test('routes .cn through CNNIC WHOIS without RDAP fallback', async () => {
	const originalCreateConnection = net.createConnection;
	let connectCount = 0;
	let httpCalled = false;

	net.createConnection = function (options, connectionListener) {
		connectCount++;
		const socket = new (require('node:events').EventEmitter)();
		socket.write = () => {};
		socket.setEncoding = () => {};
		socket.setTimeout = () => {};
		socket.destroy = () => {};

		process.nextTick(() => {
			if (connectionListener) connectionListener();
			socket.emit(
				'data',
				[
					'Domain Name: example.cn',
					'ROID: 20050505s10001s11652376-cn',
					'Domain Status: ok',
					'Registration Time: 2021-07-09 12:16:35',
					'Expiration Time: 2027-07-09 12:16:35',
				].join('\n'),
			);
			socket.emit('close');
		});

		return socket;
	};

	try {
		const output = await lookupDomainRegistration(
			{ asciiDomain: 'example.cn', publicSuffix: 'cn', tld: 'cn' },
			async () => {
				httpCalled = true;
				throw new Error('RDAP should not be called for .cn');
			},
		);

		assert.equal(connectCount, 1);
		assert.equal(httpCalled, false);
		assert.equal(output.isRegistered, true);
		assert.equal(output.source.protocol, 'whois');
		assert.equal(output.error, null);
	} finally {
		net.createConnection = originalCreateConnection;
	}
});
