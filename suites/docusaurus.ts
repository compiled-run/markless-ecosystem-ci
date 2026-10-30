import type { Suite, SampleRoute } from '../src/types.ts';

// docusaurus.io: 8 of the port's 484 pages, one per page type. The whole port needs about 30 GB of heap to build, more
// than a runner has, so prepare removes every other page before the build (scripts/keep-routes.mjs).
const routes: SampleRoute[] = [
	{ route: '/', covers: ['theme class', 'menu', 'idle or visible handler'] },
	{ route: '/docs', covers: ['big page', 'in-place navigation', 'theme class'] },
	{ route: '/docs/installation', covers: ['in-place navigation', 'dialog'] },
	{ route: '/docs/category/getting-started', covers: ['in-place navigation'] },
	{ route: '/blog', covers: ['big page', 'in-place navigation'] },
	{ route: '/blog/releases/3.10', covers: ['big page', 'in-place navigation'] },
	{ route: '/changelog', covers: ['big page', 'in-place navigation'] },
	{ route: '/showcase', covers: ['keyed list', 'big page'] },
];

export default {
	name: 'docusaurus',
	app: 'examples/docusaurus-markless',
	old: 'https://mm-docusaurus-old.vercel.app',
	owner: 'markless-migrate docusaurus port (thejackshelton)',
	migrateRef: '7a5706a605309c10003f0435befdc7412d1204c3',
	prepare: [['node', 'scripts/keep-routes.mjs', ...routes.map((r) => r.route)]],
	// The other suites' checker (migrate.json's pin) has no slow-network step; this one measures it in Chromium, Firefox
	// and WebKit, and a runner here installs Chromium only, so the check refused to start (record run 41104185267).
	check: ['--no-slow-network'],
	quarantine: [
		{
			route: "*",
			dimension: "behaviour",
			check: "registerSW failed",
			reason: "the old site's console error from its service worker (registerSW failed: reading 'waiting') is recorded on some steps and not others: the checker reloads after a different use each run (2026-10-24 main runs 40102414697 and 40103772413 differed, and Markless 3db0bca52 shows it too); out when markless-migrate picks interactions deterministically (compiled-run/markless-migrate#108)",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-07",
		},
		{
			route: "*",
			dimension: "a11y",
			check: "Failed to fetch dynamically imported module: /vendor/docsearch-4.7.0.js",
			reason: "the old site's search widget is a dynamic import the capture holds for some journeys only; whether a run's a11y journey reaches it depends on the interactions the checker picks (2026-10-24 main runs 40102414697 and 40103772413, and on Markless 3db0bca52 as an assets row); out when markless-migrate picks interactions deterministically (compiled-run/markless-migrate#108)",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-07",
		},
		{
			route: "/docs/installation",
			dimension: "visual",
			check: "screenshot in :hover on .breadcrumbs__link",
			reason: "in one of two replays of one build (record run 39639553380), 1593 pixels differed around the hovered breadcrumb",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-04",
		},
	],
	routes: { sample: routes, full: routes.map((r) => r.route) },
} satisfies Suite;
