// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import {
    type Connection,
    createConnection,
    type InitializeResult,
    ProposedFeatures,
    TextDocumentSyncKind,
    TextDocuments
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { type Analysis, analyze } from './analyzer.js';
import { complete } from './completion.js';
import { hover } from './hover.js';
import { VERSION } from './version.js';
import { definition, documentHighlights, documentSymbols, foldingRanges, references } from './structure.js';

export const SERVER_NAME = 'mdrs-language-server';

export function startServer(connection: Connection = createConnection(ProposedFeatures.all)): Connection {
    const documents = new TextDocuments(TextDocument);
    const cache = new Map<string, { version: number; analysis: Analysis }>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const analysisOf = (document: TextDocument): Analysis => {
        const cached = cache.get(document.uri);
        if (cached && cached.version === document.version) return cached.analysis;
        const analysis = analyze(document.getText());
        cache.set(document.uri, { version: document.version, analysis });
        return analysis;
    };
    const withDocument = <T>(uri: string, fallback: T, run: (analysis: Analysis) => T): T => {
        const document = documents.get(uri);
        return document ? run(analysisOf(document)) : fallback;
    };
    const publish = (document: TextDocument) => {
        void connection.sendDiagnostics({
            uri: document.uri,
            version: document.version,
            diagnostics: analysisOf(document).diagnostics
        });
    };

    connection.onInitialize(
        (): InitializeResult => ({
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                completionProvider: { triggerCharacters: [':', '{', '.', ' '] },
                hoverProvider: true,
                documentSymbolProvider: true,
                foldingRangeProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                documentHighlightProvider: true
            },
            serverInfo: { name: SERVER_NAME, version: VERSION }
        })
    );

    documents.onDidChangeContent(({ document }) => {
        clearTimeout(timers.get(document.uri));
        timers.set(
            document.uri,
            setTimeout(() => {
                timers.delete(document.uri);
                publish(document);
            }, 150)
        );
    });
    documents.onDidOpen(({ document }) => publish(document));
    documents.onDidClose(({ document }) => {
        clearTimeout(timers.get(document.uri));
        timers.delete(document.uri);
        cache.delete(document.uri);
        void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    });

    connection.onCompletion(params => withDocument(params.textDocument.uri, [], analysis => complete(analysis, params.position)));
    connection.onHover(params => withDocument(params.textDocument.uri, null, analysis => hover(analysis, params.position)));
    connection.onDocumentSymbol(params => withDocument(params.textDocument.uri, [], documentSymbols));
    connection.onFoldingRanges(params => withDocument(params.textDocument.uri, [], foldingRanges));
    connection.onDefinition(params =>
        withDocument(params.textDocument.uri, null, analysis => definition(analysis, params.textDocument.uri, params.position))
    );
    connection.onReferences(params =>
        withDocument(params.textDocument.uri, [], analysis =>
            references(analysis, params.textDocument.uri, params.position, params.context.includeDeclaration)
        )
    );
    connection.onDocumentHighlight(params =>
        withDocument(params.textDocument.uri, [], analysis =>
            documentHighlights(analysis, params.position).map(range => ({ range }))
        )
    );

    documents.listen(connection);
    connection.listen();
    return connection;
}
