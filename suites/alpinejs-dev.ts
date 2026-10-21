import type { Suite } from '../src/types.ts';
import full from './routes/alpinejs-dev.json' with { type: 'json' };

export default {
	name: 'alpinejs-dev',
	app: 'examples/alpinejs-dev-markless',
	old: 'https://alpinejs.dev',
	owner: 'markless-migrate alpinejs-dev port (thejackshelton)',
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
