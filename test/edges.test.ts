// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, test } from 'bun:test';
import type { MarkupContent } from 'vscode-languageserver-types';
import { analyze } from '../src/analyzer.js';
import { complete } from '../src/completion.js';
import { hover } from '../src/hover.js';
import { documentSymbols } from '../src/structure.js';

const DEFINE = ':::define\nname: "MDRS"\ncount: 3\ndouble: this.count * 2\nurl: get("https://x.y", ".a")\n:::\n';
const labels = (line: string) => {
    const analysis = analyze(`${DEFINE}${line}`);
    return complete(analysis, { line: 6, character: line.length }).map(item => item.label);
};
const hoverText = (text: string, line: number, character: number) =>
    (hover(analyze(text), { line, character })?.contents as MarkupContent | undefined)?.value;

describe('completion outside an open ${', () => {
    test.each([
        ['after a closed interpolation', 'a ${name} b '],
        ['after an escaped ${', 'a \\${na']
    ])('offers no variables %s', (_, line) => {
        expect(labels(line)).not.toContain('name');
    });

    test('tracks braces and quotes inside an open interpolation', () => {
        expect(labels('${ {a: "}"}.a + ')).toContain('name');
    });
});

describe('hover', () => {
    test('explains an attribute the directive ignores', () => {
        expect(hoverText(':::callout title="x" foo="y"\n:::', 0, 22)).toBe('`foo` is not an attribute of :::callout and is ignored.');
    });

    test('flags an undefined variable', () => {
        expect(hoverText(`${DEFINE}\${nope}`, 6, 3)).toBe('`nope` is not defined in :::define.');
    });

    test.each([
        ['an inline keyword', `${DEFINE}\${if count}x\${endif}`, 6, 3, 'if'],
        ['get()', DEFINE, 4, 6, 'get('],
        ['this', DEFINE, 3, 9, 'this.']
    ])('documents %s', (_, text, line, character, needle) => {
        expect(hoverText(text, line, character)).toContain(needle);
    });

    test('returns nothing for plain text', () => {
        expect(hover(analyze('plain'), { line: 0, character: 2 })).toBeNull();
    });
});

test('lists a directive before the first heading at the top level', () => {
    expect(documentSymbols(analyze(':::callout title="x"\n:::\n# H')).map(symbol => symbol.name)).toEqual([':::callout x', 'H']);
});

test('reads heading text without the closing sequence', () => {
    const texts = (source: string) => analyze(source).headings.map(heading => heading.text);
    expect(texts('# Title #')).toEqual(['Title']);
    expect(texts('## Title ##   ')).toEqual(['Title']);
    expect(texts('# C#')).toEqual(['C#']);
    expect(texts('### ###')).toEqual(['']);
    expect(texts('#\tTab')).toEqual(['Tab']);
    expect(texts('#NoSpace')).toEqual([]);
});

test('analyzes a heading with a long run of spaces in linear time', () => {
    const start = performance.now();
    analyze(`# a${' '.repeat(100_000)}x`);
    expect(performance.now() - start).toBeLessThan(500);
});
