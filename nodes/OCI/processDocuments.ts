import type { Document } from '@langchain/core/documents';
import type { INodeExecutionData } from 'n8n-workflow';

import { N8nBinaryLoader } from './N8nBinaryLoader';
import { N8nJsonLoader } from './N8nJsonLoader';

export async function processDocuments(
	documentInput: N8nJsonLoader | N8nBinaryLoader,
	inputItems: INodeExecutionData[],
) {
	let processedDocuments: Document[];

	processedDocuments = await documentInput.processAll(inputItems);

	const serializedDocuments = processedDocuments.map(({ metadata, pageContent }) => ({
		json: { metadata, pageContent },
	}));

	return {
		processedDocuments,
		serializedDocuments,
	};
}
export async function processDocument(
	documentInput: N8nJsonLoader | N8nBinaryLoader,
	inputItem: INodeExecutionData,
	itemIndex: number,
) {
	let processedDocuments: Document[];

	processedDocuments = await documentInput.processItem(inputItem, itemIndex);

	const serializedDocuments = processedDocuments.map(({ metadata, pageContent }) => ({
		json: { metadata, pageContent },
		pairedItem: {
			item: itemIndex,
		},
	}));

	return {
		processedDocuments,
		serializedDocuments,
	};
}
