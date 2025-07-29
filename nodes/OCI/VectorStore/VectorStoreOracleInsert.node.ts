import type { Embeddings } from '@langchain/core/embeddings';
import {
	type INodeTypeDescription,
	type INodeType,
	type INodeExecutionData,
	NodeConnectionTypes,
	IExecuteFunctions,
} from 'n8n-workflow';
import oracledb from 'oracledb';

import { N8nJsonLoader } from '../N8nJsonLoader';
import { processDocuments } from '../processDocuments';
import { OracleDbVectorStore } from './langchain/OracleDbVectorStore';
import { N8nBinaryLoader } from '../N8nBinaryLoader';

// TODO: batch size for insert

export class VectorStoreOracleInsert implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Oracle Database Vector Store: Insert',
		name: 'vectorStoreOracleInsert',
		description: 'Oracle Database Vector Store',
		icon: { light: 'file:oracle.svg', dark: 'file:oracle.svg' },
		group: ['transform'],
		defaults: {
			name: 'Oracle Database Vector Store: Insert',
		},
		credentials: [
			{
				name: 'oracleDatabaseApi',
				required: true,
			},
		],
		// 1.2 has changes to VectorStoreInMemory node.
		// 1.3 drops `toolName` and uses node name as the tool name.
		version: [1, 1.1, 1.2, 1.3],
		codex: {
				categories: ['AI'],
				subcategories: {
					AI: ['Vector Stores', 'Tools', 'Root Nodes'],
					'Vector Stores': ['Other Vector Stores'],
					Tools: ['Other Tools'],
				},
		},
		inputs: [
			NodeConnectionTypes.Main,
			{
				displayName: 'Document',
				maxConnections: 1,
				type: NodeConnectionTypes.AiDocument,
				required: true,
			},
			{
				displayName: 'Embedding',
				maxConnections: 1,
				type: NodeConnectionTypes.AiEmbedding,
				required: true,
			},
		],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			// {
			// 	displayName: 'Embedding Batch Size',
			// 	name: 'embeddingBatchSize',
			// 	type: 'number',
			// 	default: 200,
			// 	description: 'Number of documents to embed in a single batch',
			// },
			{
				displayName: 'Table Name',
				name: 'tableName',
				type: 'string',
				default: '',
				required: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData(0);

		const documentInput = (await this.getInputConnectionData(NodeConnectionTypes.AiDocument, 0)) as
		| N8nJsonLoader
		| N8nBinaryLoader;

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
		const tableName = this.getNodeParameter('tableName', 0) as string;

		const vectorStore = new OracleDbVectorStore({
			client: dbClient,
			tableName,
			embeddings: embeddings,
		})
		await vectorStore.init()


		const { processedDocuments, serializedDocuments } = await processDocuments(
			documentInput,
			items,
		);

		await vectorStore.addDocuments(
			processedDocuments
		);

		return [serializedDocuments];
	}

}
