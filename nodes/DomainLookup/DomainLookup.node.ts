import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	DOMAIN_LOOKUP_ERROR_CODES,
	DomainLookupError,
	normalizeDomainInput,
	type NormalizedDomain,
} from './domainUtils';
import {
	buildInputDataConfig,
	InputDataConfigurationError,
	mergeInputData,
	type InputDataConfig,
	type InputDataOptions,
} from './inputData';
import { createFailureOutput } from './output';
import { lookupDomainRegistration } from './rdap';

export class DomainLookup implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Domain Lookup',
		name: 'domainLookup',
		icon: {
			light: 'file:domainLookup.svg',
			dark: 'file:domainLookup.svg',
		},
		group: ['transform'],
		version: 1,
		description: 'Look up domain registration information using RDAP',
		defaults: {
			name: 'Domain Lookup',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Domain',
				name: 'domain',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'example.com',
				description: 'Domain, subdomain, or HTTP(S) URL to look up',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'fixedCollection',
				placeholder: 'Add Option',
				default: {},
				typeOptions: {
					multipleValues: false,
				},
				options: [
					{
						displayName: 'Include Input Data',
						name: 'inputData',
						values: [
							{
								displayName: 'Input Data Mode',
								name: 'inputDataMode',
								type: 'options',
								options: [
									{
										name: 'All Fields',
										value: 'allFields',
									},
									{
										name: 'Selected Fields',
										value: 'selectedFields',
									},
								],
								default: 'allFields',
								description:
									"Whether to include all fields or only selected fields from the current input item's JSON data",
							},
							{
								displayName: 'Input Field Name',
								name: 'inputFieldName',
								type: 'string',
								default: 'input',
								description: 'Name of the output field that contains the input item JSON data',
							},
							{
								displayName: 'Input Fields',
								name: 'inputFields',
								type: 'string',
								default: '',
								placeholder: 'recordId, fields.domain, fields["中文字段"].text',
								noDataExpression: true,
								requiresDataPath: 'multiple',
								typeOptions: {
									rows: 3,
								},
								displayOptions: {
									show: {
										inputDataMode: ['selectedFields'],
									},
								},
								description:
									'Fields to include from the current input item. Supports comma or newline separated paths, including fields["中文字段"].text for non-English field names.',
							},
						],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			let normalized: NormalizedDomain | undefined;
			let inputDataConfig: InputDataConfig = {
				includeInputData: false,
			};

			try {
				inputDataConfig = buildInputDataConfig(
					this.getNodeParameter('options', itemIndex, {}) as InputDataOptions,
				);
				const domainInput = this.getNodeParameter('domain', itemIndex);
				normalized = normalizeDomainInput(domainInput);

				const output = await lookupDomainRegistration(normalized, (options) =>
					this.helpers.httpRequest(options),
				);
				returnData.push({
					json: mergeInputData(
						output as unknown as Record<string, unknown>,
						items[itemIndex].json,
						inputDataConfig,
					),
					pairedItem: {
						item: itemIndex,
					},
				});
			} catch (error) {
				if (error instanceof InputDataConfigurationError) {
					throw toNodeOperationError(this, error, itemIndex);
				}

				if (this.continueOnFail() && normalized) {
					const code =
						error instanceof DomainLookupError
							? error.code
							: DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE;
					const message = error instanceof Error ? error.message : 'Domain lookup failed';

					returnData.push({
						json: mergeInputData(
							createFailureOutput(normalized, code, message) as unknown as Record<string, unknown>,
							items[itemIndex].json,
							inputDataConfig,
						),
						pairedItem: {
							item: itemIndex,
						},
					});
					continue;
				}

				throw toNodeOperationError(this, error, itemIndex);
			}
		}

		return [returnData];
	}
}

function toNodeOperationError(
	executeFunctions: IExecuteFunctions,
	error: unknown,
	itemIndex: number,
): NodeOperationError {
	const message = error instanceof Error ? error.message : 'Domain lookup failed';
	const description =
		error instanceof DomainLookupError
			? `Error code: ${error.code}`
			: error instanceof InputDataConfigurationError
				? 'Configuration error'
				: 'Unexpected lookup error';

	return new NodeOperationError(executeFunctions.getNode(), message, {
		description,
		itemIndex,
	});
}
