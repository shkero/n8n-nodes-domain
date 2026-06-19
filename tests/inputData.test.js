const assert = require('node:assert/strict');
const test = require('node:test');

const { buildInputDataConfig, mergeInputData } = require('../dist/nodes/DomainLookup/inputData');
const { createFailureOutput } = require('../dist/nodes/DomainLookup/output');

const normalized = {
	asciiDomain: 'example.com',
	publicSuffix: 'com',
	tld: 'com',
};

test('leaves output unchanged when input data inclusion is disabled', () => {
	const output = {
		asciiDomain: 'example.com',
		publicSuffix: 'com',
		isRegistered: true,
	};
	const config = buildInputDataConfig({});

	const merged = mergeInputData(output, { id: 1, domain: 'api.example.com' }, config);

	assert.strictEqual(merged, output);
	assert.deepEqual(merged, {
		asciiDomain: 'example.com',
		publicSuffix: 'com',
		isRegistered: true,
	});
});

test('includes all input json fields when all fields mode is enabled', () => {
	const inputJson = {
		id: 1,
		domain: 'api.example.com',
		empty: '',
		tags: [],
		value: null,
		customer: {
			name: 'Alice',
		},
	};
	const config = buildInputDataConfig({
		includeInputData: true,
	});

	const merged = mergeInputData({ asciiDomain: 'example.com' }, inputJson, config);
	inputJson.customer.name = 'Changed';

	assert.deepEqual(merged.input, {
		id: 1,
		domain: 'api.example.com',
		empty: '',
		tags: [],
		value: null,
		customer: {
			name: 'Alice',
		},
	});
});

test('uses a custom input data field name', () => {
	const config = buildInputDataConfig({
		includeInputData: true,
		inputFieldName: 'sourceItem',
	});

	const merged = mergeInputData({ asciiDomain: 'example.com' }, { id: 1 }, config);

	assert.deepEqual(merged, {
		asciiDomain: 'example.com',
		sourceItem: {
			id: 1,
		},
	});
});

test('selects input fields and preserves nested paths', () => {
	const config = buildInputDataConfig({
		includeInputData: true,
		inputDataMode: 'selectedFields',
		inputFields: 'id, customer.name\ncustomer.name',
	});

	const merged = mergeInputData(
		{ asciiDomain: 'example.com' },
		{
			id: 1,
			customer: {
				name: 'Alice',
				email: 'a@example.com',
			},
		},
		config,
	);

	assert.deepEqual(merged.input, {
		id: 1,
		customer: {
			name: 'Alice',
		},
	});
});

test('ignores selected input fields that do not exist', () => {
	const config = buildInputDataConfig({
		includeInputData: true,
		inputDataMode: 'selectedFields',
		inputFields: 'missing, customer.phone',
	});

	const merged = mergeInputData(
		{ asciiDomain: 'example.com' },
		{
			id: 1,
			customer: {
				name: 'Alice',
			},
		},
		config,
	);

	assert.deepEqual(merged.input, {});
});

test('rejects an empty selected input fields list', () => {
	assert.throws(
		() =>
			buildInputDataConfig({
				includeInputData: true,
				inputDataMode: 'selectedFields',
				inputFields: '  , \n ',
			}),
		/Input Fields must contain at least one field/,
	);
});

test('rejects reserved input data field names', () => {
	assert.throws(
		() =>
			buildInputDataConfig({
				includeInputData: true,
				inputFieldName: 'source',
			}),
		/conflicts with a reserved output field/,
	);
});

test('rejects dotted input data field names', () => {
	assert.throws(
		() =>
			buildInputDataConfig({
				includeInputData: true,
				inputFieldName: 'meta.input',
			}),
		/Input Field Name must start with a letter or underscore/,
	);
});

test('can merge input data into a continue-on-fail lookup output', () => {
	const config = buildInputDataConfig({
		includeInputData: true,
		inputFieldName: 'input',
	});
	const failureOutput = createFailureOutput(
		normalized,
		'RDAP_SOURCE_UNAVAILABLE',
		'All RDAP sources failed',
	);

	const merged = mergeInputData(failureOutput, { id: 1, domain: 'api.example.com' }, config);

	assert.equal(merged.isRegistered, null);
	assert.deepEqual(merged.input, {
		id: 1,
		domain: 'api.example.com',
	});
	assert.deepEqual(merged.error, {
		code: 'RDAP_SOURCE_UNAVAILABLE',
		message: 'All RDAP sources failed',
	});
});
