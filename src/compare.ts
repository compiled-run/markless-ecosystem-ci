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
	/** `lastSeen`: when a main run last showed it (see BASELINE_MEMORY_DAYS). */
	readonly failures: readonly (Pick<FailureRecord, 'id' | 'dimension' | 'check' | 'viewport'> & { readonly lastSeen?: string })[];
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
	/** New failures that vary between replays of one build: shown, not counted (see timingOnly, explorationOnly). */
	readonly timing: readonly Regression[];
	readonly fixed: readonly string[];
	/** Regressions of a quarantined suite: shown, not counted while the quarantine holds. */
	readonly quarantined: readonly Regression[];
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

export function toBaseline(result: SuiteResult, owner: string): Baseline {
	const routes = Object.fromEntries(
		Object.entries(result.routes)
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([route, record]) => [
				route,
				{
					ok: record.ok,
					failures: record.failures.map(({ id, dimension, check, viewport }) => ({ id, dimension, check, ...(viewport ? { viewport } : {}) })),
					...(record.weight ? { weight: record.weight } : {}),
					...(record.infrastructure ? { infrastructure: record.infrastructure } : {}),
					...(record.ok ? {} : { owner }),
				} satisfies BaselineRoute,
			]),
	);
	return { suite: result.suite, lane: result.lane, markless: result.markless, migrate: result.migrate, recordedAt: result.startedAt, steps: result.steps, routes, misses: result.seal.misses };
}

/**
 * How long a failure main showed stays known after main last showed it. One run of a route is not enough to know
 * main: two replays of one build disagreed on journey, keyboard and hover checks (realworld /article: four
 * keyboard paths in one of two runs). A failure any main run showed in this window is not new.
 */
export const BASELINE_MEMORY_DAYS = 7;

/** Main's latest result, plus every failure an earlier main run showed within BASELINE_MEMORY_DAYS of it. */
export function rememberBaseline(latest: Baseline, previous: Baseline | undefined): Baseline {
	if (!previous) return { ...latest, routes: Object.fromEntries(Object.entries(latest.routes).map(([route, r]) => [route, { ...r, failures: r.failures.map((f) => ({ ...f, lastSeen: latest.recordedAt })) }])) };
	const cutoff = Date.parse(latest.recordedAt) - BASELINE_MEMORY_DAYS * 86_400_000;
	const routes: Record<string, BaselineRoute> = {};
	for (const [route, now] of Object.entries(latest.routes)) {
		const seen = new Set(now.failures.map(failureKey));
		const kept = (previous.routes[route]?.failures ?? []).filter((f) => !seen.has(failureKey(f)) && Date.parse(f.lastSeen ?? previous.recordedAt) >= cutoff).map((f) => ({ ...f, lastSeen: f.lastSeen ?? previous.recordedAt }));
		routes[route] = { ...now, failures: [...now.failures.map((f) => ({ ...f, lastSeen: latest.recordedAt })), ...kept] };
	}
	return { ...latest, routes, misses: [...new Set([...latest.misses, ...previous.misses])].sort() };
}

export async function writeBaseline(root: string, lane: Lane, results: readonly SuiteResult[], suites: readonly Suite[]): Promise<void> {
	const dir = join(root, 'baselines', lane);
	await mkdir(dir, { recursive: true });
	const previous = await loadBaseline(root, lane);
	for (const result of results) {
		if (result.disabled) continue;
		const latest = toBaseline(result, suites.find((s) => s.name === result.suite)?.owner ?? 'unowned');
		const baseline = rememberBaseline(latest, previous.get(result.suite));
		await writeFile(join(dir, `${result.suite}.json`), `${JSON.stringify(baseline, null, '\t')}\n`);
	}
}

/** The checker fetches a source map only to name a failure's source line, and only for some failures; a page never asks for one. */
const SOURCE_MAP = /\.map(?:\?[^ ]*)?(?: |$)/;

/** A journey that logged an error the old page did not: whichever journeys were explored, that one threw. */
const CONSOLE_ERRORS = /console errors: (?!\(none\))/;

/** A miss without its query and body hash: a beacon names a fresh session id or nonce on every send, so only its endpoint repeats. */
function missEndpoint(miss: string): string {
	const url = missUrl(miss);
	return url ? `${miss.split(' ')[0]} ${url.origin}${url.pathname}` : miss;
}

function missUrl(miss: string): URL | undefined {
	try {
		return new URL(miss.split(' ')[1] ?? '');
	} catch {
		return undefined;
	}
}

/** Dimensions whose failures come from the journeys the checker chose to explore on the old page. */
const JOURNEY_DIMENSIONS = new Set(['behaviour', 'motion']);

/**
 * A journey failure that says more about which journeys were explored than about the new page: a control the
 * exploration did not reach ("not exercised"), or any new journey failure on a route main already has red on that
 * dimension. Two replays of one build explored different journeys there (docusaurus /: 8 journey failures in only
 * one of two runs; alpinejs-dev /directives/model: 3 controls reached in only one). On a route main has green on
 * the dimension, a new journey failure counts, and so does one that logged a console error anywhere.
 */
export function explorationOnly(failure: Pick<FailureRecord, 'dimension' | 'check' | 'actual'>, before: BaselineRoute): boolean {
	if (!JOURNEY_DIMENSIONS.has(failure.dimension)) return false;
	if (CONSOLE_ERRORS.test(failure.actual ?? '')) return false;
	if (failure.check.startsWith('not exercised')) return true;
	return before.failures.some((f) => f.dimension === failure.dimension);
}

