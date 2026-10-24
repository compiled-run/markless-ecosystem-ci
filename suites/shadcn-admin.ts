import type { Suite } from '../src/types.ts';
import full from './routes/shadcn-admin.json' with { type: 'json' };

export default {
	name: 'shadcn-admin',
	app: 'examples/shadcn-admin-markless',
	old: 'https://mm-shadcn-admin-old.vercel.app',
	owner: 'markless-migrate shadcn-admin port (thejackshelton)',
	install: ['--legacy-peer-deps'],
	quarantine: [
		{
			route: "/users",
			dimension: "a11y",
			check: "motion under prefers-reduced-motion",
			reason: "the transitions still running under prefers-reduced-motion differed between two main runs on 2026-10-24 (40102414697 clean, 40103772413 padding-left and padding-right): it depends on which interaction the checker ran before sampling; out when markless-migrate picks interactions deterministically (compiled-run/markless-migrate#108)",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-07",
		},
		{
			route: "/",
			dimension: "visual",
			check: "screenshot in viewport width 1024px",
			reason: "red in one of four sample runs of builds with the same / (nightly runs 39658669659 and 39662326118 clean, 39662760853 367 pixels apart at the forced 1024 px width; the page draws its charts at load)",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-04",
		},
		{
			route: "/settings/appearance",
			dimension: "a11y",
			check: "motion under prefers-reduced-motion",
			reason: "in one of two replays of one build (record run 39639553380), a margin-bottom transition was still running under reduced motion",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-04",
		},
	],
	routes: {
		sample: [
			{ route: '/', covers: ['in-place navigation', 'menu', 'theme class'] },
			{ route: '/users', covers: ['dialog', 'menu', 'big page'] },
			{ route: '/apps', covers: ['keyed list'] },
			{ route: '/settings/account', covers: ['idle or visible handler', 'keyed list'] },
			{ route: '/settings/appearance', covers: ['theme class', 'idle or visible handler'] },
		],
		full,
	},
} satisfies Suite;
