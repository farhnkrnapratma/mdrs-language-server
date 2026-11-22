# MDRS Language Server

[![CircleCI](https://dl.circleci.com/status-badge/img/circleci/stZqvYiNAK17m5zy7ERCb/5iLGfPcwvDync9sXJUExKs/tree/main.svg?style=svg)](https://dl.circleci.com/status-badge/redirect/circleci/stZqvYiNAK17m5zy7ERCb/5iLGfPcwvDync9sXJUExKs/tree/main) [![Coverage](https://codecov.io/gh/farhnkrnapratma/mdrs-language-server/graph/badge.svg)](https://codecov.io/gh/farhnkrnapratma/mdrs-language-server) [![npm](https://img.shields.io/npm/v/%40mdrs%2Flanguage-server?label=npm)](https://www.npmjs.com/package/@mdrs/language-server) [![npm downloads](https://img.shields.io/npm/dm/%40mdrs%2Flanguage-server)](https://www.npmjs.com/package/@mdrs/language-server) ![Node.js](https://img.shields.io/node/v/%40mdrs%2Flanguage-server) ![Types](https://img.shields.io/npm/types/%40mdrs%2Flanguage-server) [![Biome](https://img.shields.io/badge/code_style-Biome-60a5fa?logo=biome)](https://biomejs.dev) [![Conventional Commits](https://img.shields.io/badge/Conventional_Commits-1.0.0-fe5196?logo=conventionalcommits&logoColor=white)](https://www.conventionalcommits.org) [![SemVer](https://img.shields.io/badge/SemVer-2.0.0-blue)](https://semver.org) ![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)

A [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) server for **MDRS (Markdown Rich Syntax)**, the Markdown dialect with directives, document variables, conditionals and live data. It works in any editor with an LSP client.

## Features

- **Diagnostics:**
  - unknown, unclosed or stray directives;
  - missing, unknown, duplicate or unquoted attributes;
  - `::tab` placement and empty tab groups;
  - nesting limits;
  - `:::embed` URLs and `:::references` rules;
  - `:::define` placement, empty blocks, invalid or duplicate names, bare names and forward `this.` references;
  - expression syntax errors;
  - `get()` URLs (https only, no credentials) and jq-style paths;
  - undefined variables in `${…}`;
  - unbalanced `:::if`/`:::endif` and `${if}`/`${endif}`;
  - invalid frontmatter YAML.
- **Completion:**
  - directive names with snippets after `:::`;
  - `::tab` inside `:::tabs` and `:::snippets`;
  - the attributes a directive still needs;
  - variables, `this.` entries, keywords, `get()` and literals inside `${…}`, `:::if` conditions and `:::define` values.
- **Hover:**
  - directive documentation with its attribute table;
  - attribute descriptions;
  - a variable's definition;
  - `get`, `this` and the conditional keywords.
- **Document symbols:** an outline of the `:::define` variables, headings, and nested directives and tabs.
- **Folding:**
  - frontmatter, `:::define`, directives, conditional branches, code fences and heading sections;
  - go to definition, find references and document highlights for variables.

Code spans, fenced code blocks and `:::verbatim` blocks are left alone, exactly as the MDRS engine does.

## Install

```sh
npm install --global @mdrs/language-server
# or
bun add --global @mdrs/language-server
```

This installs the `mdrs-language-server` command (Node.js 20 or later). It talks over standard input and output by default; `--node-ipc` and `--socket=<port>` are also supported.

## Editor setup

Associate `*.mdrs` files with the `mdrs` language, then start the server with `mdrs-language-server --stdio`.

### Neovim

```lua
vim.filetype.add({ extension = { mdrs = 'mdrs' } })

vim.api.nvim_create_autocmd('FileType', {
    pattern = 'mdrs',
    callback = function(args)
        vim.lsp.start({
            name = 'mdrs',
            cmd = { 'mdrs-language-server', '--stdio' },
            root_dir = vim.fs.root(args.buf, { '.git' }),
        })
    end,
})
```

### Helix (`languages.toml`)

```toml
[language-server.mdrs]
command = "mdrs-language-server"
args = ["--stdio"]

[[language]]
name = "mdrs"
scope = "source.mdrs"
file-types = ["mdrs"]
language-servers = ["mdrs"]
grammar = "markdown"
```

### VS Code

Use any generic LSP client extension, or a small extension that starts the server with `vscode-languageclient`:

```ts
new LanguageClient(
    'mdrs',
    'MDRS',
    { command: 'mdrs-language-server', args: ['--stdio'] },
    { documentSelector: [{ language: 'mdrs' }] }
).start();
```

## Library use

The analysis runs without a server, in Node.js or in the browser, so an editor can show the same diagnostics, completion and hover in place:

```ts
import { analyze, complete, hover, documentSymbols } from '@mdrs/language-server';

const analysis = analyze(':::callout\nBody\n:::');
console.log(analysis.diagnostics[0].message); // :::callout requires title="..."
```

The server itself is a separate entry point that needs Node.js:

```ts
import { startServer } from '@mdrs/language-server/server';

startServer();
```

## Development

```sh
bun install
bun test           # unit tests and an end-to-end stdio test
bun run coverage   # the same with a 100% line and function coverage gate
bun run check      # Biome (format and lint), then the type check
bun run format     # format with Biome
bun run build      # compiles to dist/
```

The expression lexer and parser in `src/expr/` come from the MDRS engine, so `:::define` and `${…}` errors read the same as the engine's own messages.

## Versioning

Releases follow [Semantic Versioning 2.0.0](https://semver.org/). Before 1.0.0, a minor release (0.x.0) may change diagnostics, completion or the library API, and a patch release (0.x.y) only fixes bugs. Each release is tagged `vMAJOR.MINOR.PATCH` and listed in [CHANGELOG.md](CHANGELOG.md).

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT) at your option.
