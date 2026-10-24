import type { Suite } from '../src/types.ts';
import full from './routes/htmx-org.json' with { type: 'json' };

export default {
	name: 'htmx-org',
	app: 'examples/htmx-org-markless',
	old: 'https://htmx.org',
	owner: 'markless-migrate htmx-org port (thejackshelton)',
	quarantine: [
		{
			route: "*",
			dimension: "a11y",
			check: "type \"Sample text from markless-migrate\" into textbox, then press Enter on link",
			reason: "the checker presses Enter on a different search-result link each run (htmx-1-compat, then sse) and the old site's link drops or keeps the trailing slash per page; the row tracks which link was chosen, not Markless (2026-10-24 main runs 40102414697 and 40103772413); out when markless-migrate picks interactions deterministically (compiled-run/markless-migrate#108)",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-07",
		},
		{
			route: "*",
			dimension: "capture",
			check: "https://github.githubassets.com/",
			reason: "GitHub's own page assets, asked for only when a replay's step reaches github.com through the star button; the set differed between two replays of one build (record run 39988033492: 9 in the first, 1 other in the second)",
			owner: "markless-migrate htmx-org port (thejackshelton)",
			until: "2026-11-06",
		},
		{
			route: "/examples/click-to-edit/",
			dimension: "behaviour",
			check: "browser storage after the page loads",
			reason: "htmx's own history key (sessionStorage htmx-current-path-for-history), which the port rightly does not write, was read in one replay of one build and not the other (record run 39988033492); the checker is learning to leave htmx's internal state out",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-06",
		},
		{
			route: "/examples/click-to-edit/",
			dimension: "behaviour",
			check: "click button \"Click To Edit\", then type *",
			reason: "the demo's request log after typing differed between two replays of one build (record run 39988033492): one entry when the step's read landed after htmx.org's fake server answered, none before",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-06",
		},
	],
	routes: {
		sample: [
			{ route: '/', covers: ['menu'] },
			{ route: '/docs/', covers: ['big page'] },
			{ route: '/examples/click-to-edit/', covers: ['page script', 'keyed list'] },
			{ route: '/attributes/hx-indicator/', covers: ['page script'] },
		],
		full,
	},
} satisfies Suite;
