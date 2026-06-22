const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');

const {
	mapCnnicWhoisResponse,
	lookupCnDomainRegistration,
} = require('../dist/nodes/DomainLookup/whoisCn');
const {
	DOMAIN_LOOKUP_ERROR_CODES,
	DomainLookupError,
} = require('../dist/nodes/DomainLookup/domainUtils');

const normalized = {
	asciiDomain: 'example.cn',
	publicSuffix: 'cn',
	tld: 'cn',
};

const source = {
	protocol: 'whois',
	type: 'authoritative',
	url: 'whois://whois.cnnic.cn:43/example.cn',
	fetchedAt: '2026-06-19T03:20:00.000Z',
};

test('maps CNNIC WHOIS domain records to the standard output shape', () => {
	const output = mapCnnicWhoisResponse(
		[
			'Domain Name: example.cn',
			'ROID: 20050505s10001s11652376-cn',
			'Domain Status: clientDeleteProhibited',
			'Domain Status: clientTransferProhibited',
			'Registrant: redacted by test',
			'Registrant Contact Email: redacted@example.test',
			'Name Server: dns9.66.cn',
			'Name Server: dns8.66.cn',
			'Registration Time: 2005-05-05 05:38:46',
			'Expiration Time: 2027-05-05 05:38:46',
			'DNSSEC: unsigned',
		].join('\n'),
		normalized,
		source,
		new Date('2026-06-19T00:00:00Z'),
	);

	assert.equal(output.isRegistered, true);
	assert.deepEqual(output.status, ['clientdeleteprohibited', 'clienttransferprohibited']);
	assert.deepEqual(output.nameservers, ['dns8.66.cn', 'dns9.66.cn']);
	assert.equal(output.dates.registeredAt, '2005-05-05T05:38:46.000Z');
	assert.equal(output.dates.expiresAt, '2027-05-05T05:38:46.000Z');
	assert.equal(output.dates.lastChangedAt, null);
	assert.equal(output.dates.dataUpdatedAt, null);
	assert.equal(output.expiry.expiresAtTimestamp, Date.parse('2027-05-05T05:38:46.000Z'));
	assert.equal(output.expiry.isExpired, false);
	assert.equal(output.source.protocol, 'whois');
	assert.equal(output.source.type, 'authoritative');
	assert.equal(output.error, null);
});

test('maps CNNIC WHOIS no matching record to not registered', () => {
	const output = mapCnnicWhoisResponse('No matching record.', normalized, source);

	assert.equal(output.isRegistered, false);
	assert.deepEqual(output.status, []);
	assert.deepEqual(output.nameservers, []);
	assert.equal(output.expiry.expiresAtTimestamp, null);
	assert.equal(output.source.protocol, 'whois');
	assert.equal(output.error, null);
});

test('lookupCnDomainRegistration sets fetchedAt after a successful WHOIS response', async () => {
	const originalCreateConnection = net.createConnection;
	let responseClosed = false;
	let fetchedAtCalls = 0;

	net.createConnection = function (options, connectionListener) {
		const socket = new (require('node:events').EventEmitter)();
		socket.write = () => {};
		socket.setEncoding = () => {};
		socket.setTimeout = () => {};
		socket.destroy = () => {};

		process.nextTick(() => {
			if (connectionListener) connectionListener();
			socket.emit(
				'data',
				'Domain Name: example.cn\nROID: 1-cn\nDomain Status: ok\nRegistration Time: 2021-07-09 12:16:35\nExpiration Time: 2027-07-09 12:16:35',
			);
			responseClosed = true;
			socket.emit('close');
		});

		return socket;
	};

	try {
		const output = await lookupCnDomainRegistration(
			normalized,
			new Date('2026-06-19T00:00:00Z'),
			() => {
				fetchedAtCalls++;
				assert.equal(responseClosed, true);
				return '2026-06-19T03:21:00.000Z';
			},
		);

		assert.equal(fetchedAtCalls, 1);
		assert.equal(output.source.fetchedAt, '2026-06-19T03:21:00.000Z');
	} finally {
		net.createConnection = originalCreateConnection;
	}
});

test('mapCnnicWhoisResponse throws error for empty response', () => {
	assert.throws(
		() => mapCnnicWhoisResponse('   ', normalized, source),
		(error) =>
			error instanceof DomainLookupError &&
			error.code === DOMAIN_LOOKUP_ERROR_CODES.CNNIC_WHOIS_RESPONSE_PARSE_FAILED,
	);
});

test('mapCnnicWhoisResponse throws error for rate limiting response', () => {
	assert.throws(
		() => mapCnnicWhoisResponse('Queried interval is too short.', normalized, source),
		(error) =>
			error instanceof DomainLookupError &&
			error.code === DOMAIN_LOOKUP_ERROR_CODES.CNNIC_WHOIS_RATE_LIMITED,
	);
});

