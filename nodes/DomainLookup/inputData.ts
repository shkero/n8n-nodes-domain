export type InputDataMode = 'allFields' | 'selectedFields';
type InputFieldPath = InputFieldPathSegment[];
type InputFieldPathSegment = string | number;

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

export function buildInputDataConfig(options: InputDataOptions = {}): InputDataConfig {
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
		const inputFields = parseInputFields(inputData.inputFields ?? '');
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
		const normalizedField = field.trim();
		if (normalizedField.length === 0) {
			continue;
		}

		const path = parseInputFieldPath(normalizedField);
		if (!path) {
			throw new InputDataConfigurationError(
				`Input Field "${normalizedField}" is not a supported field path.`,
			);
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

	return path.every((segment) => {
		return (typeof segment === 'number' || segment.length > 0) && isSafePathSegment(segment);
	})
		? path
		: null;
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
	const path: InputFieldPath = [];
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
		if (segment.length === 0 || !isValidDotPathSegment(segment)) {
			return null;
		}

		path.push(isArrayIndex(segment) ? Number(segment) : segment);
	}

	return path;
}

function readBracketSegment(
	value: string,
	startIndex: number,
): { segment: InputFieldPathSegment; nextIndex: number } | null {
	let index = startIndex + 1;
	while (value[index] === ' ' || value[index] === '\t') {
		index += 1;
	}

	const quote = value[index];
	if (quote !== '"' && quote !== "'") {
		const numberStartIndex = index;
		while (isDigit(value[index])) {
			index += 1;
		}

		const indexText = value.slice(numberStartIndex, index);
		while (value[index] === ' ' || value[index] === '\t') {
			index += 1;
		}

		if (!isArrayIndex(indexText) || value[index] !== ']') {
			return null;
		}

		return {
			segment: Number(indexText),
			nextIndex: index + 1,
		};
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

function getPathValue(source: unknown, path: InputFieldPath): unknown {
	let current = source;
	for (const segment of path) {
		if (typeof segment === 'number') {
			if (!Array.isArray(current) || segment >= current.length) {
				return undefined;
			}

			current = current[segment];
			continue;
		}

		if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
			return undefined;
		}

		current = current[segment];
	}

	return current;
}

function setPathValue(target: Record<string, unknown>, path: InputFieldPath, value: unknown): void {
	if (typeof path[0] !== 'string') {
		return;
	}

	let current: Record<string, unknown> | unknown[] = target;
	for (let index = 0; index < path.length - 1; index += 1) {
		const segment = path[index];
		const nextSegment = path[index + 1];
		const next = getContainerValue(current, segment);

		if (!isRecord(next) && !Array.isArray(next)) {
			setContainerValue(current, segment, typeof nextSegment === 'number' ? [] : {});
		}

		const created = getContainerValue(current, segment);
		if (!isRecord(created) && !Array.isArray(created)) {
			return;
		}

		current = created;
	}

	setContainerValue(current, path[path.length - 1], value);
}

function cloneJsonValue<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getContainerValue(
	container: Record<string, unknown> | unknown[],
	segment: InputFieldPathSegment,
): unknown {
	if (typeof segment === 'number') {
		return Array.isArray(container) ? container[segment] : undefined;
	}

	return isRecord(container) ? container[segment] : undefined;
}

function setContainerValue(
	container: Record<string, unknown> | unknown[],
	segment: InputFieldPathSegment,
	value: unknown,
): void {
	if (typeof segment === 'number') {
		if (Array.isArray(container)) {
			container[segment] = value;
		}
		return;
	}

	if (isRecord(container)) {
		container[segment] = value;
	}
}

function isSafePathSegment(segment: InputFieldPathSegment): boolean {
	if (typeof segment === 'number') {
		return Number.isSafeInteger(segment) && segment >= 0;
	}

	return segment !== '__proto__' && segment !== 'prototype' && segment !== 'constructor';
}

function isArrayIndex(value: string): boolean {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		return false;
	}

	const index = Number(value);
	return Number.isSafeInteger(index) && index >= 0;
}

function isDigit(value: string | undefined): boolean {
	return typeof value === 'string' && value >= '0' && value <= '9';
}

function isValidDotPathSegment(segment: string): boolean {
	return !/[\s.[\]{}()+\-*/'"`,]/u.test(segment);
}
