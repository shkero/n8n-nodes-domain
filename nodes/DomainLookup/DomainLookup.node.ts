import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

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
		throw new NodeOperationError(this.getNode(), 'Domain lookup is not implemented yet');
	}
}
