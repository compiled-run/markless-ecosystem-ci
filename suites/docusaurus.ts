import type { Suite } from '../src/types.ts';
import full from './routes/docusaurus.json' with { type: 'json' };

export default {
	name: 'docusaurus',
	app: 'examples/docusaurus-markless',
	old: 'https://mm-docusaurus-old.vercel.app',
	owner: 'markless-migrate docusaurus port (thejackshelton)',
	quarantine: [
		{
			route: "/docs/installation",
			dimension: "visual",
			check: "screenshot in :hover on .breadcrumbs__link",
			reason: "in one of two replays of one build (record run 39639553380), 1593 pixels differed around the hovered breadcrumb",
			owner: "markless-migrate checker (thejackshelton)",
			until: "2026-11-04",
		},
	],
	routes: {
		sample: [
			{ route: '/', covers: ['theme class', 'menu', 'idle or visible handler'] },
			{ route: '/docs', covers: ['big page', 'in-place navigation', 'theme class'] },
			{ route: '/docs/installation', covers: ['in-place navigation', 'dialog'] },
		],
		full,
	},
} satisfies Suite;
