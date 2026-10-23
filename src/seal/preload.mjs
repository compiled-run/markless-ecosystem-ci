// Loaded with --import into the markless-migrate checker: its Chromium and its own request client send every
// request through the seal. The checker creates both without options, so the proxy is added where they are made.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import './guard.mjs';

const seal = process.env.MARKLESS_ECOSYSTEM_SEAL;
const from = process.env.MARKLESS_ECOSYSTEM_PLAYWRIGHT_FROM;
if (seal && from) {
	const require = createRequire(pathToFileURL(from));
	const { chromium, request } = require('playwright');
	const proxy = { server: seal, bypass: process.env.MARKLESS_ECOSYSTEM_BYPASS ?? '127.0.0.1,localhost,::1' };
	const launch = chromium.launch.bind(chromium);
	chromium.launch = (options = {}) =>
		launch({
			...options,
			proxy: { ...proxy, ...options.proxy },
			args: [...(options.args ?? []), '--ignore-certificate-errors', '--disable-quic', '--no-first-run'],
		});
	const newContext = request.newContext.bind(request);
	request.newContext = (options = {}) => newContext({ ...options, proxy: { ...proxy, ...options.proxy }, ignoreHTTPSErrors: true });
}
