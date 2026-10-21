// Two replays of the same build must agree: `node scripts/stability.ts <results a> <results b>`.
// Prints, per suite, the failures only one of the two runs had (nondeterminism to fix before a baseline can be
// trusted) and the capture misses (requests to record). Exits 1 when the runs differ.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SuiteResult } from '../src/types.ts';

async function load(dir: string): Promise<Map<string, SuiteResult>> {
	const map = new Map<string, SuiteResult>();
	for (const file of await readdir(dir)) {
		if (!file.endsWith('.result.json')) continue;
		const result = JSON.parse(await readFile(join(dir, file), 'utf8')) as SuiteResult;
		const seen = map.get(result.suite);
		map.set(result.suite, seen ? { ...seen, routes: { ...seen.routes, ...result.routes }, seal: { ...seen.seal, misses: [...seen.seal.misses, ...result.seal.misses] } } : result);
	}
	return map;
}

const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('usage: node scripts/stability.ts <results a> <results b>');
const [first, second] = [await load(a), await load(b)];
let differs = false;
for (const [suite, one] of first) {
	const two = second.get(suite);
	if (!two) continue;
	const lines: string[] = [];
	for (const [route, record] of Object.entries(one.routes)) {
		const other = two.routes[route];
		if (!other) continue;
		const ids = (r: typeof record) => new Map(r.failures.map((f) => [f.id, `${f.dimension}${f.viewport ? `/${f.viewport}` : ''}: ${f.check}`]));
		const [x, y] = [ids(record), ids(other)];
		for (const [id, text] of x) if (!y.has(id)) lines.push(`- \`${route}\` only in the first run: ${id} ${text}`);
		for (const [id, text] of y) if (!x.has(id)) lines.push(`- \`${route}\` only in the second run: ${id} ${text}`);
		if (Boolean(record.infrastructure) !== Boolean(other.infrastructure)) lines.push(`- \`${route}\` checked in one run only: ${record.infrastructure ?? other.infrastructure}`);
	}
	const misses = [...new Set([...one.seal.misses, ...two.seal.misses])];
	console.log(`### ${suite}: ${lines.length ? `${lines.length} differences between two replays` : 'two replays agree'}, ${misses.length} capture misses\n`);
	for (const line of lines) console.log(line);
	for (const miss of misses.slice(0, 30)) console.log(`- miss: ${miss}`);
	console.log('');
	if (lines.length) differs = true;
}
if (differs) process.exitCode = 1;
