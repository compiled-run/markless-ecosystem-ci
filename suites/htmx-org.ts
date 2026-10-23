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
