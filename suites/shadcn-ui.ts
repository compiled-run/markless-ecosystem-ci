import type { Suite } from '../src/types.ts';
import full from './routes/shadcn-ui.json' with { type: 'json' };

// ui.shadcn.com: 25 of the port's 498 pages, converted at migrateRef (the snapshot release). The old site is the Next.js
// build served on this machine, as the port was checked against it; recording builds it from the pinned commit.
export default {
	name: 'shadcn-ui',
	app: 'examples/shadcn-ui-markless',
	old: 'http://localhost:4000',
	owner: 'markless-migrate ui.shadcn.com port (thejackshelton)',
	migrateRef: '12207a0e3ac135cf58d37a8e838904ef7c14abf7',
	snapshot: {
		url: 'https://github.com/compiled-run/markless-migrate/releases/download/shadcn-ui-suite-12207a0/shadcn-ui-markless-converted.tar.gz',
		sha256: 'e52062765472804ab509d168e42b5e22d8d6cba8608421a4b4f7102e154b05de',
	},
	oldSite: {
		setup: [['bash', 'deploy/shadcn-ui/fetch-old.sh']],
		serve: ['bash', 'deploy/shadcn-ui/serve-old.sh'],
	},
	routes: {
		sample: [
			{ route: '/', covers: ['idle or visible handler', 'theme class', 'menu'] },
			{ route: '/docs', covers: ['in-place navigation', 'theme class', 'dialog'] },
			{ route: '/docs/components/radix/dialog', covers: ['dialog', 'in-place navigation'] },
			{ route: '/docs/components/radix/dropdown-menu', covers: ['menu'] },
			{ route: '/colors', covers: ['big page', 'idle or visible handler'] },
		],
		full,
	},
} satisfies Suite;
