// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, test } from 'bun:test';
import type { MarkupContent } from 'vscode-languageserver';
import { analyze } from '../src/analyzer.js';
import { complete } from '../src/completion.js';
import { hover } from '../src/hover.js';
import { definition, documentHighlights, documentSymbols, foldingRanges, references } from '../src/structure.js';

const DOC = [
    ':::define',
    'name: "MDRS"',
    'count: 3',
    'double: this.count * 2',
    ':::',
    '',
    '# Title ${name}',
    '',
    ':::callout title="Hi" icon="rocket"',
    'Body ${count}',
    ':::',
    '',
    '## Tabs',
    '',
    ':::tabs',
    '::tab label="One"',
    'First',
    '::',
    ':::',
    '',
    ':::if count > 1',
    'Many',
    ':::else',
    'One',
    ':::endif',
    '',
    '```ts',
    'const a = 1;',
    '```'
].join('\n');

const at = (text: string, line: number, character: number) => complete(analyze(text), { line, character });
const labels = (text: string, line: number, character: number) => at(text, line, character).map(item => item.label);
const hoverText = (line: number, character: number) =>
    (hover(analyze(DOC), { line, character })?.contents as MarkupContent | undefined)?.value ?? '';

describe('completion', () => {
    test('offers directive names after :::', () => {
        const items = labels('Intro\n\n:::', 2, 3);
        expect(items).toContain(':::callout');
        expect(items).toContain(':::if');
        expect(items).not.toContain(':::define');
        expect(items).not.toContain(':::tab');
        expect(labels(':::', 0, 3)).toContain(':::define');
    });

    test('inserts a snippet that replaces the typed prefix', () => {
        const item = at('x\n:::cal', 1, 7).find(entry => entry.label === ':::callout');
        expect(item?.textEdit).toMatchObject({
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } },
            newText: 'callout title="${1:Title}"\n$0\n:::'
        });
    });

    test('offers ::tab inside a tab group only', () => {
        expect(labels(':::tabs\n::\n:::', 1, 2)).toEqual(['::tab']);
        expect(labels('x\n::', 1, 2)).toEqual([]);
    });

    test('offers missing attributes on an opening line', () => {
        expect(labels(':::callout ', 0, 11)).toEqual(['title', 'icon']);
        expect(labels(':::callout title="a" ', 0, 21)).toEqual(['icon']);
        expect(labels(':::callout title="a ', 0, 20)).toEqual([]);
        expect(labels(':::tabs\n::tab ', 1, 6)).toEqual(['label', 'icon']);
    });

    test('offers variables, keywords and get() inside ${', () => {
        const text = `${DOC}\n\${`;
        const items = labels(text, 29, 2);
        expect(items).toEqual(expect.arrayContaining(['name', 'count', 'double', 'if', 'endif', 'get', 'true']));
        expect(labels(`${DOC}\n\${"a`, 29, 4)).toEqual([]);
    });

    test('offers earlier entries through this. inside :::define', () => {
        expect(labels(DOC, 3, 13).sort()).toEqual(['count', 'name']);
        expect(labels(':::define\na: 1\nb: \n:::', 2, 3)).toEqual(expect.arrayContaining(['this.a', 'this', 'get']));
    });

    test('offers variables in :::if conditions and nothing in code fences', () => {
        expect(labels(`${DOC}\n:::if c`, 29, 7)).toEqual(expect.arrayContaining(['count']));
        expect(labels(DOC, 27, 5)).toEqual([]);
    });
});

describe('hover', () => {
    test('documents directives, attributes and conditionals', () => {
        expect(hoverText(8, 5)).toContain('**:::callout**');
        expect(hoverText(8, 5)).toContain('| `title` | yes |');
        expect(hoverText(8, 12)).toContain('**title** (required)');
        expect(hoverText(15, 3)).toContain('**::tab**');
        expect(hoverText(20, 4)).toContain('**:::if**');
    });

    test('shows variable definitions', () => {
        expect(hoverText(6, 11)).toContain('name: "MDRS"');
        expect(hoverText(3, 14)).toContain('count: 3');
        expect(hoverText(20, 7)).toContain('count: 3');
    });

    test('returns null on plain text', () => {
        expect(hover(analyze(DOC), { line: 16, character: 2 })).toBeNull();
    });
});

describe('symbols and folding', () => {
    test('builds an outline of define, headings and directives', () => {
        const symbols = documentSymbols(analyze(DOC));
        expect(symbols.map(symbol => symbol.name)).toEqual([':::define', 'Title ${name}']);
        expect(symbols[0].children?.map(child => child.name)).toEqual(['name', 'count', 'double']);
        const title = symbols[1];
        expect(title.children?.map(child => child.name)).toEqual([':::callout Hi', 'Tabs']);
        const tabs = title.children?.[1];
        expect(tabs?.children?.[0].name).toBe(':::tabs');
        expect(tabs?.children?.[0].children?.[0].name).toBe('::tab One');
    });

    test('folds blocks, branches, fences and sections', () => {
        const ranges = foldingRanges(analyze(DOC)).map(range => `${range.startLine}-${range.endLine}`);
        expect(ranges).toEqual(expect.arrayContaining(['0-4', '8-10', '14-18', '15-17', '20-21', '22-23', '26-28']));
        expect(ranges).toContain('6-28');
    });
});

describe('navigation', () => {
    const analysis = analyze(DOC);
    test('jumps to the define entry', () => {
        expect(definition(analysis, 'file:///a.mdrs', { line: 9, character: 8 })?.range.start).toEqual({ line: 2, character: 0 });
        expect(definition(analysis, 'file:///a.mdrs', { line: 16, character: 1 })).toBeNull();
    });

    test('lists references and highlights', () => {
        const found = references(analysis, 'file:///a.mdrs', { line: 2, character: 1 }, true).map(item => item.range.start.line);
        expect(found).toEqual([2, 3, 9, 20]);
        expect(documentHighlights(analysis, { line: 9, character: 8 })).toHaveLength(4);
    });
});
