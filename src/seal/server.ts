// The sealed network: an HTTP proxy that every request of a suite run goes through, the browser's, the
// checker's and the site server's. In record mode it fetches from the real network and keeps a copy; in
// replay mode it answers only from the copy, so a run never reaches the network and every run sees the same bytes.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import tls from 'node:tls';
import { promisify } from 'node:util';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';

const run = promisify(execFile);

export type SealMode = 'record' | 'replay';

export interface Entry {
	readonly status: number;
	readonly headers: Record<string, string | string[]>;
	/** sha256 of the body, stored brotli-compressed in bodies/<sha>.br */
	readonly body: string;
}

export interface Archive {
	readonly version: 1;
	/** requestKey() of each captured request to its response */
	entries: Record<string, Entry>;
}

export interface SealStats {
	served: number;
	recorded: number;
	loose: number;
	passed: number;
	misses: { key: string; at: string }[];
	refused: { key: string; at: string }[];
}

const DROP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'strict-transport-security', 'alt-svc', 'proxy-connection', 'upgrade', 'report-to', 'nel']);
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\]|::1)$/;
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sha(data: Buffer | string): string {
	return createHash('sha256').update(data).digest('hex');
}

/**
 * A request's key: method and URL, a hash of its body when it has one, and the names (never the values) of the
 * cookies it carries, so a signed-in page and the same page signed out are kept apart.
 */
export function requestKey(method: string, url: string, body?: Buffer, cookie?: string): string {
	const names = cookie
		?.split(';')
		.map((pair) => pair.split('=')[0]!.trim())
		.filter(Boolean)
		.sort();
	return `${method} ${url}${body?.length ? ` #${sha(body).slice(0, 16)}` : ''}${names?.length ? ` ;${[...new Set(names)].join(',')}` : ''}`;
}

