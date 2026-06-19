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
		inputData: {},
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
		inputData: {
			inputFieldName: 'sourceItem',
		},
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
		inputData: {
			inputDataMode: 'selectedFields',
			inputFields: 'id, customer.name\ncustomer.name',
		},
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

test('selects Chinese input fields using dot and bracket paths', () => {
	const config = buildInputDataConfig({
		inputData: {
			inputDataMode: 'selectedFields',
			inputFields:
				'recordId, fields.中文字段.text, fields["中文字段"].title, $json.fields["到期时间"]',
		},
	});

	const merged = mergeInputData(
		{ asciiDomain: 'example.cn' },
		{
			recordId: 'rec_test_001',
			fields: {
				中文字段: {
					title: 'example.cn',
					text: 'https://www.example.cn',
					favicon: '',
				},
				domain: 'example.cn',
				剩余时间: 1.5,
				到期时间: 1781918650000,
			},
		},
		config,
	);

	assert.deepEqual(merged.input, {
		recordId: 'rec_test_001',
		fields: {
			中文字段: {
				title: 'example.cn',
				text: 'https://www.example.cn',
			},
			到期时间: 1781918650000,
		},
	});
});

test('selects input fields from n8n expression-wrapped json paths', () => {
	const config = buildInputDataConfig({
		inputData: {
			inputDataMode: 'selectedFields',
			inputFields: '={{ $json.fields["中文字段"].text }}\n{{ json.fields.domain }}',
		},
	});

	const merged = mergeInputData(
		{ asciiDomain: 'example.cn' },
		{
			fields: {
				中文字段: {
					text: 'https://www.example.cn',
				},
				domain: 'example.cn',
			},
		},
		config,
	);

	assert.deepEqual(merged.input, {
		fields: {
			中文字段: {
				text: 'https://www.example.cn',
			},
			domain: 'example.cn',
		},
	});
});

test('ignores selected input fields that do not exist', () => {
	const config = buildInputDataConfig({
		inputData: {
			inputDataMode: 'selectedFields',
			inputFields: 'missing, customer.phone',
		},
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

test('selects input fields with array indexes', () => {
	const config = buildInputDataConfig({
		inputData: {
			inputDataMode: 'selectedFields',
			inputFields: 'rows[0].name, rows[1]["中文字段"]',
		},
	});

	const merged = mergeInputData(
		{ asciiDomain: 'example.com' },
		{
			rows: [
				{
					name: 'Alice',
					中文字段: 'ignored',
				},
				{
					name: 'Bob',
					中文字段: 'example.cn',
				},
			],
		},
		config,
	);

	assert.deepEqual(merged.input, {
		rows: [
			{
				name: 'Alice',
			},
			{
				中文字段: 'example.cn',
			},
		],
	});
});

test('reads input data values from a fixed collection array', () => {
	const config = buildInputDataConfig({
		inputData: [
			{
				inputDataMode: 'selectedFields',
				inputFields: 'id',
			},
		],
	});

	const merged = mergeInputData({ asciiDomain: 'example.com' }, { id: 1, name: 'Alice' }, config);

	assert.deepEqual(merged.input, {
		id: 1,
	});
});

test('rejects unsupported input field expressions', () => {
	assert.throws(
		() =>
			buildInputDataConfig({
				inputData: {
					inputDataMode: 'selectedFields',
					inputFields: '={{ $json.recordId + "-suffix" }}',
				},
			}),
		/not a supported field path/,
	);
});

test('rejects an empty selected input fields list', () => {
	assert.throws(
		() =>
			buildInputDataConfig({
				inputData: {
					inputDataMode: 'selectedFields',
					inputFields: '  , \n ',
				},
			}),
		/Input Fields must contain at least one field/,
	);
});

test('rejects reserved input data field names', () => {
	assert.throws(
		() =>
			buildInputDataConfig({
				inputData: {
					inputFieldName: 'source',
				},
			}),
		/conflicts with a reserved output field/,
	);
});

test('rejects dotted input data field names', () => {
	assert.throws(
		() =>
			buildInputDataConfig({
				inputData: {
					inputFieldName: 'meta.input',
				},
			}),
		/Input Field Name must start with a letter or underscore/,
	);
});

test('can merge input data into a continue-on-fail lookup output', () => {
	const config = buildInputDataConfig({
		inputData: {
			inputFieldName: 'input',
		},
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
