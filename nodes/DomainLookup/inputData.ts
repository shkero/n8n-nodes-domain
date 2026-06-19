export type InputDataMode = 'allFields' | 'selectedFields';
type InputFieldPath = string[];

export interface InputDataOptions {
	inputData?: InputDataValues | InputDataValues[];
}

export interface InputDataValues {
	inputDataMode?: InputDataMode;
	inputFieldName?: string;
	inputFields?: string;
}

interface IncludeDisabledConfig {
	includeInputData: false;
}

interface IncludeEnabledConfig {
	includeInputData: true;
	inputDataMode: InputDataMode;
	inputFieldName: string;
	inputFields?: InputFieldPath[];
}

export type InputDataConfig = IncludeDisabledConfig | IncludeEnabledConfig;

const RESERVED_OUTPUT_FIELDS = new Set([
	'asciiDomain',
	'publicSuffix',
	'isRegistered',
	'status',
	'dates',
	'expiry',
	'nameservers',
	'source',
	'error',
]);

const INPUT_FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class InputDataConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InputDataConfigurationError';
	}
}

export function buildInputDataConfig(
	options: InputDataOptions,
	rawOptions: InputDataOptions = options,
): InputDataConfig {
	const inputData = getInputDataValues(options);
	if (!inputData) {
		return {
			includeInputData: false,
		};
	}

	const inputFieldName = inputData.inputFieldName?.trim() || 'input';
	validateInputFieldName(inputFieldName);

	const inputDataMode =
		inputData.inputDataMode === 'selectedFields' ? 'selectedFields' : 'allFields';
	if (inputDataMode === 'selectedFields') {
		const rawInputData = getInputDataValues(rawOptions);
		const inputFields = parseInputFields(rawInputData?.inputFields ?? inputData.inputFields ?? '');
		if (inputFields.length === 0) {
			throw new InputDataConfigurationError(
				'Input Fields must contain at least one field when Input Data Mode is "Selected Fields".',
			);
		}

		return {
			includeInputData: true,
			inputDataMode,
			inputFieldName,
			inputFields,
		};
	}

	return {
		includeInputData: true,
		inputDataMode,
		inputFieldName,
	};
}

function getInputDataValues(options: InputDataOptions): InputDataValues | null {
	if (!options.inputData) {
		return null;
	}

	if (Array.isArray(options.inputData)) {
		return options.inputData[0] ?? null;
	}

	return options.inputData;
}

export function mergeInputData(
	output: Record<string, unknown>,
	inputJson: Record<string, unknown>,
	config: InputDataConfig,
): Record<string, unknown> {
	if (!config.includeInputData) {
		return output;
	}

	const inputData =
		config.inputDataMode === 'selectedFields'
			? pickInputFields(inputJson, config.inputFields ?? [])
			: cloneJsonValue(inputJson);

	return {
		...output,
		[config.inputFieldName]: inputData,
	};
}

function validateInputFieldName(inputFieldName: string): void {
	if (!INPUT_FIELD_NAME_PATTERN.test(inputFieldName)) {
		throw new InputDataConfigurationError(
			'Input Field Name must start with a letter or underscore and contain only letters, numbers, or underscores.',
		);
	}

	if (RESERVED_OUTPUT_FIELDS.has(inputFieldName)) {
		throw new InputDataConfigurationError(
			`Input Field Name "${inputFieldName}" conflicts with a reserved output field. Please choose another name.`,
		);
	}
}

function parseInputFields(inputFields: string): InputFieldPath[] {
	const seen = new Set<string>();
	const fields: InputFieldPath[] = [];

	for (const field of splitInputFields(inputFields)) {
		const path = parseInputFieldPath(field);
		if (!path) {
			continue;
		}

		const key = path.join('\u0000');
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		fields.push(path);
	}

	return fields;
}

function pickInputFields(
	inputJson: Record<string, unknown>,
	inputFields: InputFieldPath[],
): Record<string, unknown> {
	const picked: Record<string, unknown> = {};

	for (const path of inputFields) {
		const value = getPathValue(inputJson, path);
		if (value === undefined) {
			continue;
		}

		setPathValue(picked, path, cloneJsonValue(value));
	}

	return picked;
}

