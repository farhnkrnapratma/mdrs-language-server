// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';

type Message = { id?: number; method?: string; params?: unknown; result?: unknown };

function client() {
    const child = spawn(process.env.MDRS_LS_NODE ? 'node' : 'bun', [process.env.MDRS_LS_NODE ? 'dist/cli.js' : 'src/cli.ts', '--stdio'], {
        cwd: `${import.meta.dir}/..`
    });
    let buffer = Buffer.alloc(0);
    const messages: Message[] = [];
    const waiters: { match: (message: Message) => boolean; resolve: (message: Message) => void }[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;
            const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())?.[1]);
            if (buffer.length < headerEnd + 4 + length) return;
            const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString()) as Message;
            buffer = buffer.subarray(headerEnd + 4 + length);
            const waiter = waiters.findIndex(item => item.match(message));
            if (waiter === -1) messages.push(message);
            else waiters.splice(waiter, 1)[0].resolve(message);
        }
    });
    const send = (message: object) => {
        const body = JSON.stringify({ jsonrpc: '2.0', ...message });
        child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    };
    const wait = (match: (message: Message) => boolean) =>
        new Promise<Message>(resolve => {
            const found = messages.findIndex(match);
            if (found !== -1) resolve(messages.splice(found, 1)[0]);
            else waiters.push({ match, resolve });
        });
    let id = 0;
    const request = (method: string, params: object) => {
        const requestId = ++id;
        send({ id: requestId, method, params });
        return wait(message => message.id === requestId);
    };
    return { child, send, wait, request };
}

test('serves diagnostics, completion and hover over stdio', async () => {
    const { child, send, wait, request } = client();
    const init = await request('initialize', { processId: null, rootUri: null, capabilities: {} });
    expect(init.result).toMatchObject({
        capabilities: { hoverProvider: true, completionProvider: { triggerCharacters: [':', '{', '.', ' '] } },
        serverInfo: { name: 'mdrs-language-server' }
    });
    send({ method: 'initialized', params: {} });

    const uri = 'file:///test.mdrs';
    send({
        method: 'textDocument/didOpen',
        params: { textDocument: { uri, languageId: 'mdrs', version: 1, text: ':::callout\nBody\n:::\n:::' } }
    });
    const diagnostics = await wait(message => message.method === 'textDocument/publishDiagnostics');
    expect((diagnostics.params as { diagnostics: { message: string }[] }).diagnostics.map(d => d.message)).toEqual([
        ':::callout requires title="..."',
        '`:::` has no open block to close. It renders as plain text.'
    ]);

    const completion = await request('textDocument/completion', {
        textDocument: { uri },
        position: { line: 0, character: 3 }
    });
    expect((completion.result as { label: string }[]).map(item => item.label)).toContain(':::details');

    const hovered = await request('textDocument/hover', { textDocument: { uri }, position: { line: 0, character: 5 } });
    expect(JSON.stringify(hovered.result)).toContain(':::callout');

    await request('shutdown', {});
    send({ method: 'exit' });
    await new Promise(resolve => child.once('exit', resolve));
}, 20000);
