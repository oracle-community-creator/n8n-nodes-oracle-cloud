import type { Document } from '@langchain/core/documents';

function readBlobOrString(input: Blob | string): Promise<string> {
    if (typeof input === 'string') return Promise.resolve(input);
    return input.text();
}

function getByJsonPointer(obj: any, pointer: string): any {
    // Very small JSON Pointer (RFC6901) implementation for our needs
    if (!pointer || pointer === '' || pointer === '/') return obj;
    if (pointer[0] !== '/') return obj;
    const parts = pointer
        .split('/')
        .slice(1)
        .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    return parts.reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

export class JSONBlobLoader {
    constructor(private file: Blob | string, private pointers: string[] = []) { }

    async load(): Promise<Document[]> {
        const raw = await readBlobOrString(this.file);
        const json = JSON.parse(raw);

        const docs: Document[] = [];
        const targets = this.pointers.length ? this.pointers : [''];

        for (const ptr of targets) {
            const value = getByJsonPointer(json, ptr);
            if (Array.isArray(value)) {
                for (const item of value) {
                    docs.push({ pageContent: typeof item === 'string' ? item : JSON.stringify(item), metadata: {} });
                }
            } else if (value !== undefined) {
                docs.push({ pageContent: typeof value === 'string' ? value : JSON.stringify(value), metadata: {} });
            }
        }

        // Fallback to full JSON if nothing was matched
        if (docs.length === 0) {
            docs.push({ pageContent: JSON.stringify(json), metadata: {} });
        }

        return docs;
    }
}

export class TextBlobLoader {
    constructor(private file: Blob | string) { }

    async load(): Promise<Document[]> {
        const text = await readBlobOrString(this.file);
        return [{ pageContent: text, metadata: {} }];
    }
}
