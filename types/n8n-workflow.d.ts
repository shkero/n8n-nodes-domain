declare module 'n8n-workflow' {
	export enum NodeConnectionTypes {
		Main = 'main',
	}

	export interface INodeExecutionData {
		json: Record<string, unknown>;
		pairedItem?: {
			item: number;
		};
	}

	export interface INodeType {
		description: INodeTypeDescription;
		execute?: (this: IExecuteFunctions) => Promise<INodeExecutionData[][]>;
	}

	export interface INodeTypeDescription {
		displayName: string;
		name: string;
		icon?: string | { light: string; dark: string };
		group: string[];
		version: number;
		description: string;
		defaults: {
			name: string;
		};
		inputs: NodeConnectionTypes[];
		outputs: NodeConnectionTypes[];
		properties: INodeProperties[];
	}

	export interface INodeProperties {
		displayName: string;
		name: string;
		type: string;
		default: unknown;
		required?: boolean;
		placeholder?: string;
		description?: string;
	}

	export interface IExecuteFunctions {
		getNode(): unknown;
	}

	export class NodeOperationError extends Error {
		constructor(node: unknown, message: string);
	}
}
