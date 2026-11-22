// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import type { Position, Range } from 'vscode-languageserver';
import type { Analysis, AttributeNode, DefineEntry, DirectiveNode, VariableRef } from './analyzer.js';

export function contains(range: Range, position: Position): boolean {
    const afterStart =
        position.line > range.start.line ||
        (position.line === range.start.line && position.character >= range.start.character);
    const beforeEnd =
        position.line < range.end.line ||
        (position.line === range.end.line && position.character <= range.end.character);
    return afterStart && beforeEnd;
}

export function allDirectives(analysis: Analysis): DirectiveNode[] {
    const nodes: DirectiveNode[] = [];
    const visit = (node: DirectiveNode) => {
        nodes.push(node);
        for (const child of node.children) visit(child);
    };
    for (const node of analysis.directives) visit(node);
    return nodes;
}

export function enclosingDirective(analysis: Analysis, line: number): DirectiveNode | undefined {
    let found: DirectiveNode | undefined;
    for (const node of allDirectives(analysis)) {
        const end = node.closeLine ?? (node.spec?.kind === 'embed' ? node.line : analysis.lines.length);
        if (line > node.line && line < end) found = node;
    }
    return found;
}

export function directiveOnLine(analysis: Analysis, line: number): DirectiveNode | undefined {
    return allDirectives(analysis).find(node => node.line === line);
}

export function attributeAt(
    analysis: Analysis,
    position: Position
): { node: DirectiveNode; attribute: AttributeNode } | undefined {
    const node = directiveOnLine(analysis, position.line);
    const attribute = node?.attributes.find(item => contains(item.nameRange, position));
    return node && attribute ? { node, attribute } : undefined;
}

export function defineEntry(analysis: Analysis, name: string): DefineEntry | undefined {
    return analysis.define?.entries.find(entry => entry.name === name);
}

export function variableAt(analysis: Analysis, position: Position): string | undefined {
    const ref = analysis.variableRefs.find((item: VariableRef) => contains(item.range, position));
    if (ref) return ref.name;
    return analysis.define?.entries.find(entry => contains(entry.keyRange, position))?.name;
}

export function isInsideDefine(analysis: Analysis, line: number): boolean {
    const define = analysis.define;
    return Boolean(define && line > define.openLine && (define.closeLine === undefined || line < define.closeLine));
}

export function isInsideFence(analysis: Analysis, line: number): boolean {
    return analysis.fences.some(fence => line > fence.start && line < fence.end);
}

export function wordAt(text: string, character: number): { word: string; start: number; end: number } | undefined {
    let start = character;
    let end = character;
    while (start > 0 && /[\w-]/.test(text[start - 1])) start--;
    while (end < text.length && /[\w-]/.test(text[end])) end++;
    return start === end ? undefined : { word: text.slice(start, end), start, end };
}
