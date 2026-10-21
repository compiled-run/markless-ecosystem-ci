import type { Suite } from '../src/types.ts';
import full from './routes/docusaurus.json' with { type: 'json' };

export default {
	name: 'docusaurus',
	app: 'examples/docusaurus-markless',
	old: 'https://mm-docusaurus-old.vercel.app',
	owner: 'markless-migrate docusaurus port (thejackshelton)',
	routes: {
		sample: [
			{ route: '/', covers: ['theme class', 'menu', 'idle or visible handler'] },
			{ route: '/docs', covers: ['big page', 'in-place navigation', 'theme class'] },
			{ route: '/docs/installation', covers: ['in-place navigation', 'dialog'] },
		],
		full,
	},
} satisfies Suite;
