import { DocumentInterface } from '@langchain/core/dist/documents/document';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import { VectorStore } from '@langchain/core/vectorstores';
import { Embeddings } from '@langchain/core/embeddings';
import oracledb from 'oracledb';
import { createHash, randomUUID } from 'crypto';


export enum DistanceStrategy {
	EUCLIDEAN_DISTANCE = "EUCLIDEAN_DISTANCE",
	DOT_PRODUCT = "DOT_PRODUCT",
	COSINE = "COSINE"
}
// Use runtime classes from oracledb for instanceof checks
const _get_connection = async (client: any): Promise<oracledb.Connection> => {
	// Duck typing: check for 'execute' (Connection) and 'getConnection' (Pool)
	if (client && typeof client.execute === 'function') {
		// Likely a Connection object
		return client;
	} else if (client && typeof client.getConnection === 'function') {
		// Likely a Pool object
		return await client.getConnection();
	} else {
		throw new Error("Invalid client type");
	}
}

const _table_exists = async (connection: oracledb.Connection, tableName: string): Promise<boolean> => {
	try {
		await connection.execute(`SELECT COUNT(*) FROM "${tableName}"`);
		return true;
	} catch (error: any) {
		// ORA-00942: table or view does not exist
		if (error && error.errorNum === 942) {
			return false;
		}
		console.error("Error checking if table exists:", error);
		throw error;
	}
}

const _create_table = async (connection: oracledb.Connection | null, tableName: string, embeddingDim: number) => {
	if (!connection) {
		throw new Error('Invalid connection')
	}

	await connection.execute(`
		CREATE TABLE "${tableName}" (
			id RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
			text CLOB,
			metadata JSON,
			embedding VECTOR(${embeddingDim}, FLOAT32)
		)
	`)
}

const _get_distance_function = (distanceStrategy: DistanceStrategy): string => {
	const distanceStrategy2Function = {
		[DistanceStrategy.EUCLIDEAN_DISTANCE]: "EUCLIDEAN",
		[DistanceStrategy.DOT_PRODUCT]: "DOT",
		[DistanceStrategy.COSINE]: "COSINE",
	}

	// # Attempt to return the corresponding distance function
	if (distanceStrategy in distanceStrategy2Function) {
		return distanceStrategy2Function[distanceStrategy]
	}

	throw new Error(`Unsupported distance strategy: ${distanceStrategy}`)
}

function _mergeArraysToObject<T, U, V, W>(
	ids: T[],
	texts: U[],
	metadatas: V[],
	embeddings: W[]
): Array<{ id: T; text: U; metadata: V, embedding: W }> {
	return ids.map((key, index) => ({
		id: key,
		text: texts[index],
		metadata: metadatas[index],
		embedding: embeddings[index]
	}));
}

export interface VectorStoreOracleInput {
	client: any;
	tableName: string;
	// embeddings: Embeddings | ((arg: string) => number[]);
	embeddings: Embeddings
	query?: string
	distanceStrategy?: DistanceStrategy;
	filter?: Record<string, any> | undefined
}

export class OracleDbVectorStore extends VectorStore {
	FilterType: Record<string, any> = {}
	client: any;
	tableName!: string;
	embeddings: Embeddings;
	query: any
	distanceStrategy: DistanceStrategy;
	filter?: Record<string, any> | undefined
	connection: oracledb.Connection | null = null;

	constructor(fields: VectorStoreOracleInput) {
		super(fields.embeddings, {});

		this.client = fields.client;
		this.embeddings = fields.embeddings;
		this.query = fields.query;
		this.tableName = fields.tableName;
		this.distanceStrategy = fields.distanceStrategy || DistanceStrategy.EUCLIDEAN_DISTANCE;
		this.filter = fields.filter;
		this.connection = null;
		// Async initialization must be called after construction
	}

	async init() {
		try {
			this.connection = await _get_connection(this.client);
			if (!this.connection) {
				throw new Error('Invalid connection')
			}
			const tableExists = await _table_exists(this.connection, this.tableName);
			if (!tableExists) {
				const embeddingDim = await this.get_embedding_dimension();
				await _create_table(this.connection, this.tableName, embeddingDim);
			}
		} catch (error) {
			console.log(error);
		}
	}

	async get_embedding_dimension(): Promise<number> {
		// Embed the single document by wrapping it in a list
		const embeddedQuery = await this._embed_query(
			this.query ? this.query : "test"
		);

		// Get the first (and only) embedding's dimension
		return embeddedQuery.length;
	}


	async _embed_documents(texts: string[]): Promise<number[][]> {
		// Duck typing: check for 'embedDocuments' (Embeddings)
		if (this.embeddings && typeof this.embeddings.embedDocuments === 'function') {
			return await this.embeddings.embedDocuments(texts);
		} else {
			throw new TypeError("The embeddingFunction is neither an Embeddings instance nor a callable function.");
		}
	}

	async _embed_query(query: string): Promise<number[]> {
		// Duck typing: check for 'embedQuery' (Embeddings)
		if (this.embeddings && typeof this.embeddings.embedQuery === 'function') {
			return await this.embeddings.embedQuery(query);
		} else {
			throw new TypeError("The embeddingFunction is neither an Embeddings instance nor a callable function.");
		}
	}


	_vectorstoreType(): string {
		return 'oracle_db';
	}

