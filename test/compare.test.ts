import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyQuarantine, compareSuite, type Baseline } from '../src/compare.ts';
import type { RouteRecord, Suite, SuiteResult } from '../src/types.ts';

const suite: Suite = { name: 'site', app: 'examples/site', old: 'https://old.example', owner: 'the port', routes: { sample: [{ route: '/', covers: ['menu'] }, { route: '/b', covers: ['dialog'] }], full: ['/', '/b'] } };

function route(ok: boolean, ids: string[], downloaded = 10_000): RouteRecord {
	return { ok, dimensions: {}, failures: ids.map((id) => ({ id, dimension: id.split(':')[0]!, check: id })), weight: { downloaded, executed: downloaded / 2 } };
}

function result(routes: Record<string, RouteRecord>, overrides: Partial<SuiteResult> = {}): SuiteResult {
	return {
		suite: 'site',
		lane: 'sample',
		markless: { sha: 'pr', version: '0.8.0' },
		migrate: { sha: 'mm' },
		startedAt: '2026-10-21T00:00:00Z',
		steps: { install: 'pass', build: 'pass', test: 'skipped', serve: 'pass', check: 'pass' },
		timings: {},
		routes,
		seal: { served: 1, loose: 0, misses: [] },
		...overrides,
	};
}

function baseline(routes: Record<string, RouteRecord>, misses: string[] = []): Baseline {
	return {
		suite: 'site',
		lane: 'sample',
		markless: { sha: 'main', version: '0.8.0' },
		migrate: { sha: 'mm' },
		recordedAt: '2026-10-20T00:00:00Z',
		steps: { install: 'pass', build: 'pass', test: 'skipped', serve: 'pass', check: 'pass' },
		routes: Object.fromEntries(Object.entries(routes).map(([k, r]) => [k, { ok: r.ok, failures: r.failures, ...(r.weight ? { weight: r.weight } : {}), ...(r.ok ? {} : { owner: 'the port' }) }])),
		misses,
	};
}

describe('compareSuite', () => {
	test('a red main already has is a known red with its owner, not a regression', () => {
		const c = compareSuite(suite, result({ '/': route(false, ['behaviour:a']), '/b': route(true, []) }), baseline({ '/': route(false, ['behaviour:a']), '/b': route(true, []) }));
		assert.equal(c.regressions.length, 0);
		assert.deepEqual(c.knownReds, [{ route: '/', owner: 'the port', dimensions: ['behaviour'] }]);
	});

	test('a failure main does not have is a regression, even on a route that was already red', () => {
		const c = compareSuite(suite, result({ '/': route(false, ['behaviour:a', 'http:b']), '/b': route(false, ['visual:c']) }), baseline({ '/': route(false, ['behaviour:a']), '/b': route(true, []) }));
		assert.deepEqual(
			c.regressions.map((r) => `${r.kind} ${r.route} ${r.detail}`),
			['failure / http: http:b', 'failure /b visual: visual:c'],
		);
	});

	test('a build that passed on main and fails here is a regression', () => {
		const c = compareSuite(suite, result({}, { steps: { install: 'pass', build: 'fail', test: 'skipped', serve: 'skipped', check: 'skipped' }, error: 'vp build exited 1' }), baseline({ '/': route(true, []) }));
		assert.equal(c.regressions[0]!.kind, 'step');
		assert.match(c.regressions[0]!.detail, /build failed, it passed on main: vp build exited 1/);
	});

	test('JavaScript at load may move by the slack, not more', () => {
		const within = compareSuite(suite, result({ '/': route(true, [], 11_000), '/b': route(true, []) }), baseline({ '/': route(true, [], 10_000), '/b': route(true, []) }));
		assert.equal(within.regressions.length, 0);
		const over = compareSuite(suite, result({ '/': route(true, [], 1_500_000), '/b': route(true, []) }), baseline({ '/': route(true, [], 10_000), '/b': route(true, []) }));
		assert.deepEqual(over.regressions.map((r) => r.kind), ['weight', 'weight']);
	});

	test('a request main never made is a regression; one it made is not', () => {
		const c = compareSuite(suite, result({ '/': route(true, []), '/b': route(true, []) }, { seal: { served: 1, loose: 0, misses: ['GET https://a.example/old', 'GET https://a.example/new'] } }), baseline({ '/': route(true, []), '/b': route(true, []) }, ['GET https://a.example/old']));
		assert.deepEqual(c.regressions.map((r) => r.detail), ['a request main does not make, not in the capture: GET https://a.example/new']);
	});

	test('a route main checked and this run could not is a regression', () => {
		const notChecked: RouteRecord = { ...route(false, []), infrastructure: 'NEW: timeout' };
		const c = compareSuite(suite, result({ '/': notChecked, '/b': route(true, []) }), baseline({ '/': route(true, []), '/b': route(true, []) }));
		assert.deepEqual(c.regressions.map((r) => `${r.kind} ${r.route}`), ['route /']);
	});

	test('a suite with no result is a regression; a green route that was red is reported as fixed', () => {
		assert.equal(compareSuite(suite, undefined, undefined).regressions[0]!.kind, 'missing');
		const c = compareSuite(suite, result({ '/': route(true, []), '/b': route(true, []) }), baseline({ '/': route(false, ['behaviour:a']), '/b': route(true, []) }));
		assert.deepEqual(c.fixed, ['/']);
	});
});

