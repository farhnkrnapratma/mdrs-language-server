// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

export { type Analysis, analyze, type DefineEntry, type DirectiveNode, getPathProblem, getUrlProblem } from './analyzer.js';
export { complete } from './completion.js';
export { DIRECTIVES, type DirectiveSpec, directiveSpec } from './directives.js';
export { hover } from './hover.js';
export { definition, documentHighlights, documentSymbols, foldingRanges, references } from './structure.js';
export { VERSION } from './version.js';
