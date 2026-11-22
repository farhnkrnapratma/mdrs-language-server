// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { type CompletionItem, CompletionItemKind, InsertTextFormat, MarkupKind, type Position } from 'vscode-languageserver';
import type { Analysis } from './analyzer.js';
import { DIRECTIVES, type DirectiveSpec, directiveSpec, KEYWORD_DOCS } from './directives.js';
import { enclosingDirective, isInsideDefine, isInsideFence } from './navigation.js';

const PREFIX = '^( {0,3}(?:> ?)*)';
const DIRECTIVE_NAME_RE = new RegExp(`${PREFIX}(:{3,})([A-Za-z-]*)$`);
const TAB_NAME_RE = new RegExp(`${PREFIX}::([A-Za-z-]*)$`);
const OPEN_LINE_RE = new RegExp(`${PREFIX}(:{2,})([A-Za-z][A-Za-z-]*)((?:\\s+[A-Za-z][\\w-]*="(?:[^"\\\\]|\\\\.)*")*)\\s+([A-Za-z-]*)$`);
const CONDITION_RE = new RegExp(`${PREFIX}:::(?:if|elif)\\s+(.*)$`);

function documentation(spec: DirectiveSpec) {
    const attributes = spec.attributes.length
        ? `\n\nAttributes: ${spec.attributes.map(attribute => `\`${attribute.name}\`${attribute.required ? ' (required)' : ''}`).join(', ')}`
        : '';
    return { kind: MarkupKind.Markdown, value: `${spec.summary}${attributes}\n\n[Documentation](${spec.docs})` };
}

function directiveItems(analysis: Analysis, position: Position, typed: string, start: number): CompletionItem[] {
    const firstContent = firstContentLine(analysis);
    const parent = enclosingDirective(analysis, position.line);
    return DIRECTIVES.filter(spec => {
        if (spec.kind === 'tab') return false;
        if (spec.kind === 'define') return position.line === firstContent && !analysis.define;
        if (spec.kind === 'math' || spec.kind === 'references' || spec.kind === 'verbatim') return true;
        return parent?.spec?.kind !== 'tabGroup' || spec.kind === 'conditional';
    }).map(spec => ({
        label: `:::${spec.name}`,
        filterText: `:::${spec.name}`,
        kind: spec.kind === 'conditional' ? CompletionItemKind.Keyword : CompletionItemKind.Module,
        detail: spec.kind === 'conditional' ? 'MDRS conditional' : 'MDRS directive',
        documentation: documentation(spec),
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: {
            range: { start: { line: position.line, character: start }, end: position },
            newText: spec.snippet
        },
        sortText: `${spec.kind === 'conditional' ? '1' : '0'}${spec.name}`,
        preselect: typed !== '' && spec.name.startsWith(typed.toLowerCase())
    }));
}

function firstContentLine(analysis: Analysis): number {
    let line = analysis.frontmatter ? analysis.frontmatter.end + 1 : 0;
    while (line < analysis.lines.length && analysis.lines[line].trim() === '') line++;
    return line;
}

function attributeItems(name: string, present: string, position: Position, typed: string): CompletionItem[] {
    const spec = directiveSpec(name);
    const used = new Set([...present.matchAll(/([A-Za-z][\w-]*)="/g)].map(match => match[1].toLowerCase()));
    return (spec?.attributes ?? [])
        .filter(attribute => !used.has(attribute.name))
        .map(attribute => ({
            label: attribute.name,
            kind: CompletionItemKind.Property,
            detail: attribute.required ? 'required' : 'optional',
            documentation: { kind: MarkupKind.Markdown, value: attribute.description },
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: {
                range: { start: { line: position.line, character: position.character - typed.length }, end: position },
                newText: `${attribute.name}="$1"`
            },
            sortText: `${attribute.required ? '0' : '1'}${attribute.name}`
        }));
}

function openInterpolation(before: string): string | undefined {
    let index = before.lastIndexOf('${');
    while (index !== -1) {
        let backslashes = 0;
        for (let j = index - 1; j >= 0 && before[j] === '\\'; j--) backslashes++;
        if (backslashes % 2 === 0) {
            const inner = before.slice(index + 2);
            let depth = 0;
            let quote = '';
            for (const char of inner) {
                if (quote) {
                    if (char === quote) quote = '';
                } else if (char === '"' || char === "'") quote = char;
                else if (char === '{') depth++;
                else if (char === '}') {
                    if (depth === 0) return undefined;
                    depth--;
                }
            }
            return inner;
        }
        index = before.lastIndexOf('${', index - 1);
    }
    return undefined;
}

function insideString(source: string): boolean {
    let quote = '';
    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (quote) {
            if (char === '\\') index++;
            else if (char === quote) quote = '';
        } else if (char === '"' || char === "'") quote = char;
    }
    return quote !== '';
}

function expressionItems(
    analysis: Analysis,
    position: Position,
    expression: string,
    mode: 'body' | 'define' | 'condition'
): CompletionItem[] {
    if (insideString(expression)) return [];
    const word = /[A-Za-z_]\w*$/.exec(expression)?.[0] ?? '';
    const beforeWord = expression.slice(0, expression.length - word.length);
    const replace = { start: { line: position.line, character: position.character - word.length }, end: position };
    const all = analysis.define?.entries ?? [];
    const keysBefore = all.filter(
        entry =>
            entry.keyRange.start.line < position.line ||
            (entry.keyRange.start.line === position.line && entry.keyRange.end.character <= position.character)
    );
    const entries = mode === 'define' ? keysBefore.slice(0, -1) : all;
    const variable = (name: string, valueText: string): CompletionItem => ({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: valueText,
        textEdit: { range: replace, newText: name },
        sortText: `0${name}`
    });

    if (/this\.\s*$/.test(beforeWord)) {
        return mode === 'define' ? entries.map(entry => variable(entry.name, entry.valueText)) : [];
    }
    if (/\.\s*$/.test(beforeWord)) return [];

    const items: CompletionItem[] = [];
    if (mode === 'define') {
        for (const entry of entries) {
            items.push({ ...variable(`this.${entry.name}`, entry.valueText), filterText: `this.${entry.name}` });
        }
        items.push({
            label: 'this',
            kind: CompletionItemKind.Keyword,
            documentation: KEYWORD_DOCS.this,
            textEdit: { range: replace, newText: 'this.' },
            sortText: '1this'
        });
    } else if (mode === 'body' || analysis.define) {
        for (const entry of entries) items.push(variable(entry.name, entry.valueText));
    }
    if (mode === 'body' && beforeWord.trim() === '') {
        for (const keyword of ['if', 'elif', 'else', 'endif']) {
            items.push({
                label: keyword,
                kind: CompletionItemKind.Keyword,
                documentation: { kind: MarkupKind.Markdown, value: KEYWORD_DOCS[keyword] },
                insertTextFormat: InsertTextFormat.Snippet,
                textEdit: { range: replace, newText: keyword === 'if' || keyword === 'elif' ? `${keyword} $1` : keyword },
                sortText: `2${keyword}`
            });
        }
    }
    items.push({
        label: 'get',
        kind: CompletionItemKind.Function,
        detail: 'get(url, path)',
        documentation: { kind: MarkupKind.Markdown, value: KEYWORD_DOCS.get },
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: { range: replace, newText: "get('${1:https://}', '${2:.field}')" },
        sortText: '3get'
    });
    for (const literal of ['true', 'false', 'null']) {
        items.push({
            label: literal,
            kind: CompletionItemKind.Constant,
            textEdit: { range: replace, newText: literal },
            sortText: `4${literal}`
        });
    }
    return items;
}

export function complete(analysis: Analysis, position: Position): CompletionItem[] {
    const lineText = analysis.lines[position.line] ?? '';
    const before = lineText.slice(0, position.character);
    if (isInsideFence(analysis, position.line)) return [];
    if (analysis.frontmatter && position.line <= analysis.frontmatter.end) return [];

    if (isInsideDefine(analysis, position.line)) {
        const value = /^\s*[A-Za-z_]\w*\s*:(.*)$/.exec(before)?.[1] ?? (/^\s*[A-Za-z_]\w*$|^\s*$/.test(before) ? undefined : before);
        if (value === undefined) return [];
        return expressionItems(analysis, position, value.replace(/^.*,\s*[A-Za-z_]\w*\s*:/, ''), 'define');
    }

    const directive = DIRECTIVE_NAME_RE.exec(before);
    if (directive) return directiveItems(analysis, position, directive[3], directive[1].length);

    const tab = TAB_NAME_RE.exec(before);
    if (tab && enclosingDirective(analysis, position.line)?.spec?.kind === 'tabGroup') {
        const spec = directiveSpec('tab') as DirectiveSpec;
        return [
            {
                label: '::tab',
                kind: CompletionItemKind.Module,
                documentation: documentation(spec),
                insertTextFormat: InsertTextFormat.Snippet,
                textEdit: {
                    range: { start: { line: position.line, character: tab[1].length }, end: position },
                    newText: `::${spec.snippet}`
                }
            }
        ];
    }

    const condition = CONDITION_RE.exec(before);
    if (condition) return expressionItems(analysis, position, condition[2], 'condition');

    const interpolation = openInterpolation(before);
    if (interpolation !== undefined) return expressionItems(analysis, position, interpolation, 'body');

    const openLine = OPEN_LINE_RE.exec(before);
    if (openLine && !insideString(before)) {
        const isTab = openLine[2].length === 2;
        if (isTab && openLine[3].toLowerCase() !== 'tab') return [];
        return attributeItems(openLine[3], openLine[4], position, openLine[5]);
    }
    return [];
}
