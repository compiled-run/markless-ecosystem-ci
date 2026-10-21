import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import tls from 'node:tls';
import { brotliCompressSync } from 'node:zlib';
import { freshCookies, requestKey, startSeal, type Seal } from '../src/seal/server.ts';

let dir: string;
let seal: Seal;

async function store(archive: string, key: string, status: number, headers: Record<string, string>, body: string): Promise<void> {
	const hash = createHash('sha256').update(body).digest('hex');
	await mkdir(join(archive, 'bodies'), { recursive: true });
	await writeFile(join(archive, 'bodies', `${hash}.br`), brotliCompressSync(Buffer.from(body)));
	const file = join(archive, 'index.json');
	const index = await readFile(file, 'utf8').then((t) => JSON.parse(t), () => ({ version: 1, entries: {} }));
	index.entries[key] = { status, headers, body: hash };
	await writeFile(file, JSON.stringify(index));
}

function viaProxy(url: string, method = 'GET', body?: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
	return new Promise((done, fail) => {
		const request = http.request({ host: '127.0.0.1', port: seal.port, method, path: url, headers: { host: new URL(url).host } }, (response) => {
			let text = '';
			response.on('data', (chunk) => (text += chunk));
			response.on('end', () => done({ status: response.statusCode!, body: text, headers: response.headers }));
		});
		request.on('error', fail);
		request.end(body);
	});
}

function viaTunnel(url: string): Promise<{ status: number; body: string }> {
	const target = new URL(url);
	return new Promise((done, fail) => {
		const connect = http.request({ host: '127.0.0.1', port: seal.port, method: 'CONNECT', path: `${target.hostname}:443` });
		connect.on('connect', async (_response, socket) => {
			const secure = tls.connect({ socket, servername: target.hostname, ca: await readFile(seal.caCert) }, () => {
				secure.write(`GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.hostname}\r\nConnection: close\r\n\r\n`);
			});
			let raw = '';
			secure.on('data', (chunk) => (raw += chunk));
			secure.on('end', () => done({ status: Number(raw.split(' ')[1]), body: raw.split('\r\n\r\n').slice(1).join('\r\n\r\n') }));
			secure.on('error', fail);
		});
		connect.on('error', fail);
		connect.end();
	});
}

describe('the seal in replay mode', () => {
	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'seal-'));
		const archive = join(dir, 'archive');
		await store(archive, requestKey('GET', 'http://old.example/page'), 200, { 'content-type': 'text/html' }, '<p>old page</p>');
		await store(archive, requestKey('GET', 'https://cdn.example/app.js?v=1'), 200, { 'content-type': 'text/javascript' }, 'console.log(1)');
		seal = await startSeal({ mode: 'replay', archive, certs: join(dir, 'certs') });
	});
	after(() => seal.close());

	test('answers a captured request with the captured response', async () => {
		const response = await viaProxy('http://old.example/page');
		assert.equal(response.status, 200);
		assert.equal(response.body, '<p>old page</p>');
		assert.equal(response.headers['x-seal'], 'replay');
	});

	test('answers https through a tunnel, with a certificate the run trusts', async () => {
		const response = await viaTunnel('https://cdn.example/app.js?v=1');
		assert.equal(response.status, 200);
		assert.match(response.body, /console\.log\(1\)/);
	});

	test('never reaches the network: an uncaptured request is a 504 and a recorded miss', async () => {
		const response = await viaProxy('http://elsewhere.example/new');
		assert.equal(response.status, 504);
		const write = await viaProxy('http://old.example/page', 'POST', 'a=1');
		assert.equal(write.status, 504);
		assert.deepEqual(seal.stats.misses.map((m) => m.key).sort(), ['GET http://elsewhere.example/new', requestKey('POST', 'http://old.example/page', Buffer.from('a=1'))].sort());
	});

	test('a cache buster the page computes at run time still finds its response', async () => {
		const response = await viaTunnel('https://cdn.example/app.js?v=2');
		assert.equal(response.status, 200);
		assert.equal(seal.stats.loose, 1);
	});

	test('passes the site under test straight through', async () => {
		const site = http.createServer((_request, response) => response.end('the new site')).listen(0, '127.0.0.1');
		await new Promise((done) => site.once('listening', done));
		const { port } = site.address() as { port: number };
		const response = await viaProxy(`http://127.0.0.1:${port}/`);
		site.close();
		assert.equal(response.body, 'the new site');
	});
});

describe('capture keys and cookies', () => {
	test('a request is keyed by its cookie names, never their values', () => {
		assert.equal(requestKey('GET', 'https://a.example/notes', undefined, 'session=abc; theme=dark'), 'GET https://a.example/notes ;session,theme');
		assert.equal(requestKey('GET', 'https://a.example/notes', undefined, 'theme=light; session=xyz'), 'GET https://a.example/notes ;session,theme');
		assert.equal(requestKey('GET', 'https://a.example/notes'), 'GET https://a.example/notes');
	});

	test('a captured cookie keeps its lifetime counted from now', () => {
		const entry = { status: 200, body: '', headers: { date: 'Wed, 21 Oct 2026 00:00:00 GMT', 'set-cookie': ['s=1; Path=/; Expires=Thu, 22 Oct 2026 00:00:00 GMT; HttpOnly', 'gone=; Expires=Thu, 01 Jan 1970 00:00:00 GMT'] } };
		const now = Date.parse('2027-01-01T00:00:00Z');
		assert.deepEqual(freshCookies(entry, now)['set-cookie'], ['s=1; Path=/; Expires=Sat, 02 Jan 2027 00:00:00 GMT; HttpOnly', 'gone=; Expires=Thu, 01 Jan 1970 00:00:00 GMT']);
	});
});
