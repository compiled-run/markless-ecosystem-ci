import type { Suite } from '../src/types.ts';
import full from './routes/remix-notes.json' with { type: 'json' };

export default {
	name: 'remix-notes',
	app: 'examples/remix-notes-markless',
	old: 'https://mm-remix-notes-old.vercel.app',
	owner: 'markless-migrate remix-notes port (thejackshelton)',
	serveEnv: { NODE_ENV: 'production' },
	env: {
		SESSION_SECRET: 'super-duper-s3cret',
		DATABASE_PATH: 'data/notes.db',
		SIGNED_IN_EMAIL: 'rachel@remix.run',
		SIGNED_IN_PASSWORD: 'racheliscool',
	},
	check: ['--auth', 'migrate-auth.json', '--concurrency', '1'],
	routes: {
		sample: [
			{ route: '/', covers: ['in-place navigation'] },
			{ route: '/notes', covers: ['streaming', 'keyed list'] },
			{ route: '/notes/cmvcee9oe0002ag8afyyiylz8', covers: ['streaming', 'in-place navigation'] },
		],
		full,
	},
} satisfies Suite;