test('mapCnnicWhoisResponse throws error and contains snippet when domain name is missing', () => {
	assert.throws(
		() => mapCnnicWhoisResponse('Some random error occurred\nLine 2 info', normalized, source),
		(error) =>
			error instanceof DomainLookupError &&
			error.code === DOMAIN_LOOKUP_ERROR_CODES.CNNIC_WHOIS_RESPONSE_PARSE_FAILED &&
			error.message.includes('Some random error occurred Line 2 info'),
	);
});

test('mapCnnicWhoisResponse throws error when domain name does not match', () => {
	assert.throws(
		() => mapCnnicWhoisResponse('Domain Name: different.cn', normalized, source),
		(error) =>
			error instanceof DomainLookupError &&
			error.code === DOMAIN_LOOKUP_ERROR_CODES.CNNIC_WHOIS_RESPONSE_PARSE_FAILED &&
			error.message.includes('different.cn'),
	);
});

test('lookupCnDomainRegistration retries on rate limit and succeeds if eventual response is successful', async () => {
	const originalCreateConnection = net.createConnection;
	const mockResponses = [
		'Queried interval is too short.',
		'Queried interval is too short.',
		'Domain Name: example.cn\nROID: 1-cn\nDomain Status: ok\nRegistration Time: 2021-07-09 12:16:35\nExpiration Time: 2027-07-09 12:16:35',
	];
	let connectCount = 0;
	let finalResponseClosed = false;
	let fetchedAtCalls = 0;

	net.createConnection = function (options, connectionListener) {
		connectCount++;
		const socket = new (require('node:events').EventEmitter)();
		socket.write = () => {};
		socket.setEncoding = () => {};
		socket.setTimeout = () => {};
		socket.destroy = () => {};

		process.nextTick(() => {
			if (connectionListener) connectionListener();
			const response = mockResponses.shift() || '';
			socket.emit('data', response);
			finalResponseClosed = response.startsWith('Domain Name:');
			socket.emit('close');
		});

		return socket;
	};

	try {
		const output = await lookupCnDomainRegistration(
			normalized,
			new Date('2026-06-19T00:00:00Z'),
			() => {
				fetchedAtCalls++;
				assert.equal(finalResponseClosed, true);
				return '2026-06-19T03:22:00.000Z';
			},
		);
		assert.equal(connectCount, 3);
		assert.equal(fetchedAtCalls, 1);
		assert.equal(output.isRegistered, true);
		assert.equal(output.source.fetchedAt, '2026-06-19T03:22:00.000Z');
	} finally {
		net.createConnection = originalCreateConnection;
	}
});

test('lookupCnDomainRegistration fails after max retries if rate limiting persists', async () => {
	const originalCreateConnection = net.createConnection;
	const mockResponses = [
		'Queried interval is too short.',
		'Queried interval is too short.',
		'Queried interval is too short.',
		'Queried interval is too short.',
	];
	let connectCount = 0;

	net.createConnection = function (options, connectionListener) {
		connectCount++;
		const socket = new (require('node:events').EventEmitter)();
		socket.write = () => {};
		socket.setEncoding = () => {};
		socket.setTimeout = () => {};
		socket.destroy = () => {};

		process.nextTick(() => {
			if (connectionListener) connectionListener();
			const response = mockResponses.shift() || '';
			socket.emit('data', response);
			socket.emit('close');
		});

		return socket;
	};

	try {
		await assert.rejects(
			() => lookupCnDomainRegistration(normalized, new Date('2026-06-19T00:00:00Z')),
			(error) =>
				error instanceof DomainLookupError &&
				error.code === DOMAIN_LOOKUP_ERROR_CODES.CNNIC_WHOIS_RATE_LIMITED,
		);
		assert.equal(connectCount, 3); // 1 initial + 2 retries
	} finally {
		net.createConnection = originalCreateConnection;
	}
});

test('lookupCnDomainRegistration reports CNNIC_WHOIS_UNAVAILABLE on socket errors', async () => {
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
			() => lookupCnDomainRegistration(normalized, new Date('2026-06-19T00:00:00Z')),
			(error) =>
				error instanceof DomainLookupError &&
				error.code === DOMAIN_LOOKUP_ERROR_CODES.CNNIC_WHOIS_UNAVAILABLE,
		);
	} finally {
		net.createConnection = originalCreateConnection;
	}
});

test('lookupCnDomainRegistration reports CNNIC_WHOIS_UNAVAILABLE on timeouts', async () => {
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
			() => lookupCnDomainRegistration(normalized, new Date('2026-06-19T00:00:00Z')),
			(error) =>
				error instanceof DomainLookupError &&
				error.code === DOMAIN_LOOKUP_ERROR_CODES.CNNIC_WHOIS_UNAVAILABLE,
		);
	} finally {
		net.createConnection = originalCreateConnection;
	}
});
