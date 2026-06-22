const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');

const {
	isRegistryWhoisTld,
	lookupRegistryWhoisDomainRegistration,
	mapRegistryWhoisResponse,
} = require('../dist/nodes/DomainLookup/whoisRegistry');
const {
	DOMAIN_LOOKUP_ERROR_CODES,
	DomainLookupError,
} = require('../dist/nodes/DomainLookup/domainUtils');

const normalizedIo = {
	asciiDomain: 'example.io',
	publicSuffix: 'io',
	tld: 'io',
};

const normalizedCo = {
	asciiDomain: 'example.co',
	publicSuffix: 'co',
	tld: 'co',
};

const ioProvider = {
	host: 'whois.nic.io',
	notFoundPatterns: [/Domain not found\./i],
};

const coProvider = {
	host: 'whois.registry.co',
	notFoundPatterns: [/DOMAIN NOT FOUND/i, /queried object does not exist/i],
};

const ioSource = {
	protocol: 'whois',
	type: 'authoritative',
	url: 'whois://whois.nic.io:43/example.io',
	fetchedAt: '2026-06-22T05:20:00.000Z',
};

const coSource = {
	protocol: 'whois',
	type: 'authoritative',
	url: 'whois://whois.registry.co:43/example.co',
	fetchedAt: '2026-06-22T05:20:00.000Z',
};

test('detects registry WHOIS TLDs', () => {
	assert.equal(isRegistryWhoisTld('io'), true);
	assert.equal(isRegistryWhoisTld('co'), true);
	assert.equal(isRegistryWhoisTld('cn'), false);
	assert.equal(isRegistryWhoisTld('com'), false);
});

test('maps .io WHOIS records to the standard output shape', () => {
	const output = mapRegistryWhoisResponse(
		[
			'Domain Name: example.io',
			'Updated Date: 2026-01-11T22:31:01Z',
			'Creation Date: 2021-11-22T01:38:41Z',
			'Registry Expiry Date: 2027-11-22T01:38:41Z',
			'Domain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited',
			'Name Server: B.NS.EXAMPLE.TEST',
			'Name Server: a.ns.example.test',
			'>>> Last update of WHOIS database: 2026-06-22T05:20:33Z <<<',
		].join('\n'),
		normalizedIo,
		ioSource,
		ioProvider,
		new Date('2026-06-22T00:00:00Z'),
	);

	assert.equal(output.isRegistered, true);
	assert.deepEqual(output.status, ['clienttransferprohibited']);
	assert.deepEqual(output.nameservers, ['a.ns.example.test', 'b.ns.example.test']);
	assert.equal(output.dates.registeredAt, '2021-11-22T01:38:41.000Z');
	assert.equal(output.dates.expiresAt, '2027-11-22T01:38:41.000Z');
	assert.equal(output.dates.lastChangedAt, '2026-01-11T22:31:01.000Z');
	assert.equal(output.dates.dataUpdatedAt, '2026-06-22T05:20:33.000Z');
	assert.equal(output.expiry.expiresAtTimestamp, Date.parse('2027-11-22T01:38:41.000Z'));
	assert.equal(output.expiry.isExpired, false);
	assert.equal(output.source.protocol, 'whois');
	assert.equal(output.error, null);
});

test('maps .co WHOIS records to the standard output shape', () => {
	const output = mapRegistryWhoisResponse(
		[
			'Domain Name: EXAMPLE.CO',
			'Updated Date: 2026-05-23T07:22:03.0Z',
			'Creation Date: 2026-05-18T07:19:58.0Z',
			'Registry Expiry Date: 2027-05-18T23:59:59.0Z',
			'Domain Status: serverTransferProhibited https://icann.org/epp#serverTransferProhibited',
			'Name Server: LENNOX.NS.EXAMPLE.TEST',
			'Name Server: LILYANA.NS.EXAMPLE.TEST',
			'>>> Last update of WHOIS database: 2026-06-22T05:19:18.0Z <<<',
		].join('\n'),
		normalizedCo,
		coSource,
		coProvider,
		new Date('2026-06-22T00:00:00Z'),
	);

	assert.equal(output.isRegistered, true);
	assert.deepEqual(output.status, ['servertransferprohibited']);
	assert.deepEqual(output.nameservers, ['lennox.ns.example.test', 'lilyana.ns.example.test']);
	assert.equal(output.dates.registeredAt, '2026-05-18T07:19:58.000Z');
	assert.equal(output.dates.expiresAt, '2027-05-18T23:59:59.000Z');
	assert.equal(output.dates.lastChangedAt, '2026-05-23T07:22:03.000Z');
	assert.equal(output.dates.dataUpdatedAt, '2026-06-22T05:19:18.000Z');
	assert.equal(output.source.protocol, 'whois');
	assert.equal(output.error, null);
});

test('maps registry WHOIS not-found responses to not registered', () => {
	const ioOutput = mapRegistryWhoisResponse(
		'Domain not found.',
		normalizedIo,
		ioSource,
		ioProvider,
	);
	const coOutput = mapRegistryWhoisResponse(
		'The queried object does not exist: DOMAIN NOT FOUND',
		normalizedCo,
		coSource,
		coProvider,
	);

	assert.equal(ioOutput.isRegistered, false);
	assert.equal(ioOutput.error, null);
	assert.equal(coOutput.isRegistered, false);
	assert.equal(coOutput.error, null);
});

