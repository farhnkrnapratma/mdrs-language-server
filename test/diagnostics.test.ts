// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, test } from 'bun:test';
import { analyze, MAX_DEPTH, MAX_INLINE_DEPTH } from '../src/analyzer.js';

const messages = (text: string) => analyze(text).diagnostics.map(d => d.message);
const withDefine = (body: string) => `:::define\nx: true\n:::\n${body}`;
const repeat = (text: string, count: number) => Array.from({ length: count }, () => text).join('\n');

describe('block directives', () => {
    test.each([
        [
            'a conditional inside a blockquote',
            '> :::if true\n> x',
            ':::if inside a blockquote is plain text; put the conditional around the whole blockquote.'
        ],
        ['attributes on :::verbatim', ':::verbatim x\nraw\n:::', ':::verbatim takes no attributes.'],
        ['an unclosed :::verbatim', ':::verbatim\nraw', ':::verbatim is never closed with :::.'],
        ['an unclosed :::define', ':::define\na: 1', ':::define is never closed with `:::`.'],
        ['::tab with three colons', ':::tab label="x"\n:::', '::tab takes two colons and must sit inside :::tabs or :::snippets.'],
        ['attributes on :::references', ':::references x\n- a\n:::', 'The opening line is exactly :::references, without attributes.'],
        ['a second :::references', ':::references\n- a\n:::\n:::references\n- b\n:::', 'Use at most one :::references block per document.']
    ])('reports %s', (_, text, message) => {
        expect(messages(text)).toContain(message);
    });
});

describe('conditionals', () => {
    test.each([
        [
            'too deep',
            `${repeat(':::if true', MAX_DEPTH + 1)}\n${repeat(':::endif', MAX_DEPTH + 1)}`,
            `:::if nests at most ${MAX_DEPTH} levels deep.`
        ],
        ['an :::else after :::else', ':::if true\n:::else\n:::else\n:::endif', "':::else' has no matching :::if"],
        ['text after :::endif', ':::if true\n:::endif x', ':::endif takes nothing after it.'],
        ['an empty :::elif', ':::if true\n:::elif\n:::endif', 'Expected a condition after the keyword.'],
        ['a parse error', ':::if (1 +\n:::endif', "Unexpected token 'EOF' at position 5"]
    ])('reports %s', (_, text, message) => {
        expect(messages(text)).toContain(message);
    });

    test('places a positioned parse error on its character', () => {
        const [diagnostic] = analyze(':::if (1 +\n:::endif').diagnostics;
        expect(diagnostic.range.start.character).toBe(10);
    });

    test('accepts :::elif with a condition', () => {
        expect(messages(':::if true\n:::elif false\n:::endif')).toEqual([]);
    });
});

describe('get()', () => {
    test('walks every expression kind without errors', () => {
        expect(messages(':::define\na: [1, {b: !true}], c: 1 > 2 ? "x${a}" : -1, d: get("https://x.y", ".a")\n:::')).toEqual([]);
    });

    test.each([
        ['nope', '.a', "get() needs an absolute URL, got 'nope'."],
        ['http://x.y', '.a', 'get() only fetches https:// URLs.'],
        ['https://u:p@x.y', '.a', 'get() URLs cannot carry a username or password.'],
        ['https://x.y', 'a', "get() paths start with a dot and name a field, such as '.name' (got 'a')."],
        ['https://x.y', '.a b', `'.a b' is not a valid jq-style path. Use .name, .items[0] or .["odd-key"].`]
    ])('rejects get(%p, %p)', (url, path, message) => {
        expect(messages(`:::define\na: get("${url}", "${path}")\n:::`)).toEqual([message]);
    });
});

describe('inline conditionals', () => {
    test.each([
        ['an empty ${}', 'a ${} b', 'Empty ${}.'],
        ['an empty ${if}', '${if}x${endif}', 'Expected a condition after ${if.'],
        ['a stray ${else}', '${else}', '${else} has no matching ${if}'],
        ['an empty ${elif}', '${if x}a${elif}b${endif}', 'Expected a condition after ${elif.'],
        ['${elif} after ${else}', '${if x}a${else}b${elif x}c${endif}', '${elif} has no matching ${if}'],
        ['text after ${else}', '${if x}a${else y}b${endif}', '${else} takes nothing after it.'],
        [
            'too deep',
            `${'${if x}'.repeat(MAX_INLINE_DEPTH + 1)}${'${endif}'.repeat(MAX_INLINE_DEPTH + 1)}`,
            '${if} is nested more than 8 levels deep'
        ]
    ])('reports %s', (_, body, message) => {
        expect(messages(withDefine(body))).toContain(message);
    });

    test('accepts ${elif} with a condition', () => {
        expect(messages(withDefine('${if x}a${elif !x}b${else}c${endif}'))).toEqual([]);
    });
});
