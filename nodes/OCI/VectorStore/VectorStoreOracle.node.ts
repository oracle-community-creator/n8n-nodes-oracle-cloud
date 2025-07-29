import type { Embeddings } from '@langchain/core/embeddings';
import {
	type INodeTypeDescription,
	type SupplyData,
	type ISupplyDataFunctions,
	type INodeType,
	NodeConnectionTypes,
	IExecuteFunctions,
	INodePropertyOptions
} from 'n8n-workflow';
import oracledb from 'oracledb';

import { logWrapper } from '../logWrapper';
import { DistanceStrategy, OracleDbVectorStore } from './langchain/OracleDbVectorStore';

// TODO: implement vector load node
// TODO: move repeated code to utils
// TODO: implement custom metadata as filters
// TODO: list available tables (by table def)
// TODO: prefix table names
// TODO: filters properties to advanced filtering

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

	return undefined;
}

export class VectorStoreOracle implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Oracle Database Vector Store',
		name: 'vectorStoreOracle',
		description: 'Oracle Database Vector Search',
		icon: { light: 'file:oracle.svg', dark: 'file:oracle.svg' },
		group: ['transform'],
		defaults: {
			name: 'Oracle Database Vector Store',
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
				displayName: "Vector Store",
				type: NodeConnectionTypes.AiVectorStore
			},
		],
		properties: [
			{
				displayName: 'Table Name',
				name: 'tableName',
				type: 'string',
				default: '',
				required: true,
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
			// {
			// 	displayName: 'Metadata Filter',
			// 	name: 'metadata',
			// 	type: 'fixedCollection',
			// 	description: 'Metadata to filter the document by',
			// 	typeOptions: {
			// 		multipleValues: true,
			// 	},
			// 	default: {},
			// 	placeholder: 'Add filter field',
			// 	options: [
			// 		{
			// 			name: 'metadataValues',
			// 			displayName: 'Fields to Set',
			// 			values: [
			// 				{
			// 					displayName: 'Name',
			// 					name: 'name',
			// 					type: 'string',
			// 					default: '',
			// 					required: true,
			// 				},
			// 				{
			// 					displayName: 'Value',
			// 					name: 'value',
			// 					type: 'string',
			// 					default: '',
			// 				},
			// 			],
			// 		},
			// 	],
			// }
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		// Get the embeddings model connected to this node
		const embeddings = (await this.getInputConnectionData(
			NodeConnectionTypes.AiEmbedding,
			0,
		)) as Embeddings;
		const filter = getMetadataFiltersValues(this, itemIndex);
		// const useReranker = context.getNodeParameter('useReranker', itemIndex, false) as boolean;
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

		const vectorStore = new OracleDbVectorStore({
			client: dbClient,
			tableName,
			embeddings: embeddings,
			distanceStrategy,
			filter
		})
		await vectorStore.init()

		return {
			response: logWrapper(vectorStore, this)
		}
	}

}
