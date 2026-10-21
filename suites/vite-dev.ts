import type { Suite } from '../src/types.ts';
import full from './routes/vite-dev.json' with { type: 'json' };

export default {
	name: 'vite-dev',
	app: 'examples/vite-dev-markless',
	old: 'https://vite-dev-old.vercel.app',
	owner: 'markless-migrate vite-dev port (thejackshelton)',
	routes: {
		sample: [
			{ route: '/', covers: ['page script', 'keyed list', 'theme class', 'menu'] },
			{ route: '/guide/', covers: ['theme class', 'dialog', 'menu'] },
			{ route: '/guide/features', covers: ['in-place navigation'] },
			{ route: '/config/build-options', covers: ['big page'] },
			{ route: '/live', covers: ['page script'] },
		],
		full,
	},
} satisfies Suite;
