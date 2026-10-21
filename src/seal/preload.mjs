// Loaded with --import into the markless-migrate checker: its Chromium sends every request through the seal.
// The checker launches Chromium without options, so the proxy is added to that launch here.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const seal = process.env.MARKLESS_ECOSYSTEM_SEAL;
const from = process.env.MARKLESS_ECOSYSTEM_PLAYWRIGHT_FROM;
if (seal && from) {
	const require = createRequire(pathToFileURL(from));
	const { chromium } = require('playwright');
	const launch = chromium.launch.bind(chromium);
	chromium.launch = (options = {}) =>
		launch({
			...options,
			proxy: { server: seal, bypass: '127.0.0.1,localhost,::1', ...options.proxy },
			args: [...(options.args ?? []), '--ignore-certificate-errors', '--disable-quic', '--no-first-run'],
		});
}
