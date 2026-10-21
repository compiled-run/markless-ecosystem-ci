// Prints a result file's steps, timings and each route's failures: `node scripts/summary.ts results/<suite>.result.json`.
import { readFile } from 'node:fs/promises';
import type { SuiteResult } from '../src/types.ts';

for (const file of process.argv.slice(2)) {
	const result = JSON.parse(await readFile(file, 'utf8')) as SuiteResult;
	console.log(`${result.suite} (${result.lane}) Markless ${result.markless.sha.slice(0, 9)}: ${Object.entries(result.steps).map(([k, v]) => `${k} ${v}`).join(', ')}`);
	console.log(`  timings: ${Object.entries(result.timings).map(([k, v]) => `${k} ${Math.round(v / 1000)} s`).join(', ')}`);
	console.log(`  seal: ${result.seal.served} served, ${result.seal.loose} by path only, ${result.seal.misses.length} misses${result.seal.misses.length ? `: ${result.seal.misses.slice(0, 8).join('; ')}` : ''}`);
	if (result.error) console.log(`  error: ${result.error.split('\n').slice(0, 3).join(' | ')}`);
	for (const [route, record] of Object.entries(result.routes)) {
		console.log(`  ${record.ok ? 'green' : 'red  '} ${route}${record.infrastructure ? ` (not checked: ${record.infrastructure})` : ''}${record.weight ? `  JS at load ${record.weight.downloaded} B` : ''}`);
		for (const failure of record.failures) console.log(`      ${failure.id} ${failure.dimension}${failure.viewport ? `/${failure.viewport}` : ''}: ${failure.check.slice(0, 110)}`);
	}
}
