 
import type { Embeddings } from '@langchain/core/embeddings';
import {
	type INodeTypeDescription,
	type SupplyData,
	type ISupplyDataFunctions,
	type INodeType,
	IExecuteFunctions,
	NodeConnectionTypes,
	INodePropertyOptions,
	INodeExecutionData,
	assertParamIsBoolean,
	assertParamIsNumber,
} from 'n8n-workflow';
import oracledb from 'oracledb';
import { DynamicTool } from 'langchain/tools';
import type { VectorStore } from '@langchain/core/vectorstores';
import type { BaseDocumentCompressor } from '@langchain/core/retrievers/document_compressors';

import { logWrapper, logAiEvent } from '../logWrapper';
import { OracleDbVectorStore, DistanceStrategy } from './langchain/OracleDbVectorStore';

function getMetadataFiltersValues(
	ctx: IExecuteFunctions | ISupplyDataFunctions,
	itemIndex: number,
): Record<string, never> | undefined {
	const options = ctx.getNodeParameter('options', itemIndex, {});

	if (options.metadata) {
		const { metadataValues: metadata } = options.metadata as {
			metadataValues: Array<{
				name: string;
				value: string;
			}>;
		};
		if (metadata.length > 0) {
			return metadata.reduce((acc, { name, value }) => ({ ...acc, [name]: value }), {});
		}
	}

	if (options.searchFilterJson) {
		return ctx.getNodeParameter('options.searchFilterJson', itemIndex, '', {
			ensureType: 'object',
		}) as Record<string, never>;
	}

	return undefined;
}

async function handleRetrieveAsToolExecuteOperation<T extends VectorStore = VectorStore>(
	context: IExecuteFunctions,
	// args: VectorStoreNodeConstructorArgs<T>,
	vectorStore: VectorStore,
	embeddings: Embeddings,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const filter = getMetadataFiltersValues(context, itemIndex);

	// Get the search parameters - query from input data, others from node parameters
	const inputData = context.getInputData();
	const item = inputData[itemIndex];
	const query = typeof item.json.input === 'string' ? item.json.input : undefined;

	if (!query || typeof query !== 'string') {
		throw new Error('Input data must contain a "input" field with the search query');
	}

	const topK = context.getNodeParameter('topK', itemIndex, 4);
	assertParamIsNumber('topK', topK, context.getNode());
	const useReranker = context.getNodeParameter('useReranker', itemIndex, false);
	assertParamIsBoolean('useReranker', useReranker, context.getNode());

	const includeDocumentMetadata = context.getNodeParameter(
		'includeDocumentMetadata',
		itemIndex,
		true,
	);
	assertParamIsBoolean('includeDocumentMetadata', includeDocumentMetadata, context.getNode());

	// Embed the query to prepare for vector similarity search
	const embeddedQuery = await embeddings.embedQuery(query);

	// Get the most similar documents to the embedded query
	let docs = await vectorStore.similaritySearchVectorWithScore(embeddedQuery, topK, filter);

	// If reranker is used, rerank the documents
	if (useReranker && docs.length > 0) {
		const reranker = (await context.getInputConnectionData(
			NodeConnectionTypes.AiReranker,
			0,
		)) as BaseDocumentCompressor;
		const documents = docs.map(([doc]) => doc);

		const rerankedDocuments = await reranker.compressDocuments(documents, query);
		docs = rerankedDocuments.map((doc) => {
			const { relevanceScore, ...metadata } = doc.metadata || {};
			return [{ ...doc, metadata }, relevanceScore ?? 0];
		});
	}

	// Format the documents for the output similar to the original tool format
	const serializedDocs = docs.map(([doc]) => {
		if (includeDocumentMetadata) {
			return {
				type: 'text',
				text: JSON.stringify({ ...doc }),
			};
		} else {
			return {
				type: 'text',
				pageContent: JSON.stringify({ pageContent: doc.pageContent }),
			};
		}
	});

	// Log the AI event for analytics
	logAiEvent(context, 'ai-vector-store-searched', { input: query });

	return [
		{
			json: {
				response: serializedDocs,
			},
			pairedItem: {
				item: itemIndex,
			},
		},
	];
	
}


