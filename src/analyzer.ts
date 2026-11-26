// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { load as loadYaml, YAMLException } from 'js-yaml';
import { type Diagnostic, DiagnosticSeverity, type Range } from 'vscode-languageserver-types';
import { type DirectiveSpec, directiveSpec } from './directives.js';
import type { Expr } from './expr/ast.js';
import { DefineError } from './expr/errors.js';
import { isValidIdentifierName } from './expr/identifiers.js';
import { findExpressionEnd, type Token, tokenize } from './expr/lexer.js';
import { Parser } from './expr/parser.js';

export const MAX_DEPTH = 16;
export const MAX_INLINE_DEPTH = 8;
const SOURCE = 'mdrs';

export interface AttributeNode {
    name: string;
    value: string;
    nameRange: Range;
    valueRange: Range;
}

export interface DirectiveNode {
    name: string;
    spec: DirectiveSpec | undefined;
    line: number;
    colons: number;
    nameRange: Range;
    attributes: AttributeNode[];
    closeLine?: number;
    children: DirectiveNode[];
}

export interface DefineEntry {
    name: string;
    keyRange: Range;
    valueText: string;
    valueRange: Range;
}

export interface DefineBlock {
    openLine: number;
    closeLine?: number;
    entries: DefineEntry[];
}

export interface ConditionalBlock {
    lines: number[];
    closeLine?: number;
}

export interface Heading {
    level: number;
    text: string;
    line: number;
    range: Range;
}

export interface VariableRef {
    name: string;
    range: Range;
}

export interface Analysis {
    lines: string[];
    frontmatter?: { start: number; end: number };
    define?: DefineBlock;
    directives: DirectiveNode[];
    conditionals: ConditionalBlock[];
    headings: Heading[];
    fences: { start: number; end: number }[];
    variableRefs: VariableRef[];
    diagnostics: Diagnostic[];
}

const PREFIX = '^( {0,3}(?:> ?)*)';
const OPEN_RE = new RegExp(`${PREFIX}(:{3,})([A-Za-z][A-Za-z-]*)(.*)$`);
const TAB_RE = new RegExp(`${PREFIX}::([A-Za-z][A-Za-z-]*)(.*)$`);
const CLOSE_RE = new RegExp(`${PREFIX}(:{2,})[ \\t]*$`);
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+/;
const ATTR_RE = /([A-Za-z][\w-]*)="((?:[^"\\]|\\.)*)"/g;
const INLINE_KEYWORD_RE = /^(\s*)(if|elif|else|endif)\b(.*)$/s;

function range(line: number, start: number, end: number): Range {
    return { start: { line, character: start }, end: { line, character: end } };
}

function isBlank(char: string | undefined): boolean {
    return char === ' ' || char === '\t';
}

function headingText(rest: string): string {
    let end = rest.length;
    while (end > 0 && isBlank(rest[end - 1])) end--;
    let hashes = end;
    while (hashes > 0 && rest[hashes - 1] === '#') hashes--;
    if (hashes < end && (hashes === 0 || isBlank(rest[hashes - 1]))) {
        end = hashes;
        while (end > 0 && isBlank(rest[end - 1])) end--;
    }
    return rest.slice(0, end);
}

