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
	// The importer copies the old site's static files and the assets its pages reference into public/, which the app
	// does not commit; without them every image on the port was broken (nightly run 41125479602).
	snapshot: {
		url: 'https://github.com/compiled-run/markless-migrate/releases/download/docusaurus-imported-35a783ef/docusaurus-markless-imported.tar.gz',
		sha256: '071abe08244f35b59a281a00868be0ed55bb2fd86a329fd356649ab11c980559',
	},
	prepare: [['node', 'scripts/keep-routes.mjs', ...routes.map((r) => r.route)]],
	// The other suites' checker (migrate.json's pin) has no slow-network step; this one measures it in Chromium, Firefox
	// and WebKit, and a runner here installs Chromium only, so the check refused to start (record run 41104185267).
	// /showcase (545 kB of HTML, over 260 images) ran past the default 1800 s per route in nightly run 41146912409;
	// its shard with /changelog took 1991 to 2106 s in record run 41134796137.
	check: ['--no-slow-network', '--timeout', '3000'],
	quarantine: [
		{
			route: '/showcase',
			dimension: "rendered (mobile)",
			check: "accessibility tree",
			reason: "in one of two replays of one build in record run 41134796137, 8 showcase card images near the bottom of the 85,000 px mobile page had no name yet (the lazy image had not swapped in); the other replay matched",
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/showcase',
			dimension: "css (mobile)",
			check: "computed style of generic (main>list>listitem/div)",
			reason: "in one of two replays of one build in record run 41134796137, 8 showcase cards near the bottom still had the lazy image's blurred placeholder as background-image; the other replay matched",
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/showcase',
			dimension: "assets (mobile)",
			check: "image #",
			reason: "in one of two replays of one build in record run 41134796137, 4 showcase images near the bottom of the mobile page had not loaded when the checker read them; the other replay matched",
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/showcase',
			dimension: "visual (mobile)",
			check: "screenshot",
			reason: "in one of two replays of one build in record run 41134796137, 77442 pixels (0.22%) differed around those cards at y=75655..85192; the other replay matched",
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/blog',
			dimension: 'navigation',
			check: 'in place from /',
			reason: 'in one of two replays of one build in record run 41109495577, 4 or 5 frames during the in-place swap from / showed a layout of neither page (aside, main and footer boxes); the other replay matched',
			owner: 'markless-migrate docusaurus port (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/docs/installation',
			dimension: 'navigation',
			check: 'in place from /changelog',
			reason: 'in one of two replays of one build in record run 41109495577, 4 frames during the in-place swap from /changelog showed a footer and bottom where neither page has them; the other replay matched',
			owner: 'markless-migrate docusaurus port (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/blog/releases/3.10',
			dimension: 'css',
			check: 'computed style in :hover on',
			reason: "the margins of a generic body/div read 70px in one replay and 0px in the other while hovering .close and .footer__link-item (record run 41109495577), and .table-of-contents__link the other way round (nightly run 41146912409)",
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/docs',
			dimension: 'visual',
			check: 'screenshot in :hover on .close',
			reason: 'in one of two replays of one build in record run 41109495577, 558454 pixels differed around the hovered close button; the other replay matched',
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/docs/category/getting-started',
			dimension: 'a11y',
			check: 'menu button keys on button "Canary 🚧"',
			reason: 'the two replays of one build in record run 41109495577 failed at different steps of this keyboard journey (step 3 in one, step 6 in the other)',
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
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