/** Nearer and nearer forms of a key, tried in order when the exact one is not captured: without cookies, without the body, then without the query too (a cache buster computed at run time). */
function looserKeys(key: string): string[] {
	const withoutCookies = key.replace(/ ;[^ ]*$/, '');
	// A sign-in post carries a fresh CSRF token each time, so its body differs from the captured one.
	const withoutBody = withoutCookies.replace(/ #[0-9a-f]+$/, '');
	return [...new Set([withoutCookies, withoutBody, withoutBody.replace(/\?[^ #]*/, '')])].filter((k) => k !== key);
}

/** A captured cookie keeps the lifetime it was given, counted from now: a session captured weeks ago is not expired on replay. */
export function freshCookies(entry: Entry, now = Date.now()): { 'set-cookie'?: string[] } {
	const cookies = entry.headers['set-cookie'];
	const date = Date.parse(String(entry.headers.date ?? ''));
	if (!cookies || Number.isNaN(date)) return {};
	const list = Array.isArray(cookies) ? cookies : [cookies];
	return {
		'set-cookie': list.map((cookie) =>
			cookie.replace(/;\s*expires=([^;]+)/i, (whole, value: string) => {
				const at = Date.parse(value);
				return Number.isNaN(at) || at <= date ? whole : `; Expires=${new Date(now + (at - date)).toUTCString()}`;
			}),
		),
	};
}

export async function readArchive(dir: string): Promise<Archive> {
	const file = join(dir, 'index.json');
	if (!existsSync(file)) return { version: 1, entries: {} };
	return JSON.parse(await readFile(file, 'utf8')) as Archive;
}

async function writeArchive(dir: string, archive: Archive): Promise<void> {
	await mkdir(dir, { recursive: true });
	const sorted = Object.fromEntries(Object.entries(archive.entries).sort(([a], [b]) => (a < b ? -1 : 1)));
	await writeFile(join(dir, 'index.json'), `${JSON.stringify({ version: 1, entries: sorted }, null, '\t')}\n`);
}

/** A throwaway certificate authority for one run, and a leaf per host signed by it on first use. */
class Certificates {
	private readonly leaves = new Map<string, Promise<tls.SecureContext>>();
	readonly dir: string;
	readonly caCert: string;
	private constructor(dir: string, caCert: string) {
		this.dir = dir;
		this.caCert = caCert;
	}

	static async create(dir: string): Promise<Certificates> {
		await mkdir(dir, { recursive: true });
		const key = join(dir, 'ca.key');
		const cert = join(dir, 'ca.pem');
		if (!existsSync(cert)) {
			await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '30', '-subj', '/CN=markless-ecosystem-ci seal'], { cwd: dir });
		}
		return new Certificates(dir, cert);
	}

	context(host: string): Promise<tls.SecureContext> {
		let leaf = this.leaves.get(host);
		if (!leaf) {
			leaf = this.issue(host);
			this.leaves.set(host, leaf);
		}
		return leaf;
	}

	private async issue(host: string): Promise<tls.SecureContext> {
		const name = sha(host).slice(0, 16);
		const key = join(this.dir, `${name}.key`);
		const csr = join(this.dir, `${name}.csr`);
		const cert = join(this.dir, `${name}.pem`);
		const ext = join(this.dir, `${name}.ext`);
		const san = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? `IP:${host}` : `DNS:${host}`;
		await writeFile(ext, `subjectAltName=${san}\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
		await run('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=${host}`], { cwd: this.dir });
		await run('openssl', ['x509', '-req', '-in', csr, '-CA', this.caCert, '-CAkey', join(this.dir, 'ca.key'), '-CAcreateserial', '-out', cert, '-days', '30', '-extfile', ext], { cwd: this.dir });
		return tls.createSecureContext({ key: await readFile(key), cert: await readFile(cert) });
	}
}

export interface SealOptions {
	readonly mode: SealMode;
	/** Where the archive lives: index.json and bodies/. */
	readonly archive: string;
	/** Where the run's certificate authority is written; its ca.pem goes in NODE_EXTRA_CA_CERTS. */
	readonly certs: string;
	readonly port?: number;
	/** Hosts never recorded or replayed (an analytics beacon): answered 204. */
	readonly drop?: readonly string[];
	readonly log?: (line: string) => void;
}

export interface Seal {
	readonly url: string;
	readonly port: number;
	readonly caCert: string;
	readonly stats: SealStats;
	close(): Promise<void>;
}

export async function startSeal(options: SealOptions): Promise<Seal> {
	const certs = await Certificates.create(options.certs);
	const archive = await readArchive(options.archive);
	const bodies = join(options.archive, 'bodies');
	await mkdir(bodies, { recursive: true });
	const stats: SealStats = { served: 0, recorded: 0, loose: 0, passed: 0, misses: [], refused: [] };
	const log = options.log ?? (() => {});
	const loose = new Map<string, string>();
	const remember = (key: string) => {
		for (const near of looserKeys(key)) if (!loose.has(near)) loose.set(near, key);
	};
	for (const key of Object.keys(archive.entries)) remember(key);
	let dirty = false;
	let flushing: Promise<void> = Promise.resolve();

	const flush = () => {
		if (!dirty) return flushing;
		dirty = false;
		flushing = flushing.then(() => writeArchive(options.archive, archive));
		return flushing;
	};

	const decoded = new Map<string, Promise<Buffer>>();
	function body(entry: Entry): Promise<Buffer> {
		let data = decoded.get(entry.body);
		if (!data) {
			data = readFile(join(bodies, `${entry.body}.br`)).then((file) => brotliDecompressSync(file));
			decoded.set(entry.body, data);
		}
		return data;
	}

	async function record(method: string, url: string, headers: IncomingMessage['headers'], requestBody: Buffer): Promise<{ entry: Entry; data: Buffer }> {
		const forwarded: Record<string, string> = {};
		for (const [name, value] of Object.entries(headers)) {
			if (value === undefined || DROP.has(name) || name === 'host' || name.startsWith('proxy-') || name === 'accept-encoding') continue;
			forwarded[name] = Array.isArray(value) ? value.join(', ') : value;
		}
		const response = await fetch(url, { method, headers: forwarded, redirect: 'manual', ...(requestBody.length ? { body: new Uint8Array(requestBody) } : {}), signal: AbortSignal.timeout(60_000) });
		const data = Buffer.from(await response.arrayBuffer());
		const kept: Record<string, string | string[]> = {};
		response.headers.forEach((value, name) => {
			if (DROP.has(name) || name === 'set-cookie') return;
			kept[name] = value;
		});
		const cookies = response.headers.getSetCookie();
		if (cookies.length) kept['set-cookie'] = cookies;
		const hash = sha(data);
		const file = join(bodies, `${hash}.br`);
		if (!existsSync(file)) await writeFile(file, brotliCompressSync(data));
		return { entry: { status: response.status, headers: kept, body: hash }, data };
	}

	async function answer(scheme: 'http' | 'https', req: IncomingMessage, res: ServerResponse): Promise<void> {
		const method = (req.method ?? 'GET').toUpperCase();
		const target = req.url?.startsWith('http') ? new URL(req.url) : new URL(`${scheme}://${req.headers.host}${req.url ?? '/'}`);
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const requestBody = Buffer.concat(chunks);
		if (LOOPBACK.test(target.hostname)) return pass(target, method, req, requestBody, res);
		const url = target.href;
		const cookie = Array.isArray(req.headers.cookie) ? req.headers.cookie.join('; ') : req.headers.cookie;
		const key = requestKey(method, url, READS.has(method) ? undefined : requestBody, cookie);
		if (options.drop?.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`))) {
			res.writeHead(204).end();
			return;
		}
		let entry = archive.entries[key];
		let data: Buffer | undefined;
		if (!entry && options.mode === 'record') {
			try {
				({ entry, data } = await record(method, url, req.headers, requestBody));
				archive.entries[key] = entry;
				remember(key);
				stats.recorded++;
				dirty = true;
				void flush();
				log(`recorded ${entry.status} ${key}`);
			} catch (error) {
				log(`record failed ${key}: ${(error as Error).message}`);
				res.writeHead(502, { 'content-type': 'text/plain', 'x-seal': 'upstream-failed' }).end(`seal: ${key} failed upstream`);
				return;
			}
		}
		if (!entry && options.mode === 'replay') {
			const near = [key, ...looserKeys(key)].map((k) => archive.entries[k] ?? (loose.get(k) ? archive.entries[loose.get(k)!] : undefined)).find(Boolean);
			if (near) {
				entry = near;
				stats.loose++;
			}
		}
		if (!entry) {
			stats.misses.push({ key, at: new Date().toISOString() });
			log(`miss ${key}`);
			res.writeHead(504, { 'content-type': 'text/plain', 'x-seal': 'miss' }).end(`seal: ${key} is not in the capture`);
			return;
		}
		data ??= await body(entry);
		stats.served++;
		res.writeHead(entry.status, { ...entry.headers, ...freshCookies(entry), 'content-length': String(data.length), 'x-seal': options.mode });
		res.end(method === 'HEAD' ? undefined : data);
	}

	/** A loopback request (the site under test) goes straight through, never recorded. */
	function pass(target: URL, method: string, req: IncomingMessage, requestBody: Buffer, res: ServerResponse): void {
		stats.passed++;
		const headers = { ...req.headers };
		delete headers['proxy-connection'];
		const upstream = http.request({ host: target.hostname.replace(/^\[|\]$/g, ''), port: target.port || 80, method, path: `${target.pathname}${target.search}`, headers }, (response) => {
			res.writeHead(response.statusCode ?? 502, response.headers);
			response.pipe(res);
		});
		upstream.on('error', (error) => {
			if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
			res.end(`seal: ${target.origin} ${error.message}`);
		});
		upstream.end(requestBody);
	}

	const inner = http.createServer((req, res) => {
		answer('https', req, res).catch((error) => {
			log(`error ${req.url}: ${(error as Error).stack}`);
			if (!res.headersSent) res.writeHead(500);
			res.end();
		});
	});
	inner.keepAliveTimeout = 2_000;

	const server = http.createServer((req, res) => {
		answer('http', req, res).catch((error) => {
			log(`error ${req.url}: ${(error as Error).stack}`);
			if (!res.headersSent) res.writeHead(500);
			res.end();
		});
	});
	server.keepAliveTimeout = 2_000;
	const sockets = new Set<Socket>();
	server.on('connection', (socket) => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
	});

	server.on('connect', (req: IncomingMessage, socket: Socket, head: Buffer) => {
		const [host = '', port = '443'] = (req.url ?? '').split(/:(?=\d+$)/);
		socket.on('error', () => {});
		if (LOOPBACK.test(host)) {
			// The site under test over a CONNECT: a raw tunnel to it.
			import('node:net').then(({ connect }) => {
				const upstream = connect(Number(port), host, () => {
					socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
					if (head.length) upstream.write(head);
					upstream.pipe(socket);
					socket.pipe(upstream);
				});
				upstream.on('error', () => socket.destroy());
			});
			return;
		}
		socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
		const secure = new tls.TLSSocket(socket, {
			isServer: true,
			ALPNProtocols: ['http/1.1'],
			SNICallback: (name, done) => {
				certs.context(name || host).then((context) => done(null, context), (error: Error) => done(error));
			},
		});
		secure.on('error', () => socket.destroy());
		if (head.length) secure.unshift(head);
		inner.emit('connection', secure);
	});

	await new Promise<void>((done) => server.listen(options.port ?? 0, '127.0.0.1', done));
	const port = (server.address() as AddressInfo).port;
	log(`seal ${options.mode} on http://127.0.0.1:${port}, ${Object.keys(archive.entries).length} responses in ${options.archive}`);
	return {
		url: `http://127.0.0.1:${port}`,
		port,
		caCert: certs.caCert,
		stats,
		async close() {
			for (const socket of sockets) socket.destroy();
			await new Promise((done) => server.close(done));
			inner.close();
			dirty = true;
			if (options.mode === 'record') await flush();
		},
	};
}

/** What a process needs in its environment for every request it makes to go through the seal. */
export function sealEnv(seal: Pick<Seal, 'url' | 'caCert'>): Record<string, string> {
	return {
		HTTP_PROXY: seal.url,
		HTTPS_PROXY: seal.url,
		http_proxy: seal.url,
		https_proxy: seal.url,
		NO_PROXY: '127.0.0.1,localhost,::1',
		no_proxy: '127.0.0.1,localhost,::1',
		NODE_USE_ENV_PROXY: '1',
		NODE_EXTRA_CA_CERTS: seal.caCert,
		MARKLESS_ECOSYSTEM_SEAL: seal.url,
	};
}
