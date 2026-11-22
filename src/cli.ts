#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

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

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
} else if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
} else {
    if (!args.some(arg => arg === '--stdio' || arg === '--node-ipc' || arg.startsWith('--socket') || arg.startsWith('--pipe'))) {
        process.argv.push('--stdio');
    }
    startServer();
}
