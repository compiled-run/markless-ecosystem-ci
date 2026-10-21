import type { Suite } from '../src/types.ts';
import full from './routes/ag-grid.json' with { type: 'json' };

export default {
	name: 'ag-grid',
	app: 'examples/ag-grid-markless',
	old: 'https://mm-ag-grid-old.vercel.app',
	owner: 'markless-migrate ag-grid port (thejackshelton)',
	install: ['--legacy-peer-deps'],
	routes: {
		sample: [
			{ route: '/', covers: ['big page', 'keyed list', 'menu', 'idle or visible handler', 'theme class'] },
		],
		full,
	},
} satisfies Suite;
