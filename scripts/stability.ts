// Two replays of the same build must agree the way `compare` sees them: the second, compared with the first
// as if the first were main's baseline, has no regression. `node scripts/stability.ts <results a> <results b>`.
// Exits 1 when a suite would have reported a regression against itself.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyQuarantine, compareSuite, toBaseline } from '../src/compare.ts';
import { loadSuites } from '../src/suites.ts';
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
const suites = await loadSuites(join(import.meta.dirname, '..'));
const [first, second] = [await load(a), await load(b)];
let differs = false;
for (const [name, one] of first) {
	const two = second.get(name);
	const suite = suites.find((s) => s.name === name);
	if (!two || !suite) continue;
	const forward = applyQuarantine(compareSuite(suite, two, toBaseline(one, suite.owner))).regressions;
	const backward = applyQuarantine(compareSuite(suite, one, toBaseline(two, suite.owner))).regressions;
	const all = [...forward.map((r) => ({ ...r, only: 'second' })), ...backward.map((r) => ({ ...r, only: 'first' }))];
	console.log(`### ${name}: ${all.length ? `${all.length} regressions between two replays of one build` : 'two replays agree'}, ${new Set([...one.seal.misses, ...two.seal.misses]).size} capture misses\n`);
	for (const r of all.slice(0, 40)) console.log(`- only in the ${r.only} run: ${r.route ? `\`${r.route}\` ` : ''}${r.detail.slice(0, 300)}`);
	console.log('');
	if (all.length) differs = true;
}
if (differs) process.exitCode = 1;
