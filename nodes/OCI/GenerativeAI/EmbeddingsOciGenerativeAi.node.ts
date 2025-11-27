import {
	NodeConnectionTypes,
	type INodeType,
	type INodeTypeDescription,
	type SupplyData,
	type ISupplyDataFunctions,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
} from 'n8n-workflow';

import { Region, SimpleAuthenticationDetailsProvider } from 'oci-common';
import { GenerativeAiClient, models } from 'oci-generativeai';
import { OciEmbeddings } from './langchain/OciEmbedings';

import { logWrapper } from '../logWrapper';

import { privateKeyParse } from '../utils'

export class EmbeddingsOciGenerativeAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Embeddings OCI Generative AI',
		name: 'embeddingsOciGenerativeAi',
		icon: { light: 'file:oracle.svg', dark: 'file:oracle.svg' },
		credentials: [
			{
				name: 'ociApi',
				required: true,
			},
		],
		group: ['transform'],
		version: [1, 1.1, 1.2, 2],
		description: 'Use OCI Generative AI Embeddings',
		defaults: {
			name: 'Embeddings OCI Generative AI',
		},

		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Embeddings'],
			},
		},

		inputs: [],

		outputs: [NodeConnectionTypes.AiEmbedding],
		outputNames: ['Embeddings'],
		properties: [
			{
				displayName: 'Compartment ID',
				name: 'compartmentId',
				type: 'string',
				default: '',
				placeholder: 'ocid1.compartment.oc1..aaaaaaaa3x7n7wwfnghe4imvt3niwo76wgqv6ecn2iadiwoph73jjowbhbna',
			},
			{
				displayName: 'On Demand Model Name or ID',
				name: 'model',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getModels',
				},
				default: '',
				description: 'Select a On Demand Model from OCI Generative AI Services. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				required: true,
			},
		],
	};

	methods = {
		loadOptions: {
			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('ociApi');
				let privateKey = credentials.privateKey as string;
				privateKey = privateKeyParse(privateKey)
				credentials.privateKey = privateKey;
				const tenancyId = credentials.tenancyOcid as string;
				const client = new GenerativeAiClient({
					authenticationDetailsProvider: new SimpleAuthenticationDetailsProvider(
						tenancyId,
						credentials.userOcid as string,
						credentials.keyFingerprint as string,
						credentials.privateKey as string,
						credentials.passphrase as string,
						Region.fromRegionId(credentials.region as string),
					),
				})
				const compartmentId = this.getNodeParameter('compartmentId', 0) as string || tenancyId;
				const listModels = await client.listModels({ compartmentId: compartmentId });
				const options = listModels.modelCollection.items
					.filter((modelSummary) => modelSummary.capabilities.includes(models.ModelSummary.Capabilities.TextEmbeddings))
					.map((modelSummary) => {
						return {
							name: modelSummary.displayName,
							value: modelSummary.displayName,
						} as INodePropertyOptions
					})
					.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
				return [...new Set(options)]
			},
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials('ociApi');
		let privateKey = credentials.privateKey as string;
		privateKey = privateKeyParse(privateKey)
		credentials.privateKey = privateKey;

		const modelName = this.getNodeParameter('model', itemIndex) as string;
		const compartmentId = this.getNodeParameter('compartmentId', itemIndex) as string;


		const embeddings = new OciEmbeddings({
			model: modelName,
			compartmentId: compartmentId || credentials.tenancyOcid as string,
			auth: {
				authProvider: new SimpleAuthenticationDetailsProvider(
					credentials.tenancyOcid as string,
					credentials.userOcid as string,
					credentials.keyFingerprint as string,
					credentials.privateKey as string,
					credentials.passphrase as string,
					Region.fromRegionId(credentials.region as string),
				),
			},
		});

		return {
			response: logWrapper(embeddings, this),
		};
	}
}
