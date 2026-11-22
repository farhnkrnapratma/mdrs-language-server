// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { type Hover, MarkupKind, type Position } from 'vscode-languageserver-types';
import type { Analysis } from './analyzer.js';
import { type DirectiveSpec, directiveSpec, KEYWORD_DOCS } from './directives.js';
import { attributeAt, contains, defineEntry, directiveOnLine, variableAt, wordAt } from './navigation.js';

export function directiveMarkdown(spec: DirectiveSpec): string {
    const prefix = spec.kind === 'tab' ? '::' : ':::';
    const parts = [`**${prefix}${spec.name}**`, spec.summary];
    if (spec.attributes.length) {
        parts.push(
            [
                '| Attribute | Required | Description |',
                '| --- | --- | --- |',
                ...spec.attributes.map(
                    attribute => `| \`${attribute.name}\` | ${attribute.required ? 'yes' : 'no'} | ${attribute.description} |`
                )
            ].join('\n')
        );
    }
    parts.push(`[Documentation](${spec.docs})`);
    return parts.join('\n\n');
}

export function hover(analysis: Analysis, position: Position): Hover | null {
    const node = directiveOnLine(analysis, position.line);
    if (node?.spec && contains(node.nameRange, position)) {
        return { contents: { kind: MarkupKind.Markdown, value: directiveMarkdown(node.spec) }, range: node.nameRange };
    }

    const attribute = attributeAt(analysis, position);
    if (attribute) {
        const spec = attribute.node.spec?.attributes.find(item => item.name === attribute.attribute.name);
        const value = spec
            ? `**${spec.name}** (${spec.required ? 'required' : 'optional'})\n\n${spec.description}`
            : `\`${attribute.attribute.name}\` is not an attribute of :::${attribute.node.name} and is ignored.`;
        return { contents: { kind: MarkupKind.Markdown, value }, range: attribute.attribute.nameRange };
    }

    const name = variableAt(analysis, position);
    if (name) {
        const entry = defineEntry(analysis, name);
        const value = entry
            ? `\`\`\`mdrs\n${entry.name}: ${entry.valueText}\n\`\`\`\n\nDefined in :::define on line ${entry.keyRange.start.line + 1}.`
            : `\`${name}\` is not defined in :::define.`;
        return { contents: { kind: MarkupKind.Markdown, value } };
    }

    const lineText = analysis.lines[position.line] ?? '';
    const conditional = /^ {0,3}:::(if|elif|else|endif)\b/.exec(lineText);
    const word = wordAt(lineText, position.character);
    if (conditional && word && word.word === conditional[1]) {
        const spec = directiveSpec(conditional[1]);
        if (spec) return { contents: { kind: MarkupKind.Markdown, value: directiveMarkdown(spec) } };
    }
    if (word && KEYWORD_DOCS[word.word] && lineText.slice(0, word.start).includes('${')) {
        return { contents: { kind: MarkupKind.Markdown, value: KEYWORD_DOCS[word.word] } };
    }
    if (word?.word === 'get' && lineText[word.end] === '(') {
        return { contents: { kind: MarkupKind.Markdown, value: KEYWORD_DOCS.get } };
    }
    if (word?.word === 'this' && lineText[word.end] === '.') {
        return { contents: { kind: MarkupKind.Markdown, value: KEYWORD_DOCS.this } };
    }
    return null;
}