	async addTexts(texts: string[], metadatas?: Record<string, any>[], ids?: (string[] | null), options?: { [x: string]: any; }): Promise<string[] | void> {
		let processed_ids: string[] = []
		if (ids && ids.length > 0) {
			processed_ids = ids.map(_id =>
				createHash('sha256').update(_id).digest('hex').substring(0, 16).toUpperCase()
			);
		} else if (metadatas && metadatas.every(metadata => "id" in metadata)) {
			processed_ids = metadatas.map(metadata =>
				createHash('sha256').update(metadata.id).digest('hex').substring(0, 16).toUpperCase()
			);
		} else {
			const generated_ids = texts.map(() => randomUUID());
			processed_ids = generated_ids.map(_id =>
				createHash('sha256').update(_id).digest('hex').substring(0, 16).toUpperCase()
			);
		}

		if (!metadatas) {
			metadatas = texts.map(() => ({}));
		}

		const embeddings = await this.embeddings.embedDocuments(texts);
		const records = _mergeArraysToObject(processed_ids, texts, metadatas, embeddings)

		const connection = await _get_connection(this.client);

		const sql = `
				INSERT INTO
						"${this.tableName}" (id, text, metadata, embedding)
				VALUES
						(:id, :text, :metadata, :embedding)
		`;

		const binds = records.map((record) => ({
			id: Buffer.from(record.id, 'hex'), // Convert hex string to Buffer
			text: record.text,
			metadata: JSON.stringify(record.metadata), // Ensure it's a JSON string
			embedding: new Float32Array(record.embedding)
		})) as oracledb.BindParameters[];

		const batchOptions = {
			autoCommit: true,
			batchErrors: true,
			bindDefs: {
				id: { type: oracledb.DB_TYPE_RAW, maxSize: 16 },
				text: { type: oracledb.CLOB },
				metadata: { type: oracledb.DB_TYPE_JSON },
				embedding: { type: oracledb.DB_TYPE_VECTOR }
			}
		};

		// Execute the batch insert
		const results = await connection.executeMany(sql, binds, batchOptions);
		console.log(results, results.batchErrors);

	}

	addVectors(vectors: number[][], documents: DocumentInterface[], options?: { [x: string]: any; }): Promise<string[] | void> {
		throw new Error('Method not implemented.');
	}



	async addDocuments(documents: DocumentInterface[], options?: { [x: string]: any; }): Promise<string[] | void> {
		if (options?.clearTable) {
			const connection = await _get_connection(this.client);
			if (!connection) {
				throw new Error('Invalid connection')
			}

			await connection.execute(`TRUNCATE TABLE "${this.tableName}"`);
		}
		const texts = documents.map((document) => document.pageContent);
		const metadatas = documents.map((document) => document.metadata);
		return this.addTexts(texts, metadatas, null, options);
	}

	async similaritySearch(query: string, k?: number, filter?: this["FilterType"] | undefined, _callbacks?: Callbacks | undefined): Promise<DocumentInterface[]> {
		oracledb.fetchAsString = [oracledb.CLOB];
		if (!query) {
			return [];
		}
		const queryEmbedding = new Float32Array(await this.embeddings.embedQuery(query));
		const sqlQuery = `
			SELECT
				id,
				text,
				metadata,
				vector_distance(embedding, :embedding, ${_get_distance_function(this.distanceStrategy)}) as distance
			FROM
				"${this.tableName}"
			ORDER BY
				distance
			FETCH APPROX FIRST ${k} ROWS ONLY
	  `;
		const connection = await _get_connection(this.client);
		const result = await connection.execute(
			sqlQuery,
			{ embedding: { type: oracledb.DB_TYPE_VECTOR, val: queryEmbedding } }, // bind the embedding vector
			{ outFormat: oracledb.OUT_FORMAT_OBJECT }
		);

		// Map results to [DocumentInterface, number][]
		const rows = (result.rows || []) as any[];
		return rows.map(row => {
			const doc: DocumentInterface = {
				pageContent: row.TEXT,
				metadata: row.METADATA ? JSON.parse(row.METADATA) : {},
			};
			return doc;
		});
	}

	async similaritySearchVectorWithScore(query: number[], k: number, filter?: this['FilterType'] | undefined): Promise<[DocumentInterface, number][]> {
		oracledb.fetchAsString = [oracledb.CLOB];
		const sqlQuery = `
			SELECT
				id,
				text,
				metadata,
				vector_distance(embedding, :embedding, ${_get_distance_function(this.distanceStrategy)}) as distance
			FROM
				"${this.tableName}"
			ORDER BY
				distance
			FETCH APPROX FIRST ${k} ROWS ONLY
	  `;
		const connection = await _get_connection(this.client);
		const vector = new Float32Array(query);
		const result = await connection.execute(
			sqlQuery,
			{ embedding: { type: oracledb.DB_TYPE_VECTOR, val: vector } }, // bind the embedding vector
			{ outFormat: oracledb.OUT_FORMAT_OBJECT }
		);

		// Map results to [DocumentInterface, number][]
		const rows = (result.rows || []) as any[];
		// TODO: filter
		return rows.map(row => {
			const doc: DocumentInterface = {
				pageContent: row.TEXT,
				metadata: row.METADATA ? JSON.parse(row.METADATA) : {},
			};
			return [doc, row.DISTANCE];
		});
	}

}



