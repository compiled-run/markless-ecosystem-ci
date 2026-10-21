import type { Suite } from '../src/types.ts';
import full from './routes/htmx-org.json' with { type: 'json' };

export default {
	name: 'htmx-org',
	app: 'examples/htmx-org-markless',
	old: 'https://htmx.org',
	owner: 'markless-migrate htmx-org port (thejackshelton)',
	disabled: "the port is on Markless 0.5.0 and its generated pages do not build on 0.8 (since 0.8 TSRX reads // and /* in page text as comments, so the text breaks the markup: Expected closing tag for <span> but found </main>); it runs again once the markless-migrate port is regenerated on 0.8, as vite-dev was",
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
