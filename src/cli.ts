#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';
import { VERSION } from './version.js';

const HELP = `Usage: mdrs-language-server [--stdio | --node-ipc | --socket=<port>]

Starts the MDRS language server. Editors usually pass --stdio.

Options:
  --stdio           Talk over standard input and output
  --node-ipc        Talk over the Node.js IPC channel
  --socket=<port>   Talk over a TCP socket
  --version         Print the version
  --help            Print this help`;

export function main(args: string[], start: () => void = startServer, log: (text: string) => void = console.log) {
    if (args.includes('--help') || args.includes('-h')) {
        log(HELP);
        return;
    }
    if (args.includes('--version') || args.includes('-v')) {
        log(VERSION);
        return;
    }
    if (!args.some(arg => arg === '--stdio' || arg === '--node-ipc' || arg.startsWith('--socket') || arg.startsWith('--pipe'))) {
        process.argv.push('--stdio');
    }
    start();
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
