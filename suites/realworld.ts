import type { Suite } from '../src/types.ts';
import full from './routes/realworld.json' with { type: 'json' };

export default {
	name: 'realworld',
	app: 'examples/realworld-markless',
	// The pin plus markless-migrate #768: its element() handles that may be missing say | undefined (Markless #1203).
	migrateRef: '82eb9a02c1a06413e0bc29974a1a7c5580924a71',
	old: 'https://mm-realworld-old.vercel.app',
	owner: 'markless-migrate realworld port (thejackshelton)',
	env: {
		API_ORIGIN: 'https://mm-realworld-api.vercel.app',
	},
	routes: {
		sample: [
			{ route: '/', covers: ['in-place navigation', 'idle or visible handler', 'keyed list'] },
			{ route: '/article/Notes-from-a-hackathon-16449bd5', covers: ['idle or visible handler'] },
			{ route: '/profile/ada', covers: ['in-place navigation'] },
			{ route: '/tag/dragons', covers: ['in-place navigation'] },
		],
		full,
	},
} satisfies Suite;
