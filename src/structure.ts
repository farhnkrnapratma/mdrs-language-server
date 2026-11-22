// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import {
    type DocumentSymbol,
    type FoldingRange,
    FoldingRangeKind,
    type Location,
    type Position,
    type Range,
    SymbolKind
} from 'vscode-languageserver';
import type { Analysis, DirectiveNode } from './analyzer.js';
import { contains, defineEntry, variableAt } from './navigation.js';

function lineRange(analysis: Analysis, start: number, end: number): Range {
    return {
        start: { line: start, character: 0 },
        end: { line: end, character: analysis.lines[end]?.length ?? 0 }
    };
}

function directiveSymbol(analysis: Analysis, node: DirectiveNode): DocumentSymbol {
    const end = node.closeLine ?? node.line;
    const label = node.attributes.find(attribute => ['title', 'summary', 'label', 'key', 'url'].includes(attribute.name));
    return {
        name: `${node.spec?.kind === 'tab' ? '::' : ':::'}${node.name}${label ? ` ${label.value}` : ''}`,
        kind: node.spec?.kind === 'tab' ? SymbolKind.Field : SymbolKind.Module,
        range: lineRange(analysis, node.line, end),
        selectionRange: node.nameRange,
        children: node.children.map(child => directiveSymbol(analysis, child))
    };
}

export function documentSymbols(analysis: Analysis): DocumentSymbol[] {
    const roots: DocumentSymbol[] = [];
    const last = Math.max(analysis.lines.length - 1, 0);

    if (analysis.define) {
        const end = analysis.define.closeLine ?? analysis.define.openLine;
        roots.push({
            name: ':::define',
            kind: SymbolKind.Namespace,
            range: lineRange(analysis, analysis.define.openLine, end),
            selectionRange: lineRange(analysis, analysis.define.openLine, analysis.define.openLine),
            children: analysis.define.entries.map(entry => ({
                name: entry.name,
                detail: entry.valueText,
                kind: SymbolKind.Variable,
                range: { start: entry.keyRange.start, end: entry.valueRange.end },
                selectionRange: entry.keyRange
            }))
        });
    }

    const headings = analysis.headings.map((heading, index) => {
        const next = analysis.headings.slice(index + 1).find(item => item.level <= heading.level);
        const end = next ? Math.max(next.line - 1, heading.line) : last;
        const symbol: DocumentSymbol = {
            name: heading.text || '#'.repeat(heading.level),
            kind: SymbolKind.String,
            range: lineRange(analysis, heading.line, end),
            selectionRange: heading.range,
            children: []
        };
        return { heading, symbol, end };
    });

    const stack: { level: number; symbol: DocumentSymbol; end: number }[] = [];
    const items = [
        ...headings.map(item => ({ line: item.heading.line, kind: 'heading' as const, item })),
        ...analysis.directives.map(node => ({ line: node.line, kind: 'directive' as const, node }))
    ].sort((a, b) => a.line - b.line);

    for (const entry of items) {
        while (stack.length && stack[stack.length - 1].end < entry.line) stack.pop();
        if (entry.kind === 'heading') {
            while (stack.length && stack[stack.length - 1].level >= entry.item.heading.level) stack.pop();
            const parent = stack.at(-1);
            if (parent) parent.symbol.children?.push(entry.item.symbol);
            else roots.push(entry.item.symbol);
            stack.push({ level: entry.item.heading.level, symbol: entry.item.symbol, end: entry.item.end });
        } else {
            const symbol = directiveSymbol(analysis, entry.node);
            const parent = stack.at(-1);
            if (parent) parent.symbol.children?.push(symbol);
            else roots.push(symbol);
        }
    }
    return roots;
}

export function foldingRanges(analysis: Analysis): FoldingRange[] {
    const ranges: FoldingRange[] = [];
    const add = (start: number, end: number | undefined, kind?: string) => {
        if (end !== undefined && end > start) ranges.push({ startLine: start, endLine: end, ...(kind ? { kind } : {}) });
    };
    if (analysis.frontmatter) add(analysis.frontmatter.start, analysis.frontmatter.end, FoldingRangeKind.Region);
    if (analysis.define) add(analysis.define.openLine, analysis.define.closeLine, FoldingRangeKind.Region);
    const visit = (node: DirectiveNode) => {
        add(node.line, node.closeLine);
        for (const child of node.children) visit(child);
    };
    for (const node of analysis.directives) visit(node);
    for (const block of analysis.conditionals) {
        const branches = [...block.lines, ...(block.closeLine !== undefined ? [block.closeLine] : [])];
        for (let index = 0; index < branches.length - 1; index++) add(branches[index], branches[index + 1] - 1);
    }
    for (const fence of analysis.fences) add(fence.start, fence.end);
    const last = Math.max(analysis.lines.length - 1, 0);
    analysis.headings.forEach((heading, index) => {
        const next = analysis.headings.slice(index + 1).find(item => item.level <= heading.level);
        let end = next ? next.line - 1 : last;
        while (end > heading.line && analysis.lines[end].trim() === '') end--;
        add(heading.line, end);
    });
    return ranges;
}

export function definition(analysis: Analysis, uri: string, position: Position): Location | null {
    const name = variableAt(analysis, position);
    const entry = name ? defineEntry(analysis, name) : undefined;
    return entry ? { uri, range: entry.keyRange } : null;
}

export function references(analysis: Analysis, uri: string, position: Position, includeDeclaration: boolean): Location[] {
    const name = variableAt(analysis, position);
    if (!name) return [];
    const locations = analysis.variableRefs.filter(ref => ref.name === name).map(ref => ({ uri, range: ref.range }));
    const entry = defineEntry(analysis, name);
    if (includeDeclaration && entry) locations.unshift({ uri, range: entry.keyRange });
    return locations;
}

export function documentHighlights(analysis: Analysis, position: Position): Range[] {
    const name = variableAt(analysis, position);
    if (!name) return [];
    const entry = defineEntry(analysis, name);
    const ranges = analysis.variableRefs.filter(ref => ref.name === name).map(ref => ref.range);
    return entry && !ranges.some(item => contains(item, entry.keyRange.start)) ? [entry.keyRange, ...ranges] : ranges;
}
