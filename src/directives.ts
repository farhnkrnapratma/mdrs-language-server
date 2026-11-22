// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

export interface AttributeSpec {
    name: string;
    required: boolean;
    description: string;
}

export type DirectiveKind =
    | 'container'
    | 'tabGroup'
    | 'tab'
    | 'embed'
    | 'math'
    | 'references'
    | 'define'
    | 'conditional'
    | 'verbatim';

export interface DirectiveSpec {
    name: string;
    kind: DirectiveKind;
    summary: string;
    attributes: AttributeSpec[];
    snippet: string;
    docs: string;
}

const DOCS = 'https://github.com/farhnkrnapratma/idstead/blob/main/docs/008-mdrs/002-extensions';

const ICON: AttributeSpec = {
    name: 'icon',
    required: false,
    description:
        'A Lucide or Bootstrap Icons name in kebab-case. `rocket` prefers Lucide, `lucide-rocket` forces Lucide and `bi-github` forces Bootstrap Icons.'
};

function callout(name: string, label: string, icon: string): DirectiveSpec {
    return {
        name,
        kind: 'container',
        summary: `A "${label}" callout with the \`${icon}\` icon. The body is regular Markdown.`,
        attributes: [],
        snippet: `${name}\n$0\n:::`,
        docs: `${DOCS}/003-callouts.md`
    };
}

export const DIRECTIVES: DirectiveSpec[] = [
    callout('note', 'Note', 'info'),
    callout('tip', 'Tip', 'lightbulb'),
    callout('important', 'Important', 'message-square-warning'),
    callout('warning', 'Warning', 'alert-triangle'),
    callout('caution', 'Caution', 'circle-alert'),
    {
        name: 'callout',
        kind: 'container',
        summary: 'A callout with your own title and icon.',
        attributes: [
            { name: 'title', required: true, description: 'The callout heading.' },
            ICON
        ],
        snippet: 'callout title="${1:Title}"\n$0\n:::',
        docs: `${DOCS}/003-callouts.md`
    },
    {
        name: 'details',
        kind: 'container',
        summary: 'A collapsible section. The summary is the clickable title.',
        attributes: [
            { name: 'summary', required: true, description: 'The clickable title of the section.' }
        ],
        snippet: 'details summary="${1:Summary}"\n$0\n:::',
        docs: `${DOCS}/004-details.md`
    },
    {
        name: 'tabs',
        kind: 'tabGroup',
        summary: 'A tab group. Each `::tab` … `::` inside it is one tab.',
        attributes: [],
        snippet: 'tabs\n::tab label="${1:First}"\n$0\n::\n:::',
        docs: `${DOCS}/005-tabs-and-snippets.md`
    },
    {
        name: 'snippets',
        kind: 'tabGroup',
        summary:
            'A tab group for code samples. Groups that share a `key` switch together when a reader picks a tab.',
        attributes: [
            {
                name: 'key',
                required: false,
                description: 'Groups with the same key keep the same tab selected across the page.'
            }
        ],
        snippet: 'snippets key="${1:package-manager}"\n::tab label="${2:npm}"\n$0\n::\n:::',
        docs: `${DOCS}/005-tabs-and-snippets.md`
    },
    {
        name: 'tab',
        kind: 'tab',
        summary: 'One tab inside `:::tabs` or `:::snippets`, closed by a bare `::`.',
        attributes: [{ name: 'label', required: true, description: 'The tab label.' }, ICON],
        snippet: 'tab label="${1:Label}"\n$0\n::',
        docs: `${DOCS}/005-tabs-and-snippets.md`
    },
    {
        name: 'steps',
        kind: 'container',
        summary:
            'A numbered timeline. Write a list, or use `##`–`####` headings when a step needs several paragraphs.',
        attributes: [],
        snippet: 'steps\n1. $0\n:::',
        docs: `${DOCS}/006-steps.md`
    },
    {
        name: 'embed',
        kind: 'embed',
        summary:
            'A single line that embeds a YouTube video or a CodePen in a 16:9 frame. It has no body and no closing `:::`. Other http(s) URLs become a plain link.',
        attributes: [{ name: 'url', required: true, description: 'The YouTube or CodePen URL.' }],
        snippet: 'embed url="${1:https://youtu.be/}"',
        docs: `${DOCS}/009-media-and-embeds.md`
    },
    {
        name: 'math',
        kind: 'math',
        summary: 'A display formula typeset by KaTeX. The body is LaTeX.',
        attributes: [],
        snippet: 'math\n$0\n:::',
        docs: `${DOCS}/010-math.md`
    },
    {
        name: 'references',
        kind: 'references',
        summary:
            'The bibliography for the document footnotes. Use at most one, without attributes, and leave a blank line before the closing `:::`.',
        attributes: [],
        snippet: 'references\n[^${1:1}]: $0\n\n:::',
        docs: `${DOCS}/012-references.md`
    },
    {
        name: 'define',
        kind: 'define',
        summary:
            'Document variables, one `name: expression` per line or separated by commas. It must be the first thing in the document (after frontmatter) and switches on `${…}` interpolation.',
        attributes: [],
        snippet: 'define\n${1:name}: ${2:"value"}\n:::',
        docs: `${DOCS}/013-variables.md`
    },
    {
        name: 'if',
        kind: 'conditional',
        summary:
            'Renders the following lines when the condition is `true`. Continue with `:::elif`, `:::else`, and close with `:::endif`.',
        attributes: [],
        snippet: 'if ${1:condition}\n$0\n:::endif',
        docs: `${DOCS}/016-conditionals.md`
    },
    {
        name: 'elif',
        kind: 'conditional',
        summary: 'Another branch of the open `:::if`, taken when its condition is `true`.',
        attributes: [],
        snippet: 'elif ${1:condition}',
        docs: `${DOCS}/016-conditionals.md`
    },
    {
        name: 'else',
        kind: 'conditional',
        summary: 'The last branch of the open `:::if`, taken when no condition is `true`.',
        attributes: [],
        snippet: 'else',
        docs: `${DOCS}/016-conditionals.md`
    },
    {
        name: 'endif',
        kind: 'conditional',
        summary: 'Closes the open `:::if`.',
        attributes: [],
        snippet: 'endif',
        docs: `${DOCS}/016-conditionals.md`
    },
    {
        name: 'verbatim',
        kind: 'verbatim',
        summary:
            'Shows its body as written: no directives, variables or math. Use more colons than any `:::` line inside it, and close with the same number.',
        attributes: [],
        snippet: 'verbatim\n$0\n:::',
        docs: `${DOCS}/015-escaping.md`
    }
];

const BY_NAME = new Map(DIRECTIVES.map(spec => [spec.name, spec]));

export function directiveSpec(name: string): DirectiveSpec | undefined {
    return BY_NAME.get(name.toLowerCase());
}

export const KEYWORD_DOCS: Record<string, string> = {
    if: '`${if condition}` starts an inline conditional. Close it with `${endif}`.',
    elif: '`${elif condition}` adds a branch to the open `${if}`.',
    else: '`${else}` is the fallback branch of the open `${if}`.',
    endif: '`${endif}` closes the open `${if}`.',
    get: '`get(url, path)` reads one string, number or boolean from a JSON API. The URL must be `https://`, and the path is jq-style with a leading dot, such as `.profile.name` or `.items[0]["title"]`.',
    this: '`this.name` reads an earlier entry inside `:::define`.',
    true: 'The boolean `true`.',
    false: 'The boolean `false`.'
};
