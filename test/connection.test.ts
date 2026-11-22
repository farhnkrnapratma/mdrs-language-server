// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { afterAll, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import {
    createConnection,
    createMessageConnection,
    type Diagnostic,
    StreamMessageReader,
    StreamMessageWriter
} from 'vscode-languageserver/node';
import { startServer } from '../src/index.js';

const toServer = new PassThrough();
const toClient = new PassThrough();
const server = startServer(createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient)));
const client = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
const published: { uri: string; diagnostics: Diagnostic[] }[] = [];
const waiters: (() => void)[] = [];
client.onNotification('textDocument/publishDiagnostics', (params: { uri: string; diagnostics: Diagnostic[] }) => {
    published.push(params);
    waiters.shift()?.();
});
client.listen();

const nextDiagnostics = () =>
    new Promise<{ uri: string; diagnostics: Diagnostic[] }>(resolve => {
        const count = published.length;
        waiters.push(() => resolve(published[count]));
    });

afterAll(() => {
    client.dispose();
    server.dispose();
});

const uri = 'file:///doc.mdrs';
const missing = { textDocument: { uri: 'file:///missing.mdrs' }, position: { line: 0, character: 0 } };
const text = ':::define\nname: "Ada"\n:::\n\n# Title\n\nHello ${name} and ${name}\n\n:::callout\nBody\n:::\n';

test('answers every request for an open document', async () => {
    const init = (await client.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {} })) as {
        serverInfo: { name: string };
    };
    expect(init.serverInfo.name).toBe('mdrs-language-server');
    client.sendNotification('initialized', {});

    const opened = nextDiagnostics();
    client.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'mdrs', version: 1, text } });
    expect((await opened).diagnostics.map(d => d.message)).toEqual([':::callout requires title="..."']);

    const at = (line: number, character: number) => ({ textDocument: { uri }, position: { line, character } });
    const completion = (await client.sendRequest('textDocument/completion', at(6, 9))) as { label: string }[];
    expect(completion.map(item => item.label)).toContain('name');
    expect(JSON.stringify(await client.sendRequest('textDocument/hover', at(8, 4)))).toContain(':::callout');
    expect(await client.sendRequest('textDocument/documentSymbol', { textDocument: { uri } })).not.toEqual([]);
    expect(await client.sendRequest('textDocument/foldingRange', { textDocument: { uri } })).not.toEqual([]);
    expect(await client.sendRequest('textDocument/definition', at(6, 9))).toMatchObject({ uri, range: { start: { line: 1 } } });
    const refs = (await client.sendRequest('textDocument/references', { ...at(6, 9), context: { includeDeclaration: true } })) as unknown[];
    expect(refs).toHaveLength(3);
    const highlights = (await client.sendRequest('textDocument/documentHighlight', at(6, 9))) as { range: unknown }[];
    expect(highlights).toHaveLength(3);
});

test('debounces edits and clears diagnostics on close', async () => {
    const changed = nextDiagnostics();
    client.sendNotification('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: ':::callout title="x"\nBody\n' }]
    });
    client.sendNotification('textDocument/didChange', {
        textDocument: { uri, version: 3 },
        contentChanges: [{ text: ':::callout title="x"\nBody\n:::\n' }]
    });
    const after = await changed;
    expect(after).toMatchObject({ uri, version: 3, diagnostics: [] });

    client.sendNotification('textDocument/didChange', { textDocument: { uri, version: 4 }, contentChanges: [{ text: ':::' }] });
    const closed = nextDiagnostics();
    client.sendNotification('textDocument/didClose', { textDocument: { uri } });
    expect(await closed).toEqual({ uri, diagnostics: [] });
    await Bun.sleep(200);
    expect(published.at(-1)).toEqual({ uri, diagnostics: [] });
});

test('returns empty results for unknown documents', async () => {
    expect(await client.sendRequest('textDocument/completion', missing)).toEqual([]);
    expect(await client.sendRequest('textDocument/hover', missing)).toBeNull();
    expect(await client.sendRequest('textDocument/documentSymbol', { textDocument: missing.textDocument })).toEqual([]);
    expect(await client.sendRequest('textDocument/foldingRange', { textDocument: missing.textDocument })).toEqual([]);
    expect(await client.sendRequest('textDocument/definition', missing)).toBeNull();
    expect(await client.sendRequest('textDocument/references', { ...missing, context: { includeDeclaration: true } })).toEqual([]);
    expect(await client.sendRequest('textDocument/documentHighlight', missing)).toEqual([]);
});
