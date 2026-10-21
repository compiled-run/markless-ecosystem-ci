import type { Suite } from '../src/types.ts';
import full from './routes/next-dashboard.json' with { type: 'json' };

export default {
	name: 'next-dashboard',
	app: 'examples/next-dashboard-markless',
	old: 'https://mm-next-dashboard-old.vercel.app',
	owner: 'markless-migrate next-dashboard port (thejackshelton)',
	env: {
		EMBEDDED_POSTGRES: '1',
		AUTH_SECRET: 'markless-ecosystem-ci-not-a-secret',
		AUTH_TRUST_HOST: 'true',
		SIGNED_IN_EMAIL: 'user@nextmail.com',
		SIGNED_IN_PASSWORD: '123456',
	},
	// The node build does not copy PGlite's data, wasm and extension files beside the server code that loads them.
	build: [
		['npm', 'run', 'build'],
		['sh', '-c', 'for d in .output/server .output/server/_libs; do cp node_modules/@electric-sql/pglite/dist/*.data node_modules/@electric-sql/pglite/dist/*.wasm node_modules/@electric-sql/pglite/dist/*.tar.gz "$d/"; done'],
	],
	check: ['--auth', 'migrate-auth.json'],
	routes: {
		sample: [
			{ route: '/', covers: ['in-place navigation'] },
			{ route: '/dashboard/invoices', covers: ['streaming', 'keyed list', 'in-place navigation'] },
			{ route: '/dashboard/customers', covers: ['streaming', 'keyed list'] },
		],
		full,
	},
} satisfies Suite;
