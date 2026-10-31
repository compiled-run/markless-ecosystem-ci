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
			route: '*',
			dimension: 'capture',
			check: 'https://github.githubassets.com/',
			reason: "GitHub's own page assets, asked for only when a step reaches github.com from the page; the set differed between runs of one Markless commit (primer CSS and relative-time-element in nightly run 41152042165, react-reconciler in compiled-run/markless run 41172808607), as on htmx-org",
			owner: 'markless-migrate docusaurus port (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: "*",
			dimension: "a11y",
			check: "menu button keys on button",
			reason: "the navbar's Canary 🚧 and English menu-button keyboard journeys are red on main, but which route reports them, and at which step, moved between runs of one Markless commit: / and /docs/category/getting-started at steps 3 and 6 in record run 41109495577, / and /blog at step 5 in nightly run 41152042165, /, /blog, /docs/category/getting-started and /showcase at steps 1 and 6 in compiled-run/markless run 41159890776. A shared-layout control is exercised by the first route of a job that has it and the others carry its result",
			owner: "markless-migrate checker (thejackshelton)",
			until: '2026-11-13',
		},
		{
			route: "*",
			dimension: "motion",
			check: "click button \"Switch between dark and light mode (currently system mode)\"",
			reason: "the theme toggle's kbd Ctrl colour motion, red on / on main, was reported on /blog/releases/3.10 (in the layout shared with /docs) in compiled-run/markless run 41159890776: the route that carries a shared-layout control's result moves between runs",
			owner: "markless-migrate checker (thejackshelton)",
			until: '2026-11-13',
		},
		{
			route: '*',
			dimension: 'weight',
			check: 'JavaScript executed',
			reason: "code run at load moved by up to about 9 kB between loads of one build (98413 vs 106607 bytes on / in record run 41109495577, 97437 vs 106167 on /blog/releases/3.10 against main in run compiled-run/markless 41155469182). Locally at 6x CPU, 2 of 10 loads of /blog/releases/3.10 dispatch the site's onVisible/onIdle boot through the runtime's full event path (3.2 kB more), and a full-page screenshot inside the coverage window wakes below-the-fold onVisible code (5.1 kB more). Downloaded JavaScript stays counted",
			owner: 'Markless runtime (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/showcase',
			dimension: "rendered",
			check: "accessibility tree; expected       - img",
			reason: "lazy-loaded ideal-img images on /showcase (over 260, the page is 85,000 px tall on mobile) had or had not loaded when the checker read the page: an image card had no name yet (mobile in one of two replays of record run 41134796137; desktop in compiled-run/markless run 41167622603 (257 rows, all on /showcase))",
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/showcase',
			dimension: "css",
			check: "computed style",
			reason: "lazy-loaded ideal-img images on /showcase (over 260, the page is 85,000 px tall on mobile) had or had not loaded when the checker read the page: a card still had the lazy image's blurred placeholder as background-image (mobile in one of two replays of record run 41134796137; desktop in compiled-run/markless run 41167622603 (257 rows, all on /showcase))",
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/showcase',
			dimension: "assets",
			check: "image #",
			reason: "lazy-loaded ideal-img images on /showcase (over 260, the page is 85,000 px tall on mobile) had or had not loaded when the checker read the page: an image had not loaded yet (mobile in one of two replays of record run 41134796137; desktop in compiled-run/markless run 41167622603 (257 rows, all on /showcase))",
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/showcase',
			dimension: "visual",
			check: "screenshot",
			reason: "lazy-loaded ideal-img images on /showcase (over 260, the page is 85,000 px tall on mobile) had or had not loaded when the checker read the page: pixels differed around cards whose image had not loaded (mobile in one of two replays of record run 41134796137; desktop in compiled-run/markless run 41167622603 (257 rows, all on /showcase))",
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-13',
		},
		{
			route: '/showcase',
			dimension: "network",
			check: "browser request GET {self}/assets/ideal-img/",
			reason: "lazy-loaded ideal-img images on /showcase (over 260, the page is 85,000 px tall on mobile) had or had not loaded when the checker read the page: an image was requested twice, or once where the baseline had it twice (mobile in one of two replays of record run 41134796137; desktop in compiled-run/markless run 41167622603 (257 rows, all on /showcase))",
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
