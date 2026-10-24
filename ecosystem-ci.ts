// markless-ecosystem-ci: the migrated sites from markless-migrate, built against a Markless ref and checked
// against captures of their old sites. `node ecosystem-ci.ts --help` lists the commands.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compareAll, loadBaseline, toBaseline, writeBaseline } from './src/compare.ts';
import { buildMarkless, readPacks } from './src/markless.ts';
import { checkoutMigrate, readPin } from './src/migrate.ts';
import { renderMarkdown, summarize } from './src/report.ts';
import { runSuite } from './src/run-suite.ts';
import { jobCount, loadSuites, selectSuites, shard } from './src/suites.ts';
import type { Lane, SuiteResult } from './src/types.ts';

const root = import.meta.dirname;
const USAGE = `node ecosystem-ci.ts <command> [options]

  build                build and pack Markless only (one CI job, its packs shared with the suite jobs)
      --markless-dir <dir> | --ref <ref>   --packs <dir>
  run [suite...]       build Markless and the sites, check the sites (default: every suite)
      --markless-dir <dir>   build this Markless checkout as it is
      --ref <ref>            or clone compiled-run/markless at a branch, tag, sha or pr/<n>
      --packs <dir>          use (or write) packed tarballs here instead of building again
      --ref-label <ref>      the ref the packs were built from, for the report
      --lane sample|full     the per-PR route sample (default) or every route
      --shard <i/n>          only this share of each suite's routes
      --route <path>         only this route (repeatable), for a closer look at one
      --record               capture the old sites from the live network instead of replaying
      --migrate-ref <sha>    markless-migrate at another commit than migrate.json pins
      --concurrency <n>      routes the checker runs at once (default 2)
      --workspace <dir>      where checkouts and builds go (default ./workspace)
      --results <dir>        where each suite's result.json is written (default ./results)
  compare [suite...]   compare results against main's baseline; exit 1 on a regression or a suite with no result
      --results <dir> --lane sample|full --markdown <file> --title <text> [--run-url <url>]
      --against <dir>        compare with another run's results instead of the stored baseline
      --summary <file>       also write the regressions as JSON, for scripts/notify.ts
  baseline             store results as the lane's baseline from main
      --results <dir> --lane sample|full
  list [suite...]      print the suites, their sample routes and what they cover
      --json                 only the names of the suites that run, as a JSON array (for a CI matrix)
      --matrix               the lane's CI jobs as a JSON array of { suite, shard }, each suite's routes split across jobs
`;

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		'markless-dir': { type: 'string' },
		packs: { type: 'string' },
		ref: { type: 'string' },
		'ref-label': { type: 'string' },
		route: { type: 'string', multiple: true },
		lane: { type: 'string', default: 'sample' },
		shard: { type: 'string' },
		record: { type: 'boolean', default: false },
		'migrate-ref': { type: 'string' },
		concurrency: { type: 'string', default: '2' },
		workspace: { type: 'string', default: join(root, 'workspace') },
		results: { type: 'string', default: join(root, 'results') },
		markdown: { type: 'string' },
		summary: { type: 'string' },
		title: { type: 'string' },
		'run-url': { type: 'string' },
		against: { type: 'string' },
		json: { type: 'boolean', default: false },
		matrix: { type: 'boolean', default: false },
		help: { type: 'boolean', default: false },
	},
});

const [command, ...rest] = positionals;
const lane = values.lane as Lane;
if (lane !== 'sample' && lane !== 'full') throw new Error('--lane must be sample or full');

async function readResults(dir: string): Promise<SuiteResult[]> {
	const results: SuiteResult[] = [];
	const walk = async (at: string): Promise<void> => {
		for (const entry of await readdir(at, { withFileTypes: true }).catch(() => [])) {
			const path = join(at, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.name.endsWith('.result.json')) results.push(JSON.parse(await readFile(path, 'utf8')) as SuiteResult);
		}
	};
	await walk(dir);
	return mergeShards(results);
}

/** A full-lane suite split across runners comes back as several results; they are one suite again here. */
function mergeShards(results: SuiteResult[]): SuiteResult[] {
	const bySuite = new Map<string, SuiteResult>();
	for (const result of results) {
		const seen = bySuite.get(result.suite);
		if (!seen) {
			bySuite.set(result.suite, result);
			continue;
		}
		const worse = (a: string, b: string) => (a === 'fail' || b === 'fail' ? 'fail' : a === 'pass' || b === 'pass' ? 'pass' : 'skipped');
		bySuite.set(result.suite, {
			...seen,
			steps: Object.fromEntries(Object.entries(seen.steps).map(([k, v]) => [k, worse(v, result.steps[k as keyof SuiteResult['steps']])])) as SuiteResult['steps'],
			...(seen.error || result.error ? { error: [seen.error, result.error].filter(Boolean).join('\n') } : {}),
			timings: Object.fromEntries([...new Set([...Object.keys(seen.timings), ...Object.keys(result.timings)])].map((k) => [k, Math.max(seen.timings[k] ?? 0, result.timings[k] ?? 0)])),
			routes: { ...seen.routes, ...result.routes },
			seal: { served: seen.seal.served + result.seal.served, loose: seen.seal.loose + result.seal.loose, misses: [...new Set([...seen.seal.misses, ...result.seal.misses])].sort() },
		});
	}
	return [...bySuite.values()].sort((a, b) => (a.suite < b.suite ? -1 : 1));
}

