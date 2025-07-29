
import type { Callbacks } from '@langchain/core/callbacks/manager';
import type { Document } from '@langchain/core/documents';
import { VectorStore } from '@langchain/core/vectorstores';
import type { StructuredTool, Tool } from '@langchain/core/tools';
import type {
	IExecuteFunctions,
	ISupplyDataFunctions,
	NodeConnectionType,
	AiEvent,
	IDataObject,
} from 'n8n-workflow';
import {
	NodeOperationError,
	NodeConnectionTypes,
	parseErrorMetadata,
	jsonStringify,
} from 'n8n-workflow';
import { Embeddings } from '@langchain/core/embeddings';

const logAiEvent = (
	executeFunctions: IExecuteFunctions | ISupplyDataFunctions,
	event: AiEvent,
	data?: IDataObject,
) => {
	try {
		executeFunctions.logAiEvent(event, data ? jsonStringify(data) : undefined);
	} catch (error) {
		executeFunctions.logger.debug(`Error logging AI event: ${event}`);
	}
}


export async function callMethodAsync<T>(
	this: T,
	parameters: {
		executeFunctions: IExecuteFunctions | ISupplyDataFunctions;
		connectionType: NodeConnectionType;
		currentNodeRunIndex: number;
		method: (...args: any[]) => Promise<unknown>;
		arguments: unknown[];
	},
): Promise<unknown> {
	try {
		return await parameters.method.call(this, ...parameters.arguments);
	} catch (e) {
		const connectedNode = parameters.executeFunctions.getNode();

		const error = new NodeOperationError(connectedNode, e, {
			functionality: 'configuration-node',
		});

		const metadata = parseErrorMetadata(error);
		parameters.executeFunctions.addOutputData(
			parameters.connectionType,
			parameters.currentNodeRunIndex,
			error,
			metadata,
		);

		if (error.message) {
			if (!error.description) {
				error.description = error.message;
			}
			throw error;
		}

		throw new NodeOperationError(
			connectedNode,
			`Error on node "${connectedNode.name}" which is connected via input "${parameters.connectionType}"`,
			{ functionality: 'configuration-node' },
		);
	}
}

export function callMethodSync<T>(
	this: T,
	parameters: {
		executeFunctions: IExecuteFunctions;
		connectionType: NodeConnectionType;
		currentNodeRunIndex: number;
		method: (...args: any[]) => T;
		arguments: unknown[];
	},
): unknown {
	try {
		return parameters.method.call(this, ...parameters.arguments);
	} catch (e) {
		const connectedNode = parameters.executeFunctions.getNode();
		const error = new NodeOperationError(connectedNode, e);
		parameters.executeFunctions.addOutputData(
			parameters.connectionType,
			parameters.currentNodeRunIndex,
			error,
		);

		throw new NodeOperationError(
			connectedNode,
			`Error on node "${connectedNode.name}" which is connected via input "${parameters.connectionType}"`,
			{ functionality: 'configuration-node' },
		);
	}
}

export function isToolsInstance(model: unknown): model is Tool {
	const namespace = (model as Tool)?.lc_namespace ?? [];

	return namespace.includes('tools');
}

export function logWrapper<
	T extends VectorStore | Tool | StructuredTool | Embeddings
>(originalInstance: T, executeFunctions: IExecuteFunctions | ISupplyDataFunctions): T {
	return new Proxy(originalInstance, {
		get: (target, prop) => {
			let connectionType: NodeConnectionType | undefined;

			// ========== Tool ==========
			if (isToolsInstance(originalInstance)) {
				if (prop === '_call' && '_call' in target) {
					return async (query: string): Promise<string> => {
						connectionType = NodeConnectionTypes.AiTool;
						const inputData: IDataObject = { query };

						if (target.metadata?.isFromToolkit) {
							inputData.tool = {
								name: target.name,
								description: target.description,
							};
						}
						const { index } = executeFunctions.addInputData(connectionType, [
							[{ json: inputData }],
						]);

						const response = (await callMethodAsync.call(target, {
							executeFunctions,
							connectionType,
							currentNodeRunIndex: index,
							method: target[prop],
							arguments: [query],
						})) as string;

						logAiEvent(executeFunctions, 'ai-tool-called', { ...inputData, response });
						executeFunctions.addOutputData(connectionType, index, [[{ json: { response } }]]);

						if (typeof response === 'string') return response;
						return JSON.stringify(response);
					};
				}
			}

			// ========== VectorStore ==========
			if (originalInstance instanceof VectorStore) {
				if (prop === 'similaritySearch' && 'similaritySearch' in target) {
					return async (
						query: string,
						k?: number,
						filter?: any,
						_callbacks?: Callbacks,
					): Promise<Document[]> => {
						connectionType = NodeConnectionTypes.AiVectorStore;
						const { index } = executeFunctions.addInputData(connectionType, [
							[{ json: { query, k, filter } }],
						]);

						const response = (await callMethodAsync.call(target, {
							executeFunctions,
							connectionType,
							currentNodeRunIndex: index,
							method: target[prop],
							arguments: [query, k, filter, _callbacks],
						})) as Array<Document<Record<string, any>>>;

						logAiEvent(executeFunctions, 'ai-vector-store-searched', { query });
						executeFunctions.addOutputData(connectionType, index, [[{ json: { response } }]]);

						return response;
					};
				}
			}

			// ========== Embeddings ==========
			if (originalInstance instanceof Embeddings) {
				// Docs -> Embeddings
				if (prop === 'embedDocuments' && 'embedDocuments' in target) {
					return async (documents: string[]): Promise<number[][]> => {
						connectionType = NodeConnectionTypes.AiEmbedding;
						const { index } = executeFunctions.addInputData(connectionType, [
							[{ json: { documents } }],
						]);

						const response = (await callMethodAsync.call(target, {
							executeFunctions,
							connectionType,
							currentNodeRunIndex: index,
							method: target[prop],
							arguments: [documents],
						})) as number[][];

						logAiEvent(executeFunctions, 'ai-document-embedded');
						executeFunctions.addOutputData(connectionType, index, [[{ json: { response } }]]);
						return response;
					};
				}
				// Query -> Embeddings
				if (prop === 'embedQuery' && 'embedQuery' in target) {
					return async (query: string): Promise<number[]> => {
						connectionType = NodeConnectionTypes.AiEmbedding;
						const { index } = executeFunctions.addInputData(connectionType, [
							[{ json: { query } }],
						]);

						const response = (await callMethodAsync.call(target, {
							executeFunctions,
							connectionType,
							currentNodeRunIndex: index,
							method: target[prop],
							arguments: [query],
						})) as number[];
						logAiEvent(executeFunctions, 'ai-query-embedded');
						executeFunctions.addOutputData(connectionType, index, [[{ json: { response } }]]);
						return response;
					};
				}
			}

			return (target as any)[prop];
		},
	});
}