function splitInputFields(inputFields: string): string[] {
	const fields: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;
	let bracketDepth = 0;
	let isEscaped = false;

	for (const character of inputFields) {
		if (quote) {
			current += character;

			if (isEscaped) {
				isEscaped = false;
			} else if (character === '\\') {
				isEscaped = true;
			} else if (character === quote) {
				quote = null;
			}

			continue;
		}

		if (character === '"' || character === "'") {
			quote = character;
			current += character;
			continue;
		}

		if (character === '[') {
			bracketDepth += 1;
			current += character;
			continue;
		}

		if (character === ']') {
			bracketDepth = Math.max(0, bracketDepth - 1);
			current += character;
			continue;
		}

		if ((character === ',' || character === '\n') && bracketDepth === 0) {
			fields.push(current);
			current = '';
			continue;
		}

		current += character;
	}

	fields.push(current);
	return fields;
}

function parseInputFieldPath(inputField: string): InputFieldPath | null {
	const normalized = stripExpressionWrapper(inputField).trim();
	if (normalized.length === 0) {
		return null;
	}

	const withoutJsonPrefix = stripJsonPrefix(normalized);
	const path = tokenizeInputFieldPath(withoutJsonPrefix);
	if (!path || path.length === 0) {
		return null;
	}

	return path.every((segment) => segment.length > 0 && isSafePathSegment(segment)) ? path : null;
}

function stripExpressionWrapper(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('={{') && trimmed.endsWith('}}')) {
		return trimmed.slice(3, -2).trim();
	}

	if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
		return trimmed.slice(2, -2).trim();
	}

	return trimmed;
}

function stripJsonPrefix(value: string): string {
	if (value === '$json' || value === 'json') {
		return '';
	}

	if (value.startsWith('$json.')) {
		return value.slice('$json.'.length);
	}

	if (value.startsWith('$json[')) {
		return value.slice('$json'.length);
	}

	if (value.startsWith('json.')) {
		return value.slice('json.'.length);
	}

	if (value.startsWith('json[')) {
		return value.slice('json'.length);
	}

	return value;
}

function tokenizeInputFieldPath(value: string): InputFieldPath | null {
	const path: string[] = [];
	let index = 0;

	while (index < value.length) {
		const character = value[index];
		if (character === '.') {
			index += 1;
			continue;
		}

		if (character === '[') {
			const result = readBracketSegment(value, index);
			if (!result) {
				return null;
			}

			path.push(result.segment);
			index = result.nextIndex;
			continue;
		}

		const start = index;
		while (index < value.length && value[index] !== '.' && value[index] !== '[') {
			index += 1;
		}

		const segment = value.slice(start, index).trim();
		if (segment.length === 0) {
			return null;
		}

		path.push(segment);
	}

	return path;
}

function readBracketSegment(
	value: string,
	startIndex: number,
): { segment: string; nextIndex: number } | null {
	let index = startIndex + 1;
	while (value[index] === ' ' || value[index] === '\t') {
		index += 1;
	}

	const quote = value[index];
	if (quote !== '"' && quote !== "'") {
		return null;
	}

	index += 1;
	let segment = '';
	let isEscaped = false;
	while (index < value.length) {
		const character = value[index];
		if (isEscaped) {
			segment += character;
			isEscaped = false;
			index += 1;
			continue;
		}

		if (character === '\\') {
			isEscaped = true;
			index += 1;
			continue;
		}

		if (character === quote) {
			index += 1;
			break;
		}

		segment += character;
		index += 1;
	}

	while (value[index] === ' ' || value[index] === '\t') {
		index += 1;
	}

	if (value[index] !== ']') {
		return null;
	}

	return {
		segment,
		nextIndex: index + 1,
	};
}

function getPathValue(source: unknown, path: string[]): unknown {
	let current = source;
	for (const segment of path) {
		if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
			return undefined;
		}

		current = current[segment];
	}

	return current;
}

function setPathValue(target: Record<string, unknown>, path: string[], value: unknown): void {
	let current = target;
	for (let index = 0; index < path.length - 1; index += 1) {
		const segment = path[index];
		const next = current[segment];

		if (!isRecord(next)) {
			current[segment] = {};
		}

		current = current[segment] as Record<string, unknown>;
	}

	current[path[path.length - 1]] = value;
}

function cloneJsonValue<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafePathSegment(segment: string): boolean {
	return segment !== '__proto__' && segment !== 'prototype' && segment !== 'constructor';
}
