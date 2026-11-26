// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { expect, test } from 'bun:test';

const root = new URL('../', import.meta.url).pathname;
const sources = [...new Bun.Glob('src/**/*.ts').scanSync({ cwd: root })].sort();

test('every source file loads, so coverage reports the ones no test reaches', async () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
        expect(await import(`../${source}`)).toBeDefined();
    }
});
