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
		requiresDataPath?: 'single' | 'multiple';
		displayOptions?: {
			show?: Record<string, unknown[]>;
			hide?: Record<string, unknown[]>;
		};
		options?: unknown[];
		typeOptions?: Record<string, unknown>;
	}

	export interface IExecuteFunctions {
		helpers: {
			httpRequest(options: IHttpRequestOptions): Promise<unknown>;
		};
		continueOnFail(): boolean;
		getInputData(): INodeExecutionData[];
		getNode(): unknown;
		getNodeParameter(name: string, itemIndex: number, fallbackValue?: unknown): unknown;
	}

	export interface IHttpRequestOptions {
		method?: string;
		url: string;
		headers?: Record<string, string>;
		timeout?: number;
		json?: boolean;
		returnFullResponse?: boolean;
		ignoreHttpStatusErrors?: boolean;
	}

	export class NodeOperationError extends Error {
		constructor(
			node: unknown,
			message: string,
			options?: {
				description?: string;
				itemIndex?: number;
			},
		);
	}
}
