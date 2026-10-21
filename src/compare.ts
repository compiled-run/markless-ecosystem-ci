// A run against main's baseline: only what got worse counts. A red the baseline already has is a known red,
// listed with its owner; it never fails a run.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FailureRecord, Lane, RouteRecord, Suite, SuiteResult } from './types.ts';

/** JavaScript at load may grow by this much before it is a regression: a rebuild of the same code moves a few bytes. */
export const WEIGHT_SLACK = { bytes: 2048, ratio: 0.05 };

export interface BaselineRoute {
	readonly ok: boolean;
	readonly failures: readonly Pick<FailureRecord, 'id' | 'dimension' | 'check'>[];
	readonly weight?: RouteRecord['weight'];
	readonly infrastructure?: string;
	/** Set on a red route: who answers for it. */
	readonly owner?: string;
}

export interface Baseline {
	readonly suite: string;
	readonly lane: Lane;
	readonly markless: SuiteResult['markless'];
	readonly migrate: SuiteResult['migrate'];
	readonly recordedAt: string;
	readonly steps: SuiteResult['steps'];
	readonly routes: Record<string, BaselineRoute>;
	readonly misses: readonly string[];
}

export interface Regression {
	readonly kind: 'step' | 'route' | 'failure' | 'weight' | 'capture' | 'missing';
	readonly route?: string;
	readonly detail: string;
}

export interface SuiteComparison {
	readonly suite: Suite;
	readonly result?: SuiteResult;
	readonly baseline?: Baseline;
	readonly regressions: readonly Regression[];
	/** New timing-only responsiveness failures: shown, not counted (see timingOnly). */
	readonly timing: readonly Regression[];
	readonly fixed: readonly string[];
	readonly knownReds: readonly { route: string; owner: string; dimensions: string[] }[];
	readonly unbaselined: readonly string[];
}

export interface Comparison {
	readonly suites: readonly SuiteComparison[];
	readonly regressed: boolean;
}

export async function loadBaseline(root: string, lane: Lane): Promise<Map<string, Baseline>> {
	const dir = join(root, 'baselines', lane);
	const map = new Map<string, Baseline>();
	if (!existsSync(dir)) return map;
	for (const file of await readdir(dir)) {
		if (!file.endsWith('.json')) continue;
		const baseline = JSON.parse(await readFile(join(dir, file), 'utf8')) as Baseline;
		map.set(baseline.suite, baseline);
	}
	return map;
}

export async function writeBaseline(root: string, lane: Lane, results: readonly SuiteResult[], suites: readonly Suite[]): Promise<void> {
	const dir = join(root, 'baselines', lane);
	await mkdir(dir, { recursive: true });
	for (const result of results) {
		if (result.disabled) continue;
		const owner = suites.find((s) => s.name === result.suite)?.owner ?? 'unowned';
		const routes = Object.fromEntries(
			Object.entries(result.routes)
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([route, record]) => [
					route,
					{
						ok: record.ok,
						failures: record.failures.map(({ id, dimension, check }) => ({ id, dimension, check })),
						...(record.weight ? { weight: record.weight } : {}),
						...(record.infrastructure ? { infrastructure: record.infrastructure } : {}),
						...(record.ok ? {} : { owner }),
					} satisfies BaselineRoute,
				]),
		);
		const baseline: Baseline = { suite: result.suite, lane, markless: result.markless, migrate: result.migrate, recordedAt: result.startedAt, steps: result.steps, routes, misses: result.seal.misses };
		await writeFile(join(dir, `${result.suite}.json`), `${JSON.stringify(baseline, null, '\t')}\n`);
	}
}

/**
 * A responsiveness failure that is only about time (slower than the old side, over the budget) is reported, not
 * counted: two replays of the same build on the same runner disagreed on which controls were slow (ag-grid: 4 of 4
 * timed controls, realworld: 2 links). A first interaction that fetches code is counted; it does not depend on time.
 */
export function timingOnly(failure: Pick<FailureRecord, 'dimension' | 'actual'>): boolean {
	return failure.dimension === 'responsiveness' && !/fetched code on the first interaction/.test(failure.actual ?? '');
}

function heavier(now: number, before: number): boolean {
	return now > before + Math.max(WEIGHT_SLACK.bytes, before * WEIGHT_SLACK.ratio);
}