async function markless(workspace: string) {
	const dir = values.packs ? resolve(values.packs) : join(workspace, 'packs');
	if (values.packs && !values['markless-dir'] && !values.ref) {
		const packed = await readPacks(dir);
		if (!packed) throw new Error(`no packs.json with its tarballs in ${dir}`);
		return packed;
	}
	return buildMarkless(values['markless-dir'] ? { dir: values['markless-dir'] } : { ref: values.ref ?? 'main' }, workspace, dir);
}

async function build(): Promise<void> {
	const workspace = resolve(values.workspace!);
	await mkdir(workspace, { recursive: true });
	await markless(workspace);
}

async function run(): Promise<void> {
	const workspace = resolve(values.workspace!);
	const resultsDir = resolve(values.results!);
	await mkdir(workspace, { recursive: true });
	await mkdir(resultsDir, { recursive: true });
	const suites = await selectSuites(root, rest);
	const lanes = suites;
	const packs = await markless(workspace);
	const pin = await readPin(root);
	const pinned = lanes.some((s) => values['migrate-ref'] || !s.migrateRef) ? await checkoutMigrate(pin, workspace, values['migrate-ref']) : undefined;
	let failed = false;
	for (const suite of lanes) {
		// A suite on its own markless-migrate commit gets its own checkout; --migrate-ref still overrides every suite.
		const migrate = !values['migrate-ref'] && suite.migrateRef ? await checkoutMigrate(pin, workspace, suite.migrateRef, `markless-migrate-${suite.name}`) : pinned!;
		const all = lane === 'sample' ? suite.routes.sample.map((r) => r.route) : [...suite.routes.full];
		const routes = values.route?.length ? values.route : shard(all, values.shard);
		if (!routes.length) continue;
		console.log(`[${suite.name}] ${lane} lane, ${routes.length} routes${values.shard ? `, shard ${values.shard}` : ''}`);
		const result = await runSuite({ root, workspace, suite, lane, packs, migrate, seal: values.record ? 'record' : 'replay', routes, concurrency: Number(values.concurrency), ...(values['ref-label'] || values.ref ? { ref: values['ref-label'] ?? values.ref } : {}) });
		const name = `${suite.name}${values.shard ? `.${values.shard.replace('/', '-of-')}` : ''}.result.json`;
		await writeFile(join(resultsDir, name), `${JSON.stringify(result, null, '\t')}\n`);
		const green = Object.values(result.routes).filter((r) => r.ok).length;
		console.log(`[${suite.name}] ${Object.entries(result.steps).map(([k, v]) => `${k} ${v}`).join(', ')}; ${green} of ${Object.keys(result.routes).length} routes green; ${result.seal.misses.length} requests missing from the capture; ${Math.round(Object.values(result.timings).reduce((a, b) => a + b, 0) / 1000)} s`);
		if (Object.values(result.steps).includes('fail')) failed = true;
	}
	// A failed step is a result like any other; `compare` decides whether it is a regression.
	if (failed) console.log('a suite step failed; its result records why');
}

async function compare(): Promise<void> {
	const results = await readResults(resolve(values.results!));
	// The suites this run was asked for (the same names as `run`): one that reported nothing is a regression.
	const expected = await selectSuites(root, rest);
	const baseline = values.against ? new Map((await readResults(resolve(values.against))).map((r) => [r.suite, toBaseline(r, expected.find((s) => s.name === r.suite)?.owner ?? 'unowned')])) : await loadBaseline(root, lane);
	const comparison = compareAll(expected, results, baseline);
	const markdown = renderMarkdown(comparison, { title: values.title ?? 'Markless ecosystem CI', lane, ...(values['run-url'] ? { runUrl: values['run-url'] } : {}) });
	if (values.markdown) await writeFile(values.markdown, markdown);
	if (values.summary) await writeFile(values.summary, `${JSON.stringify(summarize(comparison), null, '\t')}\n`);
	console.log(markdown);
	if (comparison.regressed) process.exitCode = 1;
}

async function baseline(): Promise<void> {
	const results = await readResults(resolve(values.results!));
	await writeBaseline(root, lane, results, await loadSuites(root));
}

async function list(): Promise<void> {
	const suites = await selectSuites(root, rest);
	if (values.matrix) {
		console.log(JSON.stringify(suites.filter((s) => !s.disabled).flatMap((s) => {
			const count = jobCount(s, lane);
			return Array.from({ length: count }, (_, i) => ({ suite: s.name, shard: `${i + 1}/${count}` }));
		})));
		return;
	}
	if (values.json) {
		console.log(JSON.stringify(suites.filter((s) => !s.disabled).map((s) => s.name)));
		return;
	}
	for (const suite of suites) {
		console.log(`${suite.name}${suite.disabled ? ` (disabled: ${suite.disabled})` : ''}: ${suite.routes.full.length} routes, sample:`);
		for (const sample of suite.routes.sample) console.log(`  ${sample.route}  ${sample.covers.join(', ')}`);
	}
}

if (values.help || !command) console.log(USAGE);
else if (command === 'build') await build();
else if (command === 'run') await run();
else if (command === 'compare') await compare();
else if (command === 'baseline') await baseline();
else if (command === 'list') await list();
else {
	console.error(USAGE);
	process.exitCode = 2;
}
