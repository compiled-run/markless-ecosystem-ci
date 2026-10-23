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
	// The checker ran out of Node's default 4 GB heap after the 25 routes of the full lane (record run on 2026-10-22).
	env: { NODE_OPTIONS: '--max-old-space-size=8192' },
	oldSite: {
		setup: [['bash', 'deploy/shadcn-ui/fetch-old.sh']],
		serve: ['bash', 'deploy/shadcn-ui/serve-old.sh'],
	},
	// On a runner, /docs/components/radix/dropdown-menu and /colors took close to the checker's 1800 s per route: each was
	// stopped by it in one of two replays of one build and finished in the other (record run 39886329077).
	check: ['--timeout', '3000'],
	quarantine: [
		{
			route: '/docs',
			dimension: 'motion',
			check: 'click button "How do I pull upstream updates in an Open Code approach?": frame of region',
			reason: "in one of two replays of one build (record run 39886329077), the region's frame at 50 ms into the old page's accordion-down was 640x67 on the new side; the other replay matched",
			owner: 'markless-migrate checker (thejackshelton)',
			until: '2026-11-05',
		},
		{
			route: '/docs/components/radix/dropdown-menu',
			dimension: 'visual',
			check: 'screenshot in',
			reason: 'in one of two replays of one build (record run 39897650391), 7140 pixels of every desktop screenshot from 1024 to 2000 px wide and with prefers-reduced-motion: no-preference differed; the other replay matched (the avatar that shows its LR fallback differs in both)',
			owner: 'markless-migrate ui.shadcn.com port (thejackshelton)',
			until: '2026-11-05',
		},
	],
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
