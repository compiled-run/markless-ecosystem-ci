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
