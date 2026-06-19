const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeDomainInput } = require('../dist/nodes/DomainLookup/domainUtils');

test('normalizes a bare domain', () => {
	assert.deepEqual(normalizeDomainInput('Example.COM'), {
		asciiDomain: 'example.com',
		publicSuffix: 'com',
		tld: 'com',
	});
});

test('normalizes http URLs and removes paths', () => {
	assert.deepEqual(normalizeDomainInput('https://api.shop.example.co.uk/path?q=1'), {
		asciiDomain: 'example.co.uk',
		publicSuffix: 'co.uk',
		tld: 'uk',
	});

	assert.deepEqual(normalizeDomainInput('example.com/path?q=1#top'), {
		asciiDomain: 'example.com',
		publicSuffix: 'com',
		tld: 'com',
	});
});

test('uses ICANN public suffixes and ignores private suffixes', () => {
	assert.deepEqual(normalizeDomainInput('foo.github.io'), {
		asciiDomain: 'github.io',
		publicSuffix: 'io',
		tld: 'io',
	});
});

test('rejects non-ASCII domains', () => {
	assert.throws(() => normalizeDomainInput('例子.测试'), /Only ASCII domains/);
	assert.throws(() => normalizeDomainInput('xn--fsqu00a.xn--0zwm56d'), /IDN domains/);
});

test('rejects unsupported input forms', () => {
	assert.throws(() => normalizeDomainInput('admin@example.com'), /Email addresses/);
	assert.throws(() => normalizeDomainInput('ftp://example.com'), /Only http/);
	assert.throws(
		() => normalizeDomainInput('https://user:pass@example.com'),
		/username or password/,
	);
	assert.throws(() => normalizeDomainInput('co.uk'), /registrable domain/);
	assert.throws(() => normalizeDomainInput('127.0.0.1'), /IP addresses/);
	assert.throws(() => normalizeDomainInput('*.example.com'), /Wildcard/);
});
