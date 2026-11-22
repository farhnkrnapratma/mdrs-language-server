// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { describe, expect, test } from 'bun:test';
import { analyze } from '../src/analyzer.js';

const messages = (text: string) => analyze(text).diagnostics.map(d => `${d.range.start.line + 1}:${d.message}`);

describe('structure', () => {
    test('a valid document has no diagnostics', () => {
        const doc = [
            '---',
            'title: Hello',
            'tags: [mdrs]',
            '---',
            ':::define',
            'name: "MDRS"',
            'count: 3, double: this.count * 2 // comment',
            'stats: { stable: true, list: [1, 2] }',
            "city: get('https://api.example.com/v1/author', '.profile.city')",
            ':::',
            '',
            '# ${name} has ${double} items',
            '',
            ':::callout title="Hi ${name}" icon="rocket"',
            ':::details summary="More"',
            'Body with `${literal}` and \\${escaped}.',
            ':::',
            ':::',
            '',
            ':::tabs',
            '::tab label="One"',
            'First',
            '::',
            ':::',
            '',
            ':::embed url="https://youtu.be/abc"',
            '',
            ':::if count > 2 && stats.stable',
            'Many',
            ':::elif count == 1',
            'One',
            ':::else',
            'None',
            ':::endif',
            '',
            'This is ${if count > 1}plural${else}single${endif}.',
            '',
            '```mdrs',
            ':::callout',
            '${nope}',
            '```',
            '',
            '::::verbatim',
            ':::note',
            '${raw}',
            ':::',
            '::::',
            '',
            ':::math',
            '\\sum_{k=1}^{${count}} k',
            ':::'
        ].join('\n');
        expect(messages(doc)).toEqual([]);
    });

    test('reports unknown, unclosed and stray directives', () => {
        expect(messages(':::foo\nx\n:::')).toEqual(["1:Unknown directive ':::foo'. It renders as plain text."]);
        expect(messages(':::note\nx')[0]).toContain(':::note is never closed');
        expect(messages('text\n:::')).toEqual(['2:`:::` has no open block to close. It renders as plain text.']);
    });

    test('checks required, unknown, duplicate and unquoted attributes', () => {
        expect(messages(':::callout\nx\n:::')).toEqual(['1::::callout requires title="..."']);
        expect(messages(':::details summary="a" open="yes"\nx\n:::')).toEqual(["1::::details has no 'open' attribute; it is ignored."]);
        expect(messages(':::callout title="a" title="b"\nx\n:::')).toEqual(["1:'title' is set more than once."]);
        expect(messages(":::callout title='a'\nx\n:::")).toContain(
            "1:'title='a'' is not a key=\"value\" attribute and is ignored. Values need double quotes."
        );
    });

    test('checks tab groups and tabs', () => {
        expect(messages(':::tabs\n:::')).toEqual(['1::::tabs requires at least one ::tab']);
        expect(messages(':::tabs\n::tab\nx\n::\n:::')).toEqual(['2:Every ::tab in :::tabs requires label="..."']);
        expect(messages('::tab label="x"\n::')).toContain('1:::tab must sit directly inside :::tabs or :::snippets.');
        expect(messages(':::tabs\n::tab label="a"\nx\n:::')).toContain('2:::tab is never closed with `::`.');
    });

    test('checks embeds and references', () => {
        expect(messages(':::embed')).toEqual(['1::::embed requires url="..."']);
        expect(messages(':::embed url="ftp://x"')[0]).toContain('must start with http');
        expect(messages(':::references\n\n:::\n:::references\n\n:::')).toContain('4:Use at most one :::references block per document.');
    });

    test('limits directive nesting', () => {
        const doc = `${':::note\n'.repeat(17)}${':::\n'.repeat(17)}`;
        expect(messages(doc).some(message => message.includes('nest at most 16'))).toBe(true);
    });
});

describe(':::define', () => {
    test('must come first and only once', () => {
        expect(messages('Intro\n\n:::define\na: 1\n:::')).toContain(
            '3:Only one :::define block is allowed, and it must be the first thing in the document.'
        );
    });

    test('needs at least one entry', () => {
        expect(messages(':::define\n// nothing\n:::')).toEqual(['1:A :::define block needs at least one entry.']);
    });

    test('reports invalid, duplicate and bare names', () => {
        const result = messages(':::define\nif: 1\na: 1\na: 2\nb: a + 1\n:::');
        expect(result).toContain("2:'if' is not a valid variable name (check reserved words / naming rules)");
        expect(result).toContain("4:'a' is already defined");
        expect(result).toContain("5:'a' is not valid here — use this.a inside :::define");
    });

    test('reports forward references and syntax errors', () => {
        expect(messages(':::define\na: this.b\nb: 1\n:::')).toContain("2:'b' is undefined, or referenced before it was defined");
        expect(messages(':::define\na: "open\n:::').some(message => message.includes('Unterminated'))).toBe(true);
    });

    test('checks get() URLs and paths', () => {
        const result = messages(":::define\na: get('http://x.example', '.a')\nb: get('https://x.example', 'a')\n:::");
        expect(result).toContain('2:get() only fetches https:// URLs.');
        expect(result.some(message => message.startsWith('3:get() paths start with a dot'))).toBe(true);
    });

    test('is never closed', () => {
        expect(messages(':::define\na: 1')).toEqual(['1::::define is never closed with `:::`.']);
    });
});

describe('interpolation and conditionals', () => {
    test('marks interpolation without :::define as a hint', () => {
        const diagnostics = analyze('Hello ${name}').diagnostics;
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].severity).toBe(4);
    });

    test('reports undefined variables and this in the body', () => {
        const result = messages(':::define\na: 1\n:::\n${b} ${this.a}');
        expect(result).toContain("4:'b' is undefined");
        expect(result).toContain('4:this.* is only valid inside a :::define block');
    });

    test('checks inline conditional structure', () => {
        expect(messages(':::define\na: true\n:::\n${else}')).toContain('4:${else} has no matching ${if}');
        expect(messages(':::define\na: true\n:::\n${if a}x')).toContain("4:'${if a}' is never closed with ${endif}");
    });

    test('checks block conditional structure', () => {
        expect(messages(':::endif')).toEqual(["1:':::endif' has no matching :::if"]);
        expect(messages(':::if true\nx')).toEqual(["1:':::if true' is never closed with :::endif"]);
        expect(messages(':::if true\n:::else\n:::elif true\n:::endif')).toContain("3:':::elif' has no matching :::if");
    });

    test('block conditionals without :::define accept get() but not names', () => {
        expect(messages(":::if get('https://api.example.com/x', '.on')\nx\n:::endif")).toEqual([]);
        expect(messages(':::if on\nx\n:::endif')[0]).toContain("'on' is undefined (block conditionals without");
    });

    test('reports invalid frontmatter YAML', () => {
        expect(messages('---\ntitle: [unclosed\n---\n')[0]).toContain('Invalid frontmatter YAML');
    });
});
