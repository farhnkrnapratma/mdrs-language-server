# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## 0.3.0

- `@mdrs/language-server/highlight` exports `mdrsLanguage`, the highlight.js grammar for MDRS. `highlight.js` is an optional peer dependency, so only users of this entry need it.
- Fix: a heading followed by a long run of spaces no longer makes the analysis take quadratic time (80,000 characters took 11.7 s).

## 0.2.0

- The package root runs in the browser: the analysis imports only `vscode-languageserver-types`.
- `startServer` and `SERVER_NAME` move to `@mdrs/language-server/server`.

## 0.1.0

- First release.
- Diagnostics for directives, attributes, tabs, embeds, references, `:::define`, expressions, `get()`, interpolation, conditionals and frontmatter.
- Completion for directives, `::tab`, attributes, variables, `this.` entries, keywords, `get()` and literals.
- Hover for directives, attributes, variables and keywords.
- Document symbols, folding ranges, go to definition, references and document highlights.
