import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyQuarantine, compareSuite, rememberBaseline, type Baseline } from '../src/compare.ts';
import type { RouteRecord, Suite, SuiteResult } from '../src/types.ts';
import docusaurus from '../suites/docusaurus.ts';
import htmx from '../suites/htmx-org.ts';
import shadcnAdmin from '../suites/shadcn-admin.ts';

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

describe('capture misses', () => {
	test('a beacon main already sent is known whatever session id or body it carries; a new endpoint still counts', () => {
		const known = ['POST https://www.youtube-nocookie.com/api/stats/qoe?cpn=AAA&el=embedded #1111', 'POST https://www.youtube-nocookie.com/youtubei/v1/log_event?alt=json #2222'];
		const seen = ['POST https://www.youtube-nocookie.com/api/stats/qoe?cpn=BBB&el=embedded #3333', 'POST https://www.youtube-nocookie.com/youtubei/v1/log_event?alt=json #4444', 'POST https://www.youtube-nocookie.com/youtubei/v1/new_endpoint #5555'];
		const c = compareSuite(suite, result({ '/': route(true, []), '/b': route(true, []) }, { seal: { served: 1, loose: 0, misses: seen } }), baseline({ '/': route(true, []), '/b': route(true, []) }, known));
		assert.deepEqual(c.regressions.map((r) => r.detail), ['a request main does not make, not in the capture: POST https://www.youtube-nocookie.com/youtubei/v1/new_endpoint #5555']);
	});

	test('a miss on the old site is shown, not counted; a new third-party request still counts', () => {
		const c = compareSuite(suite, result({ '/': route(true, []), '/b': route(true, []) }, { seal: { served: 1, loose: 0, misses: ['GET https://old.example/other-page ;session', 'GET https://cdn.example/new.js'] } }), baseline({ '/': route(true, []), '/b': route(true, []) }));
		assert.deepEqual(c.regressions.map((r) => r.detail), ['a request main does not make, not in the capture: GET https://cdn.example/new.js']);
		assert.equal(c.timing.length, 1);
	});
});

describe('baseline memory', () => {
	const at = (date: string, ids: string[]): Baseline => ({ ...baseline({ '/': route(false, ids), '/b': route(true, []) }), recordedAt: date });

	test('a failure an earlier main run showed within a week is still known; an older one is dropped', () => {
		const first = rememberBaseline(at('2026-10-20T03:00:00Z', ['a11y:keys']), undefined);
		const second = rememberBaseline(at('2026-10-21T03:00:00Z', ['behaviour:x']), first);
		assert.deepEqual(second.routes['/']!.failures.map((f) => f.id).sort(), ['a11y:keys', 'behaviour:x']);
		const c = compareSuite(suite, result({ '/': route(false, ['a11y:keys']), '/b': route(true, []) }), second);
		assert.equal(c.regressions.length, 0);
		const later = rememberBaseline(at('2026-10-29T03:00:00Z', ['behaviour:x']), second);
		assert.deepEqual(later.routes['/']!.failures.map((f) => f.id), ['behaviour:x']);
	});
});

describe('checker timeouts', () => {
	test('a control the checker gave up on after its own timeout is shown, not counted', () => {
		const now: RouteRecord = { ok: false, dimensions: {}, failures: [{ id: 'k', dimension: 'a11y', check: 'press Enter on link "#"', actual: 'link "#" could not be used: timeout: locator.focus: Timeout 1500ms exceeded.' }] };
		const c = compareSuite(suite, result({ '/': now, '/b': route(true, []) }), baseline({ '/': route(true, []), '/b': route(true, []) }));
		assert.equal(c.regressions.length, 0);
		assert.equal(c.timing.length, 1);
	});
});

describe('the journey-choice quarantine (compiled-run/markless-migrate#108)', () => {
	const hold = (target: Suite, regressions: { route: string; detail: string }[]) =>
		applyQuarantine({ suite: target, regressions: regressions.map((r) => ({ kind: 'failure' as const, ...r })), timing: [], fixed: [], knownReds: [] } as never, new Date('2026-10-25T00:00:00Z'));
	test('holds the rows that track which interactions the checker chose, and nothing beside them', () => {
		const docs = hold(docusaurus, [
			{ route: '/docs', detail: 'behaviour: click tab "Yarn" (step 4 of 5: reload after use 3); expected old console errors: registerSW failed TypeError: Cannot read properties of undefined' },
			{ route: '/', detail: 'a11y: press Enter on link "Skip to main content"; expected console errors: (none), got console errors: Failed to fetch dynamically imported module: /vendor/docsearch-4.7.0.js' },
			{ route: '/', detail: 'a11y: press Enter on link "Skip to main content"; expected console errors: (none), got console errors: Missing markless/state payload script.' },
		]);
		assert.equal(docs.quarantined.length, 2);
		assert.deepEqual(docs.regressions.map((r) => r.detail), ['a11y: press Enter on link "Skip to main content"; expected console errors: (none), got console errors: Missing markless/state payload script.']);
		const links = hold(htmx, [
			{ route: '/docs/', detail: 'a11y: type "Sample text from markless-migrate" into textbox, then press Enter on link "sse" (step 2); expected URL /extensions/sse, got URL /extensions/sse/' },
			{ route: '/', detail: 'navigation (desktop): in place from /examples/click-to-edit/: layout during the swap; expected every frame shows the page before or the page after' },
		]);
		assert.equal(links.quarantined.length, 1);
		assert.equal(links.regressions.length, 1);
		const motion = hold(shadcnAdmin, [
			{ route: '/users', detail: 'a11y (desktop): motion under prefers-reduced-motion: reduce; expected color, left, opacity, width, got running: padding-left, padding-right' },
			{ route: '/apps', detail: 'a11y (desktop): motion under prefers-reduced-motion: reduce; expected none, got running: width' },
		]);
		assert.equal(motion.quarantined.length, 1);
		assert.equal(motion.regressions.length, 1);
		const showcase = hold(docusaurus, [
			{ route: '/showcase', detail: 'rendered (mobile): accessibility tree; expected       - img "Svix", got       - img' },
			{ route: '/showcase', detail: 'rendered (desktop): accessibility tree; expected       - heading "Showcase" [level=1], got (absent)' },
		]);
		assert.deepEqual(showcase.regressions.map((r) => r.detail), ['rendered (desktop): accessibility tree; expected       - heading "Showcase" [level=1], got (absent)']);
		const weight = applyQuarantine({ suite: docusaurus, regressions: [
			{ kind: 'weight' as const, route: '/blog/releases/3.10', detail: 'JavaScript executed at load 106167 bytes, main 97437' },
			{ kind: 'weight' as const, route: '/blog/releases/3.10', detail: 'JavaScript downloaded at load 186167 bytes, main 177437' },
		], timing: [], fixed: [], knownReds: [] } as never, new Date('2026-10-31T00:00:00Z'));
		assert.deepEqual(weight.regressions.map((r) => r.detail), ['JavaScript downloaded at load 186167 bytes, main 177437']);
	});
});