export class VectorStoreOracleTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Oracle Database Vector Store: Tool',
		name: 'vectorStoreOracleTool',
		description: 'Oracle Database Vector Tool Search',
		icon: { light: 'file:oracle.svg', dark: 'file:oracle.svg' },
		group: ['transform'],
		defaults: {
			name: 'Oracle Database Vector Store: Tool',
		},
		credentials: [
			{
				name: 'oracleDatabaseApi',
				required: true,
			},
		],
		// 1.2 has changes to VectorStoreInMemory node.
		// 1.3 drops `toolName` and uses node name as the tool name.
		version: [1, 1.1, 1.2, 1.3, 2],
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Vector Stores', 'Tools', 'Root Nodes'],
				'Vector Stores': ['Other Vector Stores'],
				Tools: ['Other Tools'],
			},
		},
		inputs: [
			{
				displayName: "Embedding",
				type: NodeConnectionTypes.AiEmbedding,
				required: true,
				maxConnections: 1
			},
			// { displayName: "Reranker",
			// 	type: NodeConnectionTypes.AiReranker,
			// 	required: false,
			// 	maxConnections: 1
			// }
		],
		outputs: [
			{
				displayName: "Tool",
				type: NodeConnectionTypes.AiTool
			},
		],
		properties: [
			{
				displayName: 'Name',
				name: 'toolName',
				type: 'string',
				default: '',
				required: true,
				description: 'Name of the vector store',
				placeholder: 'e.g. company_knowledge_base',
				validateType: 'string-alphanumeric',
			},
			{
				displayName: 'Description',
				name: 'toolDescription',
				type: 'string',
				default: '',
				required: true,
				typeOptions: { rows: 2 },
				description:
					'Explain to the LLM what this tool does, a good, specific description would allow LLMs to produce expected results much more often',
			},
			{
				displayName: 'Table Name',
				name: 'tableName',
				type: 'string',
				default: '',
				required: true,
			},
			{
				displayName: 'Limit',
				name: 'topK',
				type: 'number',
				default: 4,
				description: 'Number of top results to fetch from vector store',
			},
			{
				displayName: 'Include Metadata',
				name: 'includeDocumentMetadata',
				type: 'boolean',
				default: true,
				description: 'Whether or not to include document metadata',
			},
			{
				displayName: 'Distance Strategy',
				name: 'distanceStrategy',
				type: 'options',
				options: Object.values(DistanceStrategy).map((strategy) => (
					{
						name: strategy,
						value: strategy
					} as INodePropertyOptions
				)),
				default: '',
				description: 'How similarity between vectors is measured',
			}
		],
		// usableAsTool: true,
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const toolDescription = this.getNodeParameter('toolDescription', itemIndex) as string;
		const toolName = this.getNodeParameter('toolName', itemIndex) as string;
		const topK = this.getNodeParameter('topK', itemIndex, 4) as number;
		const includeDocumentMetadata = this.getNodeParameter(
			'includeDocumentMetadata',
			itemIndex,
			true,
		) as boolean;
		const credentials = await this.getCredentials('oracleDatabaseApi');
		const protocol = (credentials.isAutonomous as boolean) ? 'tcps://' : 'tcp://';
		const host = credentials.host as string
		const port = credentials.port as number
		const serviceName = credentials.serviceName as string
		const connectString = `${protocol}${host}:${port}/${serviceName}`;
		const dbClient = await oracledb.getConnection({
			user: credentials.user as string,
			password: credentials.password as string,
			connectString,
		})
		const tableName = this.getNodeParameter('tableName', itemIndex) as string;
		const distanceStrategy = this.getNodeParameter('distanceStrategy', itemIndex) as DistanceStrategy;
		const embeddings = (await this.getInputConnectionData(
			NodeConnectionTypes.AiEmbedding,
			0,
		)) as Embeddings;

		// Create a Dynamic Tool that wraps vector store search functionality
		const vectorStoreTool = new DynamicTool({
			name: toolName,
			description: toolDescription,
			func: async (input) => {
				const vectorStore = new OracleDbVectorStore({
					client: dbClient,
					tableName,
					embeddings: embeddings,
					distanceStrategy
				})
				await vectorStore.init()

				// Embed the input query
				const embeddedPrompt = await embeddings.embedQuery(input);

				// Search for similar documents
				const documents = await vectorStore.similaritySearchVectorWithScore(
					embeddedPrompt,
					topK,
					{},
				);

				// Format the documents for the tool output
				return documents
					.map((document) => {
						if (includeDocumentMetadata) {
							return { type: 'text', text: JSON.stringify(document[0]) };
						}
						return {
							type: 'text',
							text: JSON.stringify({ pageContent: document[0].pageContent }),
						};
					})
					.filter((document) => !!document);
			},
		});

		return {
			response: logWrapper(vectorStoreTool, this)
		}
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const embeddings = (await this.getInputConnectionData(
			NodeConnectionTypes.AiEmbedding,
			0,
		)) as Embeddings;
		const credentials = await this.getCredentials('oracleDatabaseApi');
		const protocol = (credentials.isAutonomous as boolean) ? 'tcps://' : 'tcp://';
		const host = credentials.host as string
		const port = credentials.port as number
		const serviceName = credentials.serviceName as string
		const connectString = `${protocol}${host}:${port}/${serviceName}`;
		const dbClient = await oracledb.getConnection({
			user: credentials.user as string,
			password: credentials.password as string,
			connectString,
		})
		
		
		const items = this.getInputData(0);
			const resultData = [];

			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				const tableName = this.getNodeParameter('tableName', itemIndex) as string;
				const distanceStrategy = this.getNodeParameter('distanceStrategy', itemIndex) as DistanceStrategy;
				const vectorStore = new OracleDbVectorStore({
					client: dbClient,
					tableName,
					embeddings: embeddings,
					distanceStrategy
				})
				const docs = await handleRetrieveAsToolExecuteOperation(
					this,
					vectorStore, // args,
					embeddings,
					itemIndex,
				);
				resultData.push(...docs);
			}

			return [resultData];
	}
}