function maskCodeSpans(text: string): string {
    return text.replace(/(`+)[\s\S]*?\1/g, match => ' '.repeat(match.length));
}

interface Scope {
    inDefine: boolean;
    defined: Set<string>;
    hasDefine: boolean;
}

export function analyze(text: string): Analysis {
    const lines = text.split(/\r?\n/);
    const diagnostics: Diagnostic[] = [];
    const report = (r: Range, message: string, severity: DiagnosticSeverity) =>
        diagnostics.push({ range: r, message, severity, source: SOURCE });
    const result: Analysis = {
        lines,
        directives: [],
        conditionals: [],
        headings: [],
        fences: [],
        variableRefs: [],
        diagnostics
    };

    let body = 0;
    if (/^---[ \t]*$/.test(lines[0] ?? '')) {
        const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
        if (end > 0) {
            result.frontmatter = { start: 0, end };
            checkFrontmatter(lines.slice(1, end).join('\n'), report);
            body = end + 1;
        }
    }
    let firstContent = body;
    while (firstContent < lines.length && lines[firstContent].trim() === '') firstContent++;

    const defineLine = lines[firstContent] !== undefined ? OPEN_RE.exec(lines[firstContent]) : null;
    const hasDefine = defineLine !== null && defineLine[3].toLowerCase() === 'define' && defineLine[1] === '';
    const scope: Scope = { inDefine: false, defined: new Set(), hasDefine };

    const stack: DirectiveNode[] = [];
    const conditionalStack: { block: ConditionalBlock; sawElse: boolean; text: string }[] = [];
    const inlineStack: { range: Range; sawElse: boolean; text: string }[] = [];
    let fence: { char: string; length: number; start: number } | undefined;
    let verbatim: { colons: number; line: number } | undefined;
    let math: DirectiveNode | undefined;
    let referencesCount = 0;

    const attach = (node: DirectiveNode) => {
        const parent = stack.at(-1);
        if (parent) parent.children.push(node);
        else result.directives.push(node);
    };

    for (let line = body; line < lines.length; line++) {
        const source = lines[line];

        if (fence) {
            const close = FENCE_RE.exec(source);
            if (close && close[2][0] === fence.char && close[2].length >= fence.length && close[3].trim() === '') {
                result.fences.push({ start: fence.start, end: line });
                fence = undefined;
            }
            continue;
        }

        if (verbatim) {
            const close = CLOSE_RE.exec(source);
            if (close && close[1] === '' && close[2].length === verbatim.colons) verbatim = undefined;
            continue;
        }

        if (result.define && result.define.closeLine === undefined) {
            if (CLOSE_RE.test(source) && CLOSE_RE.exec(source)?.[2].length === 3) {
                result.define.closeLine = line;
                checkDefineBlock(result, scope, report);
            }
            continue;
        }

        if (math) {
            const close = CLOSE_RE.exec(source);
            if (close && close[2].length >= 3) {
                math.closeLine = line;
                stack.pop();
                math = undefined;
            } else scanInterpolations(source, line, scope, result, inlineStack, report);
            continue;
        }

        const fenceOpen = FENCE_RE.exec(source);
        if (fenceOpen && !(fenceOpen[2][0] === '`' && fenceOpen[3].includes('`'))) {
            fence = { char: fenceOpen[2][0], length: fenceOpen[2].length, start: line };
            continue;
        }

        const open = OPEN_RE.exec(source);
        if (open) {
            const [, prefix, colons, rawName, rest] = open;
            const name = rawName.toLowerCase();
            const nameStart = prefix.length + colons.length;
            const nameRange = range(line, prefix.length, nameStart + rawName.length);
            const spec = directiveSpec(name);

            if (name === 'define') {
                if (line === firstContent && prefix === '' && !result.define) {
                    result.define = { openLine: line, entries: [] };
                    continue;
                }
                report(
                    nameRange,
                    'Only one :::define block is allowed, and it must be the first thing in the document.',
                    DiagnosticSeverity.Error
                );
                continue;
            }

            if (spec?.kind === 'conditional') {
                if (prefix.includes('>')) {
                    report(
                        nameRange,
                        `:::${name} inside a blockquote is plain text; put the conditional around the whole blockquote.`,
                        DiagnosticSeverity.Warning
                    );
                    continue;
                }
                handleConditional(name, rest, line, nameStart + rawName.length, nameRange, scope, result, conditionalStack, report);
                continue;
            }

            if (name === 'verbatim') {
                if (rest.trim() !== '') {
                    report(nameRange, ':::verbatim takes no attributes.', DiagnosticSeverity.Warning);
                }
                verbatim = { colons: colons.length, line };
                continue;
            }

            const attributes = parseAttributes(rest, line, nameStart + rawName.length, report);
            scanInterpolations(source, line, scope, result, inlineStack, report);
            const node: DirectiveNode = {
                name,
                spec,
                line,
                colons: colons.length,
                nameRange,
                attributes,
                children: []
            };

            if (!spec) {
                report(nameRange, `Unknown directive ':::${rawName}'. It renders as plain text.`, DiagnosticSeverity.Warning);
            } else {
                checkAttributes(node, report);
                if (spec.kind === 'tab') {
                    report(nameRange, '::tab takes two colons and must sit inside :::tabs or :::snippets.', DiagnosticSeverity.Error);
                    continue;
                }
                if (spec.kind === 'embed') {
                    checkEmbed(node, report);
                    attach(node);
                    continue;
                }
                if (spec.kind === 'references') {
                    referencesCount++;
                    if (referencesCount > 1)
                        report(nameRange, 'Use at most one :::references block per document.', DiagnosticSeverity.Error);
                    if (rest.trim() !== '')
                        report(nameRange, 'The opening line is exactly :::references, without attributes.', DiagnosticSeverity.Error);
                }
            }

            if (stack.length >= MAX_DEPTH) {
                report(nameRange, `Directives nest at most ${MAX_DEPTH} levels deep; this line is plain text.`, DiagnosticSeverity.Warning);
                continue;
            }
            attach(node);
            stack.push(node);
            if (spec?.kind === 'math') math = node;
            continue;
        }

        const tab = TAB_RE.exec(source);
        if (tab && tab[2].toLowerCase() === 'tab') {
            const [, prefix, rawName, rest] = tab;
            const nameStart = prefix.length + 2;
            const nameRange = range(line, prefix.length, nameStart + rawName.length);
            const parent = stack.at(-1);
            const attributes = parseAttributes(rest, line, nameStart + rawName.length, report);
            const node: DirectiveNode = {
                name: 'tab',
                spec: directiveSpec('tab'),
                line,
                colons: 2,
                nameRange,
                attributes,
                children: []
            };
            if (parent?.spec?.kind !== 'tabGroup') {
                report(nameRange, '::tab must sit directly inside :::tabs or :::snippets.', DiagnosticSeverity.Error);
                continue;
            }
            if (!attributes.some(attribute => attribute.name === 'label')) {
                report(nameRange, `Every ::tab in :::${parent.name} requires label="..."`, DiagnosticSeverity.Error);
            }
            checkUnknownAttributes(node, report);
            scanInterpolations(source, line, scope, result, inlineStack, report);
            attach(node);
            stack.push(node);
            continue;
        }

        const close = CLOSE_RE.exec(source);
        if (close) {
            const colons = close[2].length;
            const closeRange = range(line, close[1].length, close[1].length + colons);
            const top = stack.at(-1);
            if (colons === 2) {
                if (top?.spec?.kind === 'tab') {
                    top.closeLine = line;
                    stack.pop();
                } else {
                    report(closeRange, '`::` has no open ::tab to close. It renders as plain text.', DiagnosticSeverity.Warning);
                }
                continue;
            }
            if (!top) {
                report(closeRange, '`:::` has no open block to close. It renders as plain text.', DiagnosticSeverity.Warning);
                continue;
            }
            if (top.spec?.kind === 'tab') {
                report(top.nameRange, '::tab is never closed with `::`.', DiagnosticSeverity.Error);
                stack.pop();
                const group = stack.at(-1);
                if (group) closeNode(group, line, stack, report);
                continue;
            }
            closeNode(top, line, stack, report);
            continue;
        }

        const heading = HEADING_RE.exec(source);
        if (heading) {
            result.headings.push({
                level: heading[1].length,
                text: headingText(source.slice(heading[0].length)),
                line,
                range: range(line, 0, source.length)
            });
        }
        scanInterpolations(source, line, scope, result, inlineStack, report);
    }

    if (result.define && result.define.closeLine === undefined) {
        report(
            range(result.define.openLine, 0, lines[result.define.openLine].length),
            ':::define is never closed with `:::`.',
            DiagnosticSeverity.Error
        );
    }
    if (verbatim) {
        report(
            range(verbatim.line, 0, lines[verbatim.line].length),
            `:::verbatim is never closed with ${':'.repeat(verbatim.colons)}.`,
            DiagnosticSeverity.Error
        );
    }
    for (const node of stack) {
        report(
            node.nameRange,
            `:::${node.name} is never closed${node.spec?.kind === 'tab' ? ' with `::`' : ' with `:::`'}. It renders as plain text from here on.`,
            DiagnosticSeverity.Error
        );
    }
    for (const open of conditionalStack) {
        report(
            range(open.block.lines[0], 0, lines[open.block.lines[0]].length),
            `':::if ${open.text}' is never closed with :::endif`,
            DiagnosticSeverity.Error
        );
    }
    for (const open of inlineStack) {
        report(open.range, `'\${if ${open.text}}' is never closed with \${endif}`, DiagnosticSeverity.Error);
    }
    return result;
}

function closeNode(node: DirectiveNode, line: number, stack: DirectiveNode[], report: Reporter) {
    node.closeLine = line;
    stack.pop();
    if (node.spec?.kind === 'tabGroup' && !node.children.some(child => child.spec?.kind === 'tab')) {
        report(node.nameRange, `:::${node.name} requires at least one ::tab`, DiagnosticSeverity.Error);
    }
}

type Reporter = (r: Range, message: string, severity: DiagnosticSeverity) => void;

function checkFrontmatter(yaml: string, report: Reporter) {
    try {
        loadYaml(yaml);
    } catch (error) {
        if (error instanceof YAMLException) {
            const line = (error.mark?.line ?? 0) + 1;
            const column = error.mark?.column ?? 0;
            report(range(line, column, column + 1), `Invalid frontmatter YAML: ${error.reason}`, DiagnosticSeverity.Error);
        }
    }
}

function parseAttributes(rest: string, line: number, offset: number, report: Reporter): AttributeNode[] {
    const attributes: AttributeNode[] = [];
    let leftover = rest;
    for (const match of rest.matchAll(ATTR_RE)) {
        const start = offset + (match.index ?? 0);
        const valueStart = start + match[1].length + 2;
        attributes.push({
            name: match[1].toLowerCase(),
            value: match[2].replace(/\\(["\\])/g, '$1'),
            nameRange: range(line, start, start + match[1].length),
            valueRange: range(line, valueStart, valueStart + match[2].length)
        });
        leftover = leftover.replace(match[0], ' '.repeat(match[0].length));
    }
    for (const stray of leftover.matchAll(/\S+/g)) {
        const start = offset + (stray.index ?? 0);
        report(
            range(line, start, start + stray[0].length),
            `'${stray[0]}' is not a key="value" attribute and is ignored. Values need double quotes.`,
            DiagnosticSeverity.Warning
        );
    }
    return attributes;
}

function checkUnknownAttributes(node: DirectiveNode, report: Reporter) {
    const known = new Set(node.spec?.attributes.map(attribute => attribute.name));
    const seen = new Set<string>();
    for (const attribute of node.attributes) {
        if (!known.has(attribute.name)) {
            report(attribute.nameRange, `:::${node.name} has no '${attribute.name}' attribute; it is ignored.`, DiagnosticSeverity.Warning);
        } else if (seen.has(attribute.name)) {
            report(attribute.nameRange, `'${attribute.name}' is set more than once.`, DiagnosticSeverity.Warning);
        }
        seen.add(attribute.name);
    }
}

function checkAttributes(node: DirectiveNode, report: Reporter) {
    for (const spec of node.spec?.attributes ?? []) {
        if (spec.required && !node.attributes.some(attribute => attribute.name === spec.name)) {
            report(node.nameRange, `:::${node.name} requires ${spec.name}="..."`, DiagnosticSeverity.Error);
        }
    }
    checkUnknownAttributes(node, report);
}

function checkEmbed(node: DirectiveNode, report: Reporter) {
    const url = node.attributes.find(attribute => attribute.name === 'url');
    if (url && !/^https?:\/\//i.test(url.value)) {
        report(
            url.valueRange,
            'The embed URL must start with http:// or https://; otherwise it renders as plain text.',
            DiagnosticSeverity.Warning
        );
    }
}

function handleConditional(
    name: string,
    rest: string,
    line: number,
    offset: number,
    nameRange: Range,
    scope: Scope,
    result: Analysis,
    stack: { block: ConditionalBlock; sawElse: boolean; text: string }[],
    report: Reporter
) {
    const top = stack.at(-1);
    if (name === 'if') {
        if (stack.length >= MAX_DEPTH) {
            report(nameRange, `:::if nests at most ${MAX_DEPTH} levels deep.`, DiagnosticSeverity.Error);
        }
        const block: ConditionalBlock = { lines: [line] };
        result.conditionals.push(block);
        stack.push({ block, sawElse: false, text: rest.trim() });
        checkCondition(rest, line, offset, nameRange, scope, result, report);
        return;
    }
    if (!top || (top.sawElse && name !== 'endif')) {
        report(nameRange, `':::${name}' has no matching :::if`, DiagnosticSeverity.Error);
        return;
    }
    if (name === 'elif') {
        top.block.lines.push(line);
        checkCondition(rest, line, offset, nameRange, scope, result, report);
        return;
    }
    if (rest.trim() !== '') {
        report(nameRange, `:::${name} takes nothing after it.`, DiagnosticSeverity.Warning);
    }
    if (name === 'else') {
        top.sawElse = true;
        top.block.lines.push(line);
        return;
    }
    top.block.closeLine = line;
    stack.pop();
}

function checkCondition(rest: string, line: number, offset: number, nameRange: Range, scope: Scope, result: Analysis, report: Reporter) {
    if (rest.trim() === '') {
        report(nameRange, 'Expected a condition after the keyword.', DiagnosticSeverity.Error);
        return;
    }
    checkExpression(rest, line, offset, { ...scope, inDefine: false }, result, report, true);
}

function checkExpression(
    source: string,
    line: number,
    offset: number,
    scope: Scope,
    result: Analysis,
    report: Reporter,
    blockCondition = false
): void {
    const whole = range(line, offset, offset + source.length);
    let tokens: Token[];
    let expr: Expr;
    try {
        tokens = tokenize(source);
        expr = new Parser(tokens).parseCompleteExpression();
    } catch (error) {
        if (error instanceof DefineError) report(errorRange(error, line, offset, whole), error.message, DiagnosticSeverity.Error);
        return;
    }
    const at = (pos: number, length: number) => range(line, offset + pos, offset + pos + length);
    collectRefs(tokens, at, scope, result, report, blockCondition);
    walk(expr, node => checkGet(node, whole, report));
}

function errorRange(error: DefineError, line: number, offset: number, fallback: Range): Range {
    const position = /at position (\d+)/.exec(error.message);
    if (!position) return fallback;
    const start = offset + Number(position[1]);
    return range(line, start, start + 1);
}

function collectRefs(
    tokens: Token[],
    at: (pos: number, length: number) => Range,
    scope: Scope,
    result: Analysis,
    report: Reporter,
    blockCondition: boolean
) {
    let braces = 0;
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.type === 'LBRACE') braces++;
        if (token.type === 'RBRACE') braces--;
        if (token.type !== 'IDENT') continue;
        const previous = tokens[index - 1];
        const next = tokens[index + 1];
        if (previous?.type === 'DOT' || next?.type === 'LPAREN' || token.value === 'null') continue;
        if (braces > 0 && next?.type === 'COLON' && (previous?.type === 'LBRACE' || previous?.type === 'COMMA')) continue;
        if (token.value === 'this') {
            const thisRange = at(token.pos, 4);
            if (!scope.inDefine) {
                report(thisRange, 'this.* is only valid inside a :::define block', DiagnosticSeverity.Error);
                continue;
            }
            const member = next?.type === 'DOT' ? tokens[index + 2] : undefined;
            if (member?.type === 'IDENT') {
                const memberRange = at(member.pos, member.value.length);
                result.variableRefs.push({ name: member.value, range: memberRange });
                if (!scope.defined.has(member.value)) {
                    report(memberRange, `'${member.value}' is undefined, or referenced before it was defined`, DiagnosticSeverity.Error);
                }
            }
            continue;
        }
        const tokenRange = at(token.pos, token.value.length);
        if (scope.inDefine) {
            report(tokenRange, `'${token.value}' is not valid here — use this.${token.value} inside :::define`, DiagnosticSeverity.Error);
            continue;
        }
        result.variableRefs.push({ name: token.value, range: tokenRange });
        if (!scope.defined.has(token.value)) {
            const hint = blockCondition && !scope.hasDefine ? ' (block conditionals without a :::define block can only use get())' : '';
            report(tokenRange, `'${token.value}' is undefined${hint}`, DiagnosticSeverity.Error);
        }
    }
}

function walk(expr: Expr, visit: (node: Expr) => void) {
    visit(expr);
    switch (expr.kind) {
        case 'get':
            walk(expr.url, visit);
            walk(expr.path, visit);
            break;
        case 'array':
            for (const item of expr.items) walk(item, visit);
            break;
        case 'object':
            for (const entry of expr.entries) walk(entry.value, visit);
            break;
        case 'unary':
            walk(expr.operand, visit);
            break;
        case 'binary':
            walk(expr.left, visit);
            walk(expr.right, visit);
            break;
        case 'ternary':
            walk(expr.test, visit);
            walk(expr.consequent, visit);
            walk(expr.alternate, visit);
            break;
        case 'template':
            for (const part of expr.parts) if (part.kind === 'expression') walk(part.expr, visit);
            break;
        default:
            break;
    }
}

export function getUrlProblem(value: string): string | undefined {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return `get() needs an absolute URL, got '${value}'.`;
    }
    if (url.protocol !== 'https:') return 'get() only fetches https:// URLs.';
    if (url.username || url.password) return 'get() URLs cannot carry a username or password.';
    return undefined;
}

export function getPathProblem(value: string): string | undefined {
    if (!value.startsWith('.') || value === '.') {
        return `get() paths start with a dot and name a field, such as '.name' (got '${value}').`;
    }
    const rest = value.slice(1);
    if (!/^(?:[A-Za-z_$][\w$-]*|\[\d+\]|\["(?:[^"\\]|\\.)*"\])(?:\.[A-Za-z_$][\w$-]*|\[\d+\]|\["(?:[^"\\]|\\.)*"\])*$/.test(rest)) {
        return `'${value}' is not a valid jq-style path. Use .name, .items[0] or .["odd-key"].`;
    }
    return undefined;
}

function checkGet(node: Expr, whole: Range, report: Reporter) {
    if (node.kind !== 'get') return;
    if (node.url.kind === 'string') {
        const problem = getUrlProblem(node.url.value);
        if (problem) report(whole, problem, DiagnosticSeverity.Error);
    }
    if (node.path.kind === 'string') {
        const problem = getPathProblem(node.path.value);
        if (problem) report(whole, problem, DiagnosticSeverity.Error);
    }
}

function scanInterpolations(
    source: string,
    line: number,
    scope: Scope,
    result: Analysis,
    inlineStack: { range: Range; sawElse: boolean; text: string }[],
    report: Reporter
) {
    const text = maskCodeSpans(source);
    let index = text.indexOf('${');
    while (index !== -1) {
        let backslashes = 0;
        for (let j = index - 1; j >= 0 && text[j] === '\\'; j--) backslashes++;
        if (backslashes % 2 === 1) {
            index = text.indexOf('${', index + 2);
            continue;
        }
        const end = findExpressionEnd(text, index + 1);
        if (end === -1) {
            if (scope.hasDefine) report(range(line, index, source.length), 'This ${ is never closed with }.', DiagnosticSeverity.Error);
            return;
        }
        const whole = range(line, index, end + 1);
        const inner = source.slice(index + 2, end);
        if (!scope.hasDefine) {
            report(
                whole,
                'Interpolation only works in a document that starts with a :::define block; this renders as written.',
                DiagnosticSeverity.Hint
            );
        } else {
            checkInterpolation(inner, line, index + 2, whole, scope, result, inlineStack, report);
        }
        index = text.indexOf('${', end + 1);
    }
}

function checkInterpolation(
    inner: string,
    line: number,
    offset: number,
    whole: Range,
    scope: Scope,
    result: Analysis,
    inlineStack: { range: Range; sawElse: boolean; text: string }[],
    report: Reporter
) {
    const keyword = INLINE_KEYWORD_RE.exec(inner);
    const bodyScope = { ...scope, inDefine: false };
    if (!keyword) {
        if (inner.trim() === '') {
            report(whole, 'Empty ${}.', DiagnosticSeverity.Error);
            return;
        }
        checkExpression(inner, line, offset, bodyScope, result, report);
        return;
    }
    const [, lead, word, rest] = keyword;
    const top = inlineStack.at(-1);
    const restOffset = offset + lead.length + word.length;
    if (word === 'if') {
        if (inlineStack.length >= MAX_INLINE_DEPTH) report(whole, '${if} is nested more than 8 levels deep', DiagnosticSeverity.Error);
        inlineStack.push({ range: whole, sawElse: false, text: rest.trim() });
        if (rest.trim() === '') report(whole, 'Expected a condition after ${if.', DiagnosticSeverity.Error);
        else checkExpression(rest, line, restOffset, bodyScope, result, report);
        return;
    }
    if (!top || (top.sawElse && word !== 'endif')) {
        report(whole, `\${${word}} has no matching \${if}`, DiagnosticSeverity.Error);
        return;
    }
    if (word === 'elif') {
        if (rest.trim() === '') report(whole, 'Expected a condition after ${elif.', DiagnosticSeverity.Error);
        else checkExpression(rest, line, restOffset, bodyScope, result, report);
        return;
    }
    if (rest.trim() !== '') report(whole, `\${${word}} takes nothing after it.`, DiagnosticSeverity.Error);
    if (word === 'else') top.sawElse = true;
    else inlineStack.pop();
}

function checkDefineBlock(result: Analysis, scope: Scope, report: Reporter) {
    const define = result.define;
    if (!define || define.closeLine === undefined) return;
    const startLine = define.openLine + 1;
    const bodyLines = result.lines.slice(startLine, define.closeLine);
    const bodyText = bodyLines.join('\n');
    const lineStarts: number[] = [];
    let total = 0;
    for (const bodyLine of bodyLines) {
        lineStarts.push(total);
        total += bodyLine.length + 1;
    }
    const position = (offset: number) => {
        let index = lineStarts.length - 1;
        while (index > 0 && lineStarts[index] > offset) index--;
        return { line: startLine + Math.max(index, 0), character: offset - (lineStarts[index] ?? 0) };
    };
    const span = (from: number, to: number): Range => ({ start: position(from), end: position(to) });
    const openRange = range(define.openLine, 0, result.lines[define.openLine].length);

    let tokens: Token[];
    try {
        tokens = tokenize(bodyText);
    } catch (error) {
        if (error instanceof DefineError) {
            const at = /at position (\d+)/.exec(error.message);
            report(at ? span(Number(at[1]), Number(at[1]) + 1) : openRange, error.message, DiagnosticSeverity.Error);
        }
        return;
    }

    const starts: number[] = [];
    let depth = 0;
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.type === 'LBRACE' || token.type === 'LBRACKET' || token.type === 'LPAREN') depth++;
        if (token.type === 'RBRACE' || token.type === 'RBRACKET' || token.type === 'RPAREN') depth--;
        const previous = tokens[index - 1];
        if (
            depth === 0 &&
            token.type === 'IDENT' &&
            tokens[index + 1]?.type === 'COLON' &&
            (!previous || previous.type === 'NEWLINE' || previous.type === 'COMMA')
        ) {
            starts.push(index);
        }
    }

    if (starts.length === 0) {
        report(openRange, 'A :::define block needs at least one entry.', DiagnosticSeverity.Error);
        return;
    }

    let assignments: { key: string; value: Expr }[] | undefined;
    try {
        assignments = new Parser(tokens).parseDefineBlock();
    } catch (error) {
        if (error instanceof DefineError) {
            const at = /at position (\d+)/.exec(error.message);
            report(at ? span(Number(at[1]), Number(at[1]) + 1) : openRange, error.message, DiagnosticSeverity.Error);
        }
    }

    const defineScope = { ...scope, inDefine: true };
    for (let n = 0; n < starts.length; n++) {
        const keyToken = tokens[starts[n]];
        let endIndex = n + 1 < starts.length ? starts[n + 1] - 1 : tokens.length - 1;
        while (endIndex > starts[n] + 1 && ['NEWLINE', 'COMMA', 'EOF'].includes(tokens[endIndex].type)) endIndex--;
        const valueTokens = tokens.slice(starts[n] + 2, endIndex + 1).filter(token => token.type !== 'EOF');
        const valueFrom = valueTokens[0]?.pos ?? keyToken.pos + keyToken.value.length;
        const last = valueTokens.at(-1);
        const valueEnd = last ? tokenEnd(bodyText, last) : valueFrom;
        const keyRange = span(keyToken.pos, keyToken.pos + keyToken.value.length);
        const entry: DefineEntry = {
            name: keyToken.value,
            keyRange,
            valueText: bodyText.slice(valueFrom, valueEnd).trim(),
            valueRange: span(valueFrom, valueEnd)
        };
        if (!isValidIdentifierName(keyToken.value)) {
            report(
                keyRange,
                `'${keyToken.value}' is not a valid variable name (check reserved words / naming rules)`,
                DiagnosticSeverity.Error
            );
        } else if (defineScope.defined.has(keyToken.value)) {
            report(keyRange, `'${keyToken.value}' is already defined`, DiagnosticSeverity.Error);
        }
        collectRefs(valueTokens, (pos, length) => span(pos, pos + length), defineScope, result, report, false);
        const value = assignments?.[n]?.value;
        if (value) walk(value, node => checkGet(node, entry.valueRange, report));
        define.entries.push(entry);
        if (isValidIdentifierName(keyToken.value)) defineScope.defined.add(keyToken.value);
    }
}

function tokenEnd(source: string, token: Token): number {
    const quote = source[token.pos];
    if (token.type === 'STRING' && (quote === '"' || quote === "'")) {
        let index = token.pos + 1;
        while (index < source.length && source[index] !== quote) index += source[index] === '\\' ? 2 : 1;
        return Math.min(index + 1, source.length);
    }
    return token.pos + Math.max(token.value.length, 1);
}
