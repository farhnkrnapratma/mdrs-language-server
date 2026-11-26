// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { afterEach, expect, test } from 'bun:test';
import { main } from '../src/cli.js';
import { VERSION } from '../src/version.js';

const argv = [...process.argv];

afterEach(() => {
    process.argv.splice(0, process.argv.length, ...argv);
});

function run(args: string[]) {
    const logged: string[] = [];
    let started = 0;
    main(
        args,
        () => {
            started += 1;
        },
        text => logged.push(text)
    );
    return { logged, started };
}

test('prints help and the version without starting the server', () => {
    for (const flag of ['--help', '-h']) {
        const { logged, started } = run([flag]);
        expect(logged[0]).toStartWith('Usage: mdrs-language-server');
        expect(started).toBe(0);
    }
    for (const flag of ['--version', '-v']) {
        expect(run([flag])).toEqual({ logged: [VERSION], started: 0 });
    }
});

test('starts the server over stdio unless a transport is given', () => {
    expect(run([]).started).toBe(1);
    expect(process.argv.at(-1)).toBe('--stdio');
    for (const transport of ['--stdio', '--node-ipc', '--socket=5000', '--pipe=x']) {
        process.argv.splice(0, process.argv.length, ...argv);
        expect(run([transport]).started).toBe(1);
        expect(process.argv).toEqual(argv);
    }
});