describe('timing', () => {
	test('a new timing-only responsiveness failure is shown, not counted; a code fetch on first interaction is counted', () => {
		const slow: RouteRecord = { ok: false, dimensions: {}, failures: [{ id: 't1', dimension: 'responsiveness', check: 'first interaction with button "A" (4x CPU, mobile)', actual: 'new 300 ms; likely cause: x; over the 200 ms budget' }] };
		const fetches: RouteRecord = { ok: false, dimensions: {}, failures: [{ id: 't2', dimension: 'responsiveness', check: 'first interaction with button "B" (4x CPU, mobile)', actual: 'new 40 ms; likely cause: x; fetched code on the first interaction: /a.js (3 kB)' }] };
		const c = compareSuite(suite, result({ '/': slow, '/b': fetches }), baseline({ '/': route(true, []), '/b': route(true, []) }));
		assert.deepEqual(c.timing.map((r) => r.route), ['/']);
		assert.deepEqual(c.regressions.map((r) => r.route), ['/b']);
	});
});

describe('quarantine', () => {
	const flaky: Suite = { ...suite, quarantine: [{ route: '/', dimension: 'visual', check: 'visual:new', reason: 'one of two replays differed', owner: 'someone', until: '2026-11-04' }] };
	const run = () => compareSuite(flaky, result({ '/': route(false, ['visual:new', 'http:other']), '/b': route(true, []) }), baseline({ '/': route(true, []), '/b': route(true, []) }));

	test('holds a quarantined check out of the count until it expires; other checks still count', () => {
		const held = applyQuarantine(run(), new Date('2026-10-25T00:00:00Z'));
		assert.deepEqual(held.regressions.map((r) => r.detail), ['http: http:other']);
		assert.equal(held.quarantined.length, 1);
	});

	test('an expired quarantine fails the run', () => {
		const expired = applyQuarantine(run(), new Date('2026-11-05T00:00:00Z'));
		assert.match(expired.regressions.at(-1)!.detail, /expired on 2026-11-04/);
	});
});

describe('journeys', () => {
	test('on a route main has red on behaviour, a new journey difference is shown, not counted, unless it logged an error', () => {
		const before = route(false, ['behaviour:old']);
		const now: RouteRecord = {
			ok: false,
			dimensions: {},
			failures: [
				{ id: 'behaviour:old', dimension: 'behaviour', check: 'behaviour:old' },
				{ id: 'j1', dimension: 'behaviour', check: 'click button "A"', actual: 'appears: - dialog' },
				{ id: 'j2', dimension: 'behaviour', check: 'follow link "Home"', actual: "console errors: Cannot set properties of null (setting 'textContent')" },
			],
		};
		const c = compareSuite(suite, result({ '/': now, '/b': route(true, []) }), baseline({ '/': before, '/b': route(true, []) }));
		assert.deepEqual(c.regressions.map((r) => r.detail.split(';')[0]), ['behaviour: follow link "Home"']);
		assert.deepEqual(c.timing.map((r) => r.detail.split(';')[0]), ['behaviour: click button "A"']);
	});
});
