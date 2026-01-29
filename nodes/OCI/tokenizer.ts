/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import { Tiktoken, getEncodingNameForModel } from 'js-tiktoken/lite';
import type { TiktokenBPE, TiktokenEncoding, TiktokenModel } from 'js-tiktoken/lite';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { jsonParse  } from 'n8n-workflow';

import { hasLongSequentialRepeat } from './helpers';


const cache: Record<string, Promise<Tiktoken>> = {};

const MODEL_CHAR_PER_TOKEN_RATIOS: Record<string, number> = {
	'gpt-4o': 3.8,
	'gpt-4': 4.0,
	'gpt-3.5-turbo': 4.0,
	cl100k_base: 4.0,
	o200k_base: 3.5,
	p50k_base: 4.2,
	r50k_base: 4.2,
};

const loadJSONFile = async (filename: string): Promise<TiktokenBPE> => {
	// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
	const filePath = join(__dirname, filename);
	const content = await readFile(filePath, 'utf-8');
	return await jsonParse(content);
};


async function getEncoding(encoding: TiktokenEncoding): Promise<Tiktoken> {
	if (!(encoding in cache)) {
		// Create and cache the promise for loading this encoding
		cache[encoding] = (async () => {
			let jsonData: TiktokenBPE;

			switch (encoding) {
				case 'o200k_base':
					jsonData = await loadJSONFile('./o200k_base.json');
					break;
				case 'cl100k_base':
					jsonData = await loadJSONFile('./cl100k_base.json');
					break;
				default:
					// Fall back to cl100k_base for unsupported encodings
					jsonData = await loadJSONFile('./cl100k_base.json');
			}

			return new Tiktoken(jsonData);
		})().catch((error) => {
			delete cache[encoding];
			throw error;
		});
	}

	return await cache[encoding];
}

async function encodingForModel(model: TiktokenModel): Promise<Tiktoken> {
	return await getEncoding(getEncodingNameForModel(model));
}

function estimateTokensByCharCount(text: string, model: string = 'cl100k_base'): number {
	try {
		// Validate input
		if (!text || typeof text !== 'string' || text.length === 0) {
			return 0;
		}

		// Get the ratio for the specific model, or use default
		const charsPerToken = MODEL_CHAR_PER_TOKEN_RATIOS[model] || 4.0;

		// Validate ratio
		if (!Number.isFinite(charsPerToken) || charsPerToken <= 0) {
			// Fallback to default ratio
			const estimatedTokens = Math.ceil(text.length / 4.0);
			return estimatedTokens;
		}

		// Calculate estimated tokens
		const estimatedTokens = Math.ceil(text.length / charsPerToken);

		return estimatedTokens;
	} catch (error) {
		// Return conservative estimate on error
		return Math.ceil((text?.length || 0) / 4.0);
	}
}


export async function estimateTokensFromStringList(
	list: string[],
	model: TiktokenModel,
): Promise<number> {
	try {
		// Validate input
		if (!Array.isArray(list)) {
			return 0;
		}

		const encoder = await encodingForModel(model);
		const encodedListLength = await Promise.all(
			list.map(async (text) => {
				try {
					// Handle null/undefined text
					if (!text || typeof text !== 'string') {
						return 0;
					}

					// Check for repetitive content
					if (hasLongSequentialRepeat(text)) {
						const estimatedTokens = estimateTokensByCharCount(text, model);
						return estimatedTokens;
					}

					// Use tiktoken for normal text
					try {
						const tokens = encoder.encode(text);
						return tokens.length;
					} catch (encodingError) {
						// Fall back to estimation if tiktoken fails
						return estimateTokensByCharCount(text, model);
					}
				} catch (itemError) {
					// Return 0 for individual item errors
					return 0;
				}
			}),
		);

		const totalTokens = encodedListLength.reduce((acc, curr) => acc + curr, 0);

		return totalTokens;
	} catch (error) {
		// Return 0 on complete failure
		return 0;
	}
}