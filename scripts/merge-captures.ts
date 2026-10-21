// Folds the captures of several record jobs into captures/: `node scripts/merge-captures.ts <downloaded> <captures>`.
// Each job recorded into its own copy of captures/<suite>/; entries are merged, an existing entry is kept.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Archive } from '../src/seal/server.ts';

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error('usage: node scripts/merge-captures.ts <downloaded artifacts> <captures dir>');

async function* indexes(dir: string): AsyncGenerator<string> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* indexes(path);
		else if (entry.name === 'index.json' && path.includes(`${join('captures', '')}`)) yield path;
	}
}

let added = 0;
for await (const index of indexes(from)) {
	const suiteDir = join(index, '..');
	const suite = suiteDir.split('/').at(-1)!;
	const target = join(to, suite);
	await mkdir(join(target, 'bodies'), { recursive: true });
	const incoming = JSON.parse(await readFile(index, 'utf8')) as Archive;
	const targetIndex = join(target, 'index.json');
	const merged: Archive = existsSync(targetIndex) ? (JSON.parse(await readFile(targetIndex, 'utf8')) as Archive) : { version: 1, entries: {} };
	for (const [key, entry] of Object.entries(incoming.entries)) {
		if (merged.entries[key]) continue;
		const body = join(suiteDir, 'bodies', `${entry.body}.br`);
		const kept = join(target, 'bodies', `${entry.body}.br`);
		if (!existsSync(kept)) await copyFile(body, kept);
		merged.entries[key] = entry;
		added++;
	}
	const sorted = Object.fromEntries(Object.entries(merged.entries).sort(([a], [b]) => (a < b ? -1 : 1)));
	await writeFile(targetIndex, `${JSON.stringify({ version: 1, entries: sorted }, null, '\t')}\n`);
}
console.log(`${added} captured responses added`);
