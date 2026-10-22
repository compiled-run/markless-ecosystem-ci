import type { Suite } from '../src/types.ts';
import full from './routes/vite-site.json' with { type: 'json' };

export default {
	name: 'vite-site',
	app: 'examples/vite-site-markless',
	old: 'https://migrate-demo-old.vercel.app',
	owner: 'markless-migrate vite-site port (thejackshelton)',
	env: {
		CMS_URL: 'https://migrate-demo-cms.vercel.app',
	},
	routes: {
		sample: [
			{ route: '/', covers: ['menu', 'keyed list', 'idle or visible handler'] },
			{ route: '/about/', covers: ['idle or visible handler'] },
			{ route: '/ar/', covers: ['in-place navigation'] },
			{ route: '/fr/', covers: ['menu'] },
		],
		full,
	},
} satisfies Suite;