/**
 * A responsiveness failure that is only about time (slower than the old side, over the budget) is reported, not
 * counted: two replays of the same build on the same runner disagreed on which controls were slow (ag-grid: 4 of 4
 * timed controls, realworld: 2 links). A first interaction that fetches code is counted; it does not depend on time.
 * So is a motion's duration, not its shape: two runs of shadcn-admin on one Markless commit timed the sidebar's
 * width animation at 1286 and 1801 ms.
 */
export function timingOnly(failure: Pick<FailureRecord, 'dimension' | 'actual' | 'check'>): boolean {
	// The checker gave up on a control after 1.5 s: a busy runner, not a different page (alpinejs-dev /plugins/persist).
	if (/could not be used: timeout: /.test(failure.actual ?? '')) return true;
	if (failure.dimension === 'motion') return / motion timing of /.test(failure.check);
	return failure.dimension === 'responsiveness' && !/fetched code on the first interaction/.test(failure.actual ?? '');
}

/**
 * What makes two failures the same failure: dimension, viewport and check. The checker's id also hashes the
 * expected and actual text, which carries measured numbers and a nearest-element description that move between
 * replays of one build (alpinejs-dev /start-here: the same screenshot difference "first near html" in one run and
 * "first near path" in the other).
 */
export function failureKey(failure: Pick<FailureRecord, 'dimension' | 'check' | 'viewport'>): string {
	return `${failure.dimension}|${failure.viewport ?? ''}|${failure.check}`;
}

function heavier(now: number, before: number): boolean {
	return now > before + Math.max(WEIGHT_SLACK.bytes, before * WEIGHT_SLACK.ratio);
}

export function compareSuite(suite: Suite, result: SuiteResult | undefined, baseline: Baseline | undefined): Omit<SuiteComparison, 'quarantined'> {
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
		const known = new Set(before.failures.map(failureKey));
		const added = record.failures.filter((f) => !known.has(failureKey(f)));
		const uncounted = (f: FailureRecord) => timingOnly(f) || explorationOnly(f, before);
		for (const failure of added.filter(uncounted)) timing.push({ kind: 'failure', route, detail: describe(failure) });
		for (const failure of added.filter((f) => !uncounted(f))) {
			regressions.push({ kind: 'failure', route, detail: describe(failure) });
		}
		if (record.weight && before.weight) {
			for (const field of ['downloaded', 'executed'] as const) {
				if (heavier(record.weight[field], before.weight[field])) regressions.push({ kind: 'weight', route, detail: `JavaScript ${field} at load ${record.weight[field]} bytes, main ${before.weight[field]}` });
			}
		}
		if (record.ok && !before.ok) fixed.push(route);
		if (!record.ok && !before.ok && !added.some((f) => !uncounted(f))) knownReds.push({ route, owner: before.owner ?? suite.owner, dimensions: [...new Set(before.failures.map((f) => f.dimension))] });
	}
	if (baseline) {
		for (const route of Object.keys(baseline.routes)) {
			if (!(route in result.routes) && result.steps.check === 'pass' && Object.keys(result.routes).length) {
				// A route of the lane the checker did not report at all.
				if (Object.keys(baseline.routes).length && routeExpected(suite, result, route)) regressions.push({ kind: 'route', route, detail: 'the checker reported nothing for this route' });
			}
		}
		const knownMisses = new Set(baseline.misses.map(missEndpoint));
		const oldOrigin = new URL(suite.old).origin;
		for (const miss of result.seal.misses) {
			if (knownMisses.has(missEndpoint(miss)) || SOURCE_MAP.test(miss)) continue;
			// The old site is only ever asked by the checker exploring it, never by the Markless build.
			if (missUrl(miss)?.origin === oldOrigin) timing.push({ kind: 'capture', detail: `the old site was asked for a page the capture does not hold: ${miss}` });
			else regressions.push({ kind: 'capture', detail: `a request main does not make, not in the capture: ${miss}` });
		}
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

/** Holds quarantined checks' regressions out of the count; an expired quarantine entry is itself a regression. */
export function applyQuarantine(comparison: Omit<SuiteComparison, 'quarantined'>, now = new Date()): SuiteComparison {
	const entries = comparison.suite.quarantine ?? [];
	const today = now.toISOString().slice(0, 10);
	const expired = entries.filter((q) => today > q.until);
	const live = entries.filter((q) => today <= q.until);
	const held = (r: Regression) =>
		live.some((q) => {
			if (q.dimension === 'capture') return r.kind === 'capture' && r.detail.includes(q.check);
			if ((q.route !== '*' && q.route !== r.route) || (r.kind !== 'failure' && r.kind !== 'weight')) return false;
			if (q.dimension === 'weight') return r.kind === 'weight' && r.detail.startsWith(q.check);
			if (q.dimension === '*') return true;
			return r.kind === 'failure' && r.detail.startsWith(q.dimension) && r.detail.includes(`: ${q.check}`);
		});
	return {
		...comparison,
		regressions: [...comparison.regressions.filter((r) => !held(r)), ...expired.map((q) => ({ kind: 'step' as const, route: q.route, detail: `the quarantine of ${q.dimension} "${q.check}" (owner ${q.owner}) expired on ${q.until}: fix the nondeterminism or remove the entry` }))],
		quarantined: comparison.regressions.filter(held),
	};
}

export function compareAll(suites: readonly Suite[], results: readonly SuiteResult[], baseline: Map<string, Baseline>, now = new Date()): Comparison {
	const compared = suites.map((suite) => applyQuarantine(compareSuite(suite, results.find((r) => r.suite === suite.name), baseline.get(suite.name)), now));
	return { suites: compared, regressed: compared.some((c) => c.regressions.length > 0) };
}