export function compareSuite(suite: Suite, result: SuiteResult | undefined, baseline: Baseline | undefined): SuiteComparison {
	const regressions: Regression[] = [];
	const timing: Regression[] = [];
	const fixed: string[] = [];
	const unbaselined: string[] = [];
	const knownReds: SuiteComparison['knownReds'][number][] = [];
	if (suite.disabled) return { suite, regressions, timing, fixed, knownReds, unbaselined, ...(result ? { result } : {}), ...(baseline ? { baseline } : {}) };
	if (!result) {
		regressions.push({ kind: 'missing', detail: 'the suite did not report a result (its job failed before it wrote one)' });
		return { suite, regressions, timing, fixed, knownReds, unbaselined, ...(baseline ? { baseline } : {}) };
	}
	for (const [step, status] of Object.entries(result.steps)) {
		const before = baseline?.steps[step as keyof SuiteResult['steps']];
		if (status === 'fail' && before !== 'fail') regressions.push({ kind: 'step', detail: `${step} failed${before ? `, it passed on main` : ''}: ${(result.error ?? '').split('\n')[0]?.slice(0, 300)}` });
	}
	for (const [route, record] of Object.entries(result.routes)) {
		const before = baseline?.routes[route];
		if (!before) {
			unbaselined.push(route);
			continue;
		}
		if (record.infrastructure && !before.infrastructure) {
			regressions.push({ kind: 'route', route, detail: `not checked: ${record.infrastructure}` });
			continue;
		}
		const known = new Set(before.failures.map((f) => f.id));
		const added = record.failures.filter((f) => !known.has(f.id));
		for (const failure of added.filter((f) => timingOnly(f))) timing.push({ kind: 'failure', route, detail: describe(failure) });
		for (const failure of added.filter((f) => !timingOnly(f))) {
			regressions.push({ kind: 'failure', route, detail: describe(failure) });
		}
		if (record.weight && before.weight) {
			for (const field of ['downloaded', 'executed'] as const) {
				if (heavier(record.weight[field], before.weight[field])) regressions.push({ kind: 'weight', route, detail: `JavaScript ${field} at load ${record.weight[field]} bytes, main ${before.weight[field]}` });
			}
		}
		if (record.ok && !before.ok) fixed.push(route);
		if (!record.ok && !before.ok && !added.some((f) => !timingOnly(f))) knownReds.push({ route, owner: before.owner ?? suite.owner, dimensions: [...new Set(before.failures.map((f) => f.dimension))] });
	}
	if (baseline) {
		for (const route of Object.keys(baseline.routes)) {
			if (!(route in result.routes) && result.steps.check === 'pass' && Object.keys(result.routes).length) {
				// A route of the lane the checker did not report at all.
				if (Object.keys(baseline.routes).length && routeExpected(suite, result, route)) regressions.push({ kind: 'route', route, detail: 'the checker reported nothing for this route' });
			}
		}
		const knownMisses = new Set(baseline.misses);
		for (const miss of result.seal.misses) if (!knownMisses.has(miss)) regressions.push({ kind: 'capture', detail: `a request main does not make, not in the capture: ${miss}` });
	}
	return { suite, result, regressions, timing, fixed, knownReds, unbaselined, ...(baseline ? { baseline } : {}) };
}

function describe(failure: FailureRecord): string {
	return `${failure.dimension}${failure.viewport ? ` (${failure.viewport})` : ''}: ${failure.check}${failure.expected !== undefined ? `; expected ${failure.expected}, got ${failure.actual}` : ''}`;
}

function routeExpected(suite: Suite, result: SuiteResult, route: string): boolean {
	const lane = result.lane === 'sample' ? suite.routes.sample.map((r) => r.route) : suite.routes.full;
	return lane.includes(route) && result.lane === 'sample';
}

export function compareAll(suites: readonly Suite[], results: readonly SuiteResult[], baseline: Map<string, Baseline>): Comparison {
	const ran = new Set(results.map((r) => r.suite));
	const compared = suites.filter((suite) => ran.has(suite.name) || suite.disabled).map((suite) => compareSuite(suite, results.find((r) => r.suite === suite.name), baseline.get(suite.name)));
	return { suites: compared, regressed: compared.some((c) => c.regressions.length > 0) };
}
