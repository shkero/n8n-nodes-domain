const assert = require('node:assert/strict');
const test = require('node:test');

const { mapCnnicWhoisResponse } = require('../dist/nodes/DomainLookup/whoisCn');

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
	assert.equal(output.expiry.isExpired, false);
	assert.equal(output.source.protocol, 'whois');
	assert.equal(output.source.type, 'authoritative');
	assert.equal(output.error, undefined);
});

test('maps CNNIC WHOIS no matching record to not registered', () => {
	const output = mapCnnicWhoisResponse('No matching record.', normalized, source);

	assert.equal(output.isRegistered, false);
	assert.deepEqual(output.status, []);
	assert.deepEqual(output.nameservers, []);
	assert.equal(output.source.protocol, 'whois');
});
