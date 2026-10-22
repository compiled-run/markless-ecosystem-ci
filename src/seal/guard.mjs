// Loaded into every process of a suite run that may open a connection (the checker, the site server): a TCP
// connection to anything but this machine throws, so a request that bypasses the seal fails loudly instead of
// reaching the network. Playwright's own request client ignores the proxy environment, which is how this was found.
import net from 'node:net';

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const connect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function (...args) {
	const first = args[0];
	const options = Array.isArray(first) ? first[0] : first;
	const host = typeof options === 'object' && options !== null ? (options.path ? undefined : (options.host ?? 'localhost')) : typeof options === 'number' || /^\d+$/.test(String(options)) ? (typeof args[1] === 'string' ? args[1] : 'localhost') : undefined;
	if (host !== undefined && !LOOPBACK.test(host)) {
		const error = Object.assign(new Error(`markless-ecosystem-ci seal: a connection to ${host} would bypass the seal`), { code: 'ECONNREFUSED' });
		process.nextTick(() => this.destroy(error));
		return this;
	}
	return connect.apply(this, args);
};
