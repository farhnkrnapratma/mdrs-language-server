// SPDX-FileCopyrightText: 2026 Farhan Kurnia Pratama
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { expect, test } from 'bun:test';

test('the package root bundles for the browser without the Node.js server', async () => {
    const build = await Bun.build({ entrypoints: [`${import.meta.dir}/../src/index.ts`], target: 'browser' });
    expect(build.success).toBe(true);
    const code = await build.outputs[0].text();
    expect(code).not.toContain('child_process');
    expect(code).not.toContain('createConnection');
});