test('lookupRegistryWhoisDomainRegistration sets fetchedAt after a successful WHOIS response', async () => {
	const originalCreateConnection = net.createConnection;
	let responseClosed = false;
	let fetchedAtCalls = 0;

	net.createConnection = function (options, connectionListener) {
		assert.equal(options.host, 'whois.nic.io');

		const socket = new (require('node:events').EventEmitter)();
		socket.write = () => {};
		socket.setEncoding = () => {};
		socket.setTimeout = () => {};
		socket.destroy = () => {};

		process.nextTick(() => {
			if (connectionListener) connectionListener();
			socket.emit(
				'data',
				'Domain Name: example.io\nCreation Date: 2021-11-22T01:38:41Z\nRegistry Expiry Date: 2027-11-22T01:38:41Z',
			);
			responseClosed = true;
			socket.emit('close');
		});

		return socket;
	};

	try {
		const output = await lookupRegistryWhoisDomainRegistration(
			normalizedIo,
			new Date('2026-06-22T00:00:00Z'),
			() => {
				fetchedAtCalls++;
				assert.equal(responseClosed, true);
				return '2026-06-22T05:21:00.000Z';
			},
		);

		assert.equal(fetchedAtCalls, 1);
		assert.equal(output.source.fetchedAt, '2026-06-22T05:21:00.000Z');
	} finally {
		net.createConnection = originalCreateConnection;
	}
});

test('mapRegistryWhoisResponse throws error for empty response', () => {
	assert.throws(
		() => mapRegistryWhoisResponse('   ', normalizedIo, ioSource, ioProvider),
		(error) =>
			error instanceof DomainLookupError &&
			error.code === DOMAIN_LOOKUP_ERROR_CODES.WHOIS_RESPONSE_PARSE_FAILED,
	);
});

test('mapRegistryWhoisResponse throws error for rate limiting response', () => {
	assert.throws(
		() => mapRegistryWhoisResponse('WHOIS LIMIT EXCEEDED', normalizedIo, ioSource, ioProvider),
		(error) =>
			error instanceof DomainLookupError &&
			error.code === DOMAIN_LOOKUP_ERROR_CODES.WHOIS_RATE_LIMITED,
	);
});

test('mapRegistryWhoisResponse throws error when domain name is missing', () => {
	assert.throws(
		() =>
			mapRegistryWhoisResponse(
				'Some random response\nLine 2 info',
				normalizedIo,
				ioSource,
				ioProvider,
			),
		(error) =>
			error instanceof DomainLookupError &&
			error.code === DOMAIN_LOOKUP_ERROR_CODES.WHOIS_RESPONSE_PARSE_FAILED &&
			error.message.includes('Some random response Line 2 info'),
	);
});

test('mapRegistryWhoisResponse throws error when domain name does not match', () => {
	assert.throws(
		() => mapRegistryWhoisResponse('Domain Name: different.io', normalizedIo, ioSource, ioProvider),
		(error) =>
			error instanceof DomainLookupError &&
			error.code === DOMAIN_LOOKUP_ERROR_CODES.WHOIS_RESPONSE_PARSE_FAILED &&
			error.message.includes('different.io'),
	);
});

test('lookupRegistryWhoisDomainRegistration reports WHOIS_SOURCE_UNAVAILABLE on socket errors', async () => {
	const originalCreateConnection = net.createConnection;

	net.createConnection = function (options, connectionListener) {
		const socket = new (require('node:events').EventEmitter)();
		socket.write = () => {};
		socket.setEncoding = () => {};
		socket.setTimeout = () => {};
		socket.destroy = () => {};

		process.nextTick(() => {
			if (connectionListener) connectionListener();
			socket.emit('error', new Error('connect ECONNREFUSED'));
		});

		return socket;
	};

	try {
		await assert.rejects(
			() => lookupRegistryWhoisDomainRegistration(normalizedIo, new Date('2026-06-22T00:00:00Z')),
			(error) =>
				error instanceof DomainLookupError &&
				error.code === DOMAIN_LOOKUP_ERROR_CODES.WHOIS_SOURCE_UNAVAILABLE,
		);
	} finally {
		net.createConnection = originalCreateConnection;
	}
});

test('lookupRegistryWhoisDomainRegistration reports WHOIS_SOURCE_UNAVAILABLE on timeouts', async () => {
	const originalCreateConnection = net.createConnection;

	net.createConnection = function (options, connectionListener) {
		const socket = new (require('node:events').EventEmitter)();
		socket.write = () => {};
		socket.setEncoding = () => {};
		socket.setTimeout = () => {};
		socket.destroy = (error) => {
			process.nextTick(() => socket.emit('error', error));
		};

		process.nextTick(() => {
			if (connectionListener) connectionListener();
			socket.emit('timeout');
		});

		return socket;
	};

	try {
		await assert.rejects(
			() => lookupRegistryWhoisDomainRegistration(normalizedIo, new Date('2026-06-22T00:00:00Z')),
			(error) =>
				error instanceof DomainLookupError &&
				error.code === DOMAIN_LOOKUP_ERROR_CODES.WHOIS_SOURCE_UNAVAILABLE,
		);
	} finally {
		net.createConnection = originalCreateConnection;
	}
});
