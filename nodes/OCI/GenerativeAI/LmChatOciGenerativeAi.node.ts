import {
	type INodeType,
	type INodeTypeDescription,
	type INodePropertyOptions,
	type ISupplyDataFunctions,
	type ILoadOptionsFunctions,
	type SupplyData,
	NodeConnectionTypes,
	NodeOperationError
} from 'n8n-workflow';
import { ChatOciGenerativeAi } from './langchain/ChatOci';
import { Region, SimpleAuthenticationDetailsProvider } from 'oci-common';
import { makeN8nLlmFailedAttemptHandler } from '../n8nLlmFailedAttemptHandler';
import { N8nLlmTracing } from '../N8nLlmTracing';
import { GenerativeAiClient, models } from 'oci-generativeai';

// TODO: implement other class as in @n8n (Chat Model and the model itself?)
// TODO: list models without repeat
// TODO: more params? triiger to set vendor, ondemand vs dedicated
// TODO: filter duplicate models

const _privateKeyParse = (privateKey: string) => {
	return '----BEGIN PRIVATE KEY-----' +
			privateKey
				.substr(27, privateKey.indexOf('-----END PRIVATE KEY-----') - 27)
				.replaceAll(' ', '\r\n') +
			'-----END PRIVATE KEY-----';
}

export class LmChatOciGenerativeAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OCI Generative AI Chat Model',
		name: 'lmChatOciGenerativeAi',
		group: ['transform'],
		icon: { light: 'file:oracle.svg', dark: 'file:oracle.svg' },
		version: 1,
		description: 'Call OCI Generative AI Services for Oracle Cloud',
		defaults: {
			name: 'OCI Generative AI Chat Model',
		},
		credentials: [
			{
				name: 'ociApi',
				required: true,
			},
		],
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Chat Models (Recommended)'],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		properties: [
			{
				displayName: 'Compartment ID',
				name: 'compartmentId',
				type: 'string',
				default: '',
				placeholder: 'ocid1.compartment.oc1..aaaaaaaa3x7n7wwfnghe4imvt3niwo76wgqv6ecn2iadiwoph73jjowbhbna',
				required: true,
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
				privateKey = _privateKeyParse(privateKey)
				credentials.privateKey = privateKey;
				const client = new GenerativeAiClient({
					authenticationDetailsProvider: new SimpleAuthenticationDetailsProvider(
						credentials.tenancyOcid as string,
						credentials.userOcid as string,
						credentials.keyFingerprint as string,
						credentials.privateKey as string,
						credentials.passphrase as string,
						Region.fromRegionId(credentials.region as string),
					),
				})
				const compartmentId = credentials.tenancyOcid as string;
				const listModels = await client.listModels({ compartmentId });
				const options = listModels.modelCollection.items
					.filter((modelSummary) => modelSummary.capabilities.includes(models.ModelSummary.Capabilities.Chat))
					.map((modelSummary) => {
						return {
							name: modelSummary.displayName,
							value: modelSummary.displayName,
						} as { name: string, value: string}
					})
					.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
					return [...new Set(options)] as INodePropertyOptions[]
			},
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		try {
			const credentials = await this.getCredentials('ociApi');
			let privateKey = credentials.privateKey as string;
			privateKey = _privateKeyParse(privateKey)
			credentials.privateKey = privateKey;

			const modelName = this.getNodeParameter('model', itemIndex) as string;
			const compartmentId = this.getNodeParameter('compartmentId', itemIndex) as string;

			// TODO: options like OpenAI
			const options = {
				temperature: 0.2,
				max_tokens: 1024,
				top_p: 0.75,
				top_k: 0,
				frequency_penalty: 0,
				presence_penalty: 0,
			};

			const modelDefaults = {
				temperature: 0.2,
				max_tokens: 1024,
				top_p: 0.75,
				top_k: 0,
				frequency_penalty: 0,
				presence_penalty: 0,
			};

			const model = new ChatOciGenerativeAi({
				model: modelName,
				compartmentId: compartmentId,
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
				temperature: options.temperature || modelDefaults.temperature,
				frequencyPenalty: options.frequency_penalty || modelDefaults.frequency_penalty,
				presencePenalty: options.presence_penalty || modelDefaults.presence_penalty,
				topP: options.top_p || modelDefaults.top_p,
				topK: options.top_k || modelDefaults.top_k,
				maxTokens: options.max_tokens || modelDefaults.max_tokens,
				callbacks: [new N8nLlmTracing(this)],
				onFailedAttempt: makeN8nLlmFailedAttemptHandler(this),
			});

			return {
				response: model,
			};
		} catch (error) {
			this.logger.error(`Error in LmChatOciCohere.supplyData: ${error.message}`, error);

			if (error instanceof NodeOperationError) {
				throw error;
			}

			throw new NodeOperationError(
				this.getNode(),
				error,
				{ message: error.message },
			);
		}

	}
}
