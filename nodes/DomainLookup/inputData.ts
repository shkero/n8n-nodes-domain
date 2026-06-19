export type InputDataMode = 'allFields' | 'selectedFields';

export interface InputDataOptions {
	includeInputData?: boolean;
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
	inputFields?: string[];
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

export function buildInputDataConfig(options: InputDataOptions): InputDataConfig {
	if (options.includeInputData !== true) {
		return {
			includeInputData: false,
		};
	}

	const inputFieldName = options.inputFieldName?.trim() || 'input';
	validateInputFieldName(inputFieldName);

	const inputDataMode = options.inputDataMode === 'selectedFields' ? 'selectedFields' : 'allFields';
	if (inputDataMode === 'selectedFields') {
		const inputFields = parseInputFields(options.inputFields ?? '');
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

function parseInputFields(inputFields: string): string[] {
	const seen = new Set<string>();
	const fields: string[] = [];

	for (const field of inputFields.split(/[,\n]/)) {
		const normalized = field.trim();
		if (normalized.length === 0 || seen.has(normalized)) {
			continue;
		}

		seen.add(normalized);
		fields.push(normalized);
	}

	return fields;
}

function pickInputFields(
	inputJson: Record<string, unknown>,
	inputFields: string[],
): Record<string, unknown> {
	const picked: Record<string, unknown> = {};

	for (const inputField of inputFields) {
		const path = inputField.split('.').map((segment) => segment.trim());
		if (path.some((segment) => segment.length === 0 || !isSafePathSegment(segment))) {
			continue;
		}

		const value = getPathValue(inputJson, path);
		if (value === undefined) {
			continue;
		}

		setPathValue(picked, path, cloneJsonValue(value));
	}

	return picked;
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
