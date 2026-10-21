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
	disabled: "the port is on Markless 0.5.0 and its document.tsrx does not build on 0.8 (TSRX2011: a code block renders a single node), the TSRX change 0.8 made on purpose; it runs again once the markless-migrate port moves to 0.8",
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
