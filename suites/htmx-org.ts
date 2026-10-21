import type { Suite } from '../src/types.ts';
import full from './routes/htmx-org.json' with { type: 'json' };

export default {
	name: 'htmx-org',
	app: 'examples/htmx-org-markless',
	old: 'https://htmx.org',
	owner: 'markless-migrate htmx-org port (thejackshelton)',
	routes: {
		sample: [
			{ route: '/', covers: ['menu'] },
			{ route: '/docs/', covers: ['big page'] },
			{ route: '/examples/click-to-edit/', covers: ['page script', 'keyed list'] },
			{ route: '/attributes/hx-indicator/', covers: ['page script'] },
		],
		full,
	},
} satisfies Suite;
