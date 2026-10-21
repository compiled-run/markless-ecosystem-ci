import type { Suite } from '../src/types.ts';
import full from './routes/shadcn-admin.json' with { type: 'json' };

export default {
	name: 'shadcn-admin',
	app: 'examples/shadcn-admin-markless',
	old: 'https://mm-shadcn-admin-old.vercel.app',
	owner: 'markless-migrate shadcn-admin port (thejackshelton)',
	install: ['--legacy-peer-deps'],
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
