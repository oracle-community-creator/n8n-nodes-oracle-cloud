import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { isArray } from "lodash";
import { AuthenticationDetailsProvider } from "oci-common";
import { GenerativeAiInferenceClient, models } from "oci-generativeaiinference";


export interface OciEmbeddingsInput extends EmbeddingsParams {
	model: string;
	compartmentId: string;
	auth: {
		authProvider: AuthenticationDetailsProvider;
	};
}

export class OciEmbeddings extends Embeddings {
	model: string;
	compartmentId: string;
	auth: {
		authProvider: AuthenticationDetailsProvider;
	}
	client: GenerativeAiInferenceClient

	constructor(fields: OciEmbeddingsInput) {
		super(fields);
		this.model = fields.model;
		this.compartmentId = fields.compartmentId;
		this.auth = fields.auth;
		this.client = new GenerativeAiInferenceClient({
			authenticationDetailsProvider: fields.auth.authProvider,
		});
	}

	async embedDocuments(documents: string[]): Promise<number[][]> {
		const BATCH_SIZE = 90;
		documents = documents.filter(Boolean);
		if (documents.length <= BATCH_SIZE) {

			const embedRequest = {
				embedTextDetails: {
					inputs: documents,
					truncate: models.EmbedTextDetails.Truncate.None,
					servingMode: {
							modelId: this.model,
							servingType: "ON_DEMAND",
					},
					compartmentId: this.compartmentId,
					inputType: models.EmbedTextDetails.InputType.SearchDocument,
				},
			}

			const embedResponse = await this.client.embedText(embedRequest);
			if (!isArray(embedResponse?.embedTextResult?.embeddings)){
				throw new Error("Error in single batch embedding: worng respose format");
			}

			return embedResponse.embedTextResult.embeddings;
		}

		const batches: string[][] = [];
		for (let i = 0; i < documents.length; i += BATCH_SIZE) {
			batches.push(documents.slice(i, i + BATCH_SIZE));
		}

		let batchResults: number[][] = [];
		for (const batch of batches) {
			const embedRequest = {
				embedTextDetails: {
					inputs: batch,
					truncate: models.EmbedTextDetails.Truncate.None,
					servingMode: {
						modelId: this.model,
						servingType: "ON_DEMAND",
					},
					compartmentId: this.compartmentId,
					inputType: models.EmbedTextDetails.InputType.SearchDocument,
				},
			};

			const embedResponse = await this.client.embedText(embedRequest);
			if (!isArray(embedResponse?.embedTextResult?.embeddings)){
				throw new Error("Error in single batch embedding: worng respose format");
			}

			batchResults = batchResults.concat(embedResponse.embedTextResult.embeddings);
		}

		return batchResults;
	}

	async embedQuery(document: string): Promise<number[]> {
		const embedRequest = {
			embedTextDetails: {
				inputs: [document],
				truncate: models.EmbedTextDetails.Truncate.None,
				servingMode: {
						modelId: this.model,
						servingType: "ON_DEMAND",
				},
				compartmentId: this.compartmentId,
				inputType: models.EmbedTextDetails.InputType.SearchQuery,
			},
		}

  	const embedResponse = await this.client.embedText(embedRequest)
		return embedResponse.embedTextResult.embeddings[0]
	}


}
