// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, test } from 'bun:test';
import { tokenize } from '../src/expr/lexer.js';
import { Parser } from '../src/expr/parser.js';

const parse = (source: string) => new Parser(tokenize(source)).parseCompleteExpression();
const define = (source: string) => new Parser(tokenize(source)).parseDefineBlock();

describe('expressions', () => {
    test.each([
        ["'a\\'b\\\\c'", { kind: 'string', value: "a'b\\c" }],
        ['"$"', { kind: 'string', value: '$' }],
        ['"$1"', { kind: 'string', value: '$1' }],
        ['"a\\nb\\q"', { kind: 'string', value: 'a\nbq' }],
        ['1.5', { kind: 'number', value: 1.5 }],
        [
            '"pre $name post"',
            {
                kind: 'template',
                parts: [
                    { kind: 'text', value: 'pre ' },
                    { kind: 'variable', name: 'name' },
                    { kind: 'text', value: ' post' }
                ]
            }
        ],
        [
            'a.b[0]["k"]',
            {
                kind: 'reference',
                root: 'a',
                path: [
                    { kind: 'prop', name: 'b' },
                    { kind: 'index', value: 0 },
                    { kind: 'index', value: 'k' }
                ]
            }
        ]
    ])('parses %s', (source, expected) => {
        expect(parse(source)).toMatchObject(expected);
    });

    test('parses every binary operator', () => {
        expect(JSON.stringify(parse('a && b || !c == d != e < f <= g > h >= i + j - k * l / m % n'))).toContain('"op":"%"');
    });

    test.each([
        ["'open", 'Unterminated string literal at position 0'],
        ['"x${a', 'Unterminated ${...} in string at position 2'],
        ['1.', "Unexpected token '.' at position 1"],
        ['a[x]', 'Expected a number or string inside [...] at position 2'],
        ['a.', "Expected a property name after . (got 'EOF' at position 2)"],
        ['a ? b', "Expected ':' in a ternary expression (got 'EOF' at position 5)"],
        ['(1', "Expected ')' (got 'EOF' at position 2)"],
        ['[1, 2', "Unexpected token 'EOF' at position 5"],
        ['{a 1}', "Expected ':' after 'a' (got '1' at position 3)"],
        ['{1: 2}', "Expected an object key (got '1' at position 1)"],
        ['foo(1)', "Unknown function 'foo' (supported: get)"],
        ['get(1 2)', "Expected ',' between the get() arguments (got '2' at position 6)"],
        ['get(1, 2', "Expected ')' after the get() arguments (got 'EOF' at position 8)"],
        ['#', "Unexpected character '#' at position 0"],
        [')', "Unexpected token ')' at position 0"],
        ['a b', "Unexpected token 'b' at position 2"],
        ['"${1 +}"', "Unexpected token 'EOF' at position 3"]
    ])('rejects %s', (source, message) => {
        expect(() => parse(source)).toThrow(message);
    });
});

describe('define blocks', () => {
    test('parses newline and comma separated assignments', () => {
        expect(define('a: 1\nb: 2,').map(item => item.key)).toEqual(['a', 'b']);
    });

    test.each([
        ['a 1', "Expected ':' after 'a' (got '1' at position 2)"],
        ['1: 2', "Expected a variable name (got '1' at position 0)"]
    ])('rejects %s', (source, message) => {
        expect(() => define(source)).toThrow(message);
    });
});
