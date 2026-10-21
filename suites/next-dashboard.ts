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
