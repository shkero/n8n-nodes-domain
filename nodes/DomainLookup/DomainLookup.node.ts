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
import { createFailureOutput, lookupDomainRegistration } from './rdap';

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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			let normalized: NormalizedDomain | undefined;

			try {
				const domainInput = this.getNodeParameter('domain', itemIndex);
				normalized = normalizeDomainInput(domainInput);

				const output = await lookupDomainRegistration(normalized, (options) =>
					this.helpers.httpRequest(options),
				);
				returnData.push({
					json: output as unknown as Record<string, unknown>,
					pairedItem: {
						item: itemIndex,
					},
				});
			} catch (error) {
				if (this.continueOnFail() && normalized) {
					const code =
						error instanceof DomainLookupError
							? error.code
							: DOMAIN_LOOKUP_ERROR_CODES.RDAP_SOURCE_UNAVAILABLE;
					const message = error instanceof Error ? error.message : 'Domain lookup failed';

					returnData.push({
						json: createFailureOutput(normalized, code, message) as unknown as Record<
							string,
							unknown
						>,
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
		error instanceof DomainLookupError ? `Error code: ${error.code}` : 'Unexpected lookup error';

	return new NodeOperationError(executeFunctions.getNode(), message, {
		description,
		itemIndex,
	});
}
