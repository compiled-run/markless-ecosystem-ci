import type { Suite } from '../src/types.ts';
import full from './routes/vite-dev.json' with { type: 'json' };

export default {
	name: 'vite-dev',
	app: 'examples/vite-dev-markless',
	old: 'https://vite-dev-old.vercel.app',
	owner: 'markless-migrate vite-dev port (thejackshelton)',
	quarantine: [
		{
			route: "/",
			dimension: "*",
			check: "",
			reason: "two replays of one build (record run 39658620227) disagreed on 15 checks of /: the Rive canvases and the sections around them took different sizes (css and screenshots at 767 to 1440 px), a reduced-motion animation ran in one, and JavaScript run at load was 112 kB in one and 138 kB in the other",
			owner: "markless-migrate vite-dev port (thejackshelton)",
			until: "2026-11-04",
		},
		{
			route: "*",
			dimension: "capture",
			check: "https://sponsors.vite.dev/images/",
			reason: "the sponsor grid asks for a different set of logos on each load, so a replay asks for logos the capture run did not (record run 39658620227: 5 different misses in two replays)",
			owner: "markless-migrate vite-dev port (thejackshelton)",
			until: "2026-11-04",
		},
	],
	routes: {
		sample: [
			{ route: '/', covers: ['page script', 'keyed list', 'theme class', 'menu'] },
			{ route: '/guide/', covers: ['theme class', 'dialog', 'menu'] },
			{ route: '/guide/features', covers: ['in-place navigation'] },
			{ route: '/config/build-options', covers: ['big page'] },
			{ route: '/live', covers: ['page script'] },
		],
		full,
	},
} satisfies Suite;
