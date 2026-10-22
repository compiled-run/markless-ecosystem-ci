import type { Suite } from '../src/types.ts';
import full from './routes/alpinejs-dev.json' with { type: 'json' };

export default {
	name: 'alpinejs-dev',
	app: 'examples/alpinejs-dev-markless',
	old: 'https://alpinejs.dev',
	owner: 'markless-migrate alpinejs-dev port (thejackshelton)',
	quarantine: [
		{
			route: "/directives/model",
			dimension: "navigation",
			check: "in place from /plugins/persist",
			reason: "the in-place navigation screenshot of /directives/model differed from a fresh load by 62810 pixels in two of four runs on one Markless main commit (nightly 39712615980, push run 39723932651) and matched in the others",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-05",
		},
		{
			route: "*",
			dimension: "capture",
			check: "https://fastly.picsum.photos/",
			reason: "the carousel and image demos load random picsum.photos images, a different image id on each load (nightly run 39712615980 asked for two ids the capture run did not)",
			owner: "markless-migrate alpinejs-dev port (thejackshelton)",
			until: "2026-11-05",
		},
		{
			route: "/components",
			dimension: "navigation",
			check: "in place from /directives/model",
			reason: "in one of two replays of one build (record run 39639553380), the in-place navigation screenshot differed from a fresh load by 37601 pixels",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-04",
		},
		{
			route: "/plugins/persist",
			dimension: "css",
			check: "computed style of link \"$persist\"",
			reason: "in one of two replays of one build (record run 39639553380), the sidebar link's computed colour differed",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-04",
		},
	],
	routes: {
		sample: [
			{ route: '/directives/model', covers: ['big page', 'page script'] },
			{ route: '/start-here', covers: ['menu', 'keyed list', 'page script'] },
			{ route: '/components', covers: ['dialog'] },
			{ route: '/plugins/persist', covers: ['idle or visible handler'] },
			{ route: '/essentials/templating', covers: ['in-place navigation', 'keyed list'] },
		],
		full,
	},
} satisfies Suite;
