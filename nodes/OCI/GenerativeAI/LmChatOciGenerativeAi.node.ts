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
import { privateKeyParse } from '../utils'

// TODO: implement other class as in @n8n (Chat Model and the model itself?)
// TODO: list models without repeat
// TODO: more params?
// TODO: triger to set vendor, ondemand vs dedicated



export class LmChatOciGenerativeAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OCI Generative AI Chat Model',
		name: 'lmChatOciGenerativeAi',
		group: ['transform'],
		icon: { light: 'file:oracle.svg', dark: 'file:oracle.svg' },
		version: [1, 1.1, 1.2, 1.3, 2],
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
			{
				displayName: 'Options',
				name: 'options',
				placeholder: 'Add Option',
				description: 'Additional options to add',
				type: 'collection',
				default: {},
				// eslint-disable-next-line n8n-nodes-base/node-param-collection-type-unsorted-items
				options: [
					{
						displayName: 'Temperature',
						name: 'temperature',
						default: 0.2,
						typeOptions: { maxValue: 1, minValue: 0, numberPrecision: 1 },
						description:
							'Controls the randomness of the generated text. Lower values make the output more focused and deterministic, while higher values make it more diverse and random.',
						type: 'number',
					},
							{
						displayName: 'Top P',
						name: 'topP',
						default: 1,
						typeOptions: { maxValue: 1, minValue: 0, numberPrecision: 1 },
						description:
							'Chooses from the smallest possible set of tokens whose cumulative probability exceeds the probability top_p. Helps generate more human-like text by reducing repetitions.',
						type: 'number',
					},
					{
						displayName: 'Top K',
						name: 'topK',
						default: -1,
						typeOptions: { maxValue: 500, minValue: -1, numberPrecision: 1 },
						description:
							'Limits the number of highest probability vocabulary tokens to consider at each step. A higher value increases diversity but may reduce coherence. Set to -1 to disable.',
						type: 'number',
					},
					{
						displayName: 'Frequency Penalty',
						name: 'frequencyPenalty',
						type: 'number',
						default: 0.0,
						typeOptions: { maxValue: 1, minValue: 0 },
						description:
							'Adjusts the penalty for tokens that have already appeared in the generated text. Higher values discourage repetition.',
					},
					{
						displayName: 'Presence Penalty',
						name: 'presencePenalty',
						type: 'number',
						default: 0.0,
						description:
							'Adjusts the penalty for tokens based on their presence in the generated text so far. Positive values penalize tokens that have already appeared, encouraging diversity.',
					},
					// {
					// 	displayName: 'Max Tokens to Generate',
					// 	name: 'maxTokens',
					// 	type: 'number',
					// 	default: -1,
					// 	description:
					// 		'The maximum number of tokens to generate. Set to -1 for no limit. Be cautious when setting this to a large value, as it can lead to very long outputs.',
					// },
				]
			}

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
				const compartmentId = credentials.tenancyOcid as string;
				const listModels = await client.listModels({ compartmentId: compartmentId || tenancyId });
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
			privateKey = privateKeyParse(privateKey)
			credentials.privateKey = privateKey;

			const modelName = this.getNodeParameter('model', itemIndex) as string;
			const compartmentId = this.getNodeParameter('compartmentId', itemIndex) as string;

			const options = this.getNodeParameter('options', itemIndex, {}) as object;

			const model = new ChatOciGenerativeAi({
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
				...options,
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
