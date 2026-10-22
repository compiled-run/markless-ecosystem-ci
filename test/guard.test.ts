import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const guard = pathToFileURL(join(import.meta.dirname, '../src/seal/guard.mjs')).href;

function run(script: string): string {
	const result = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', NODE_USE_ENV_PROXY: '' } });
	return `${result.stdout}${result.stderr}`.trim();
}

test('a connection to another machine fails before it is made', () => {
	const out = run(`import net from 'node:net'; const s = net.connect(443, '93.184.215.14'); s.on('error', (e) => console.log(e.code, e.message)); s.on('connect', () => console.log('connected'));`);
	assert.match(out, /^ECONNREFUSED markless-ecosystem-ci seal: a connection to 93\.184\.215\.14 would bypass the seal/);
});

test('fetch to a host name fails the same way, and this machine stays reachable', () => {
	const out = run(`
		import http from 'node:http';
		const server = http.createServer((_, res) => res.end('local')).listen(0, '127.0.0.1', async () => {
			const local = await (await fetch('http://127.0.0.1:' + server.address().port)).text();
			const remote = await fetch('https://example.com/').then(() => 'reached', (e) => e.cause?.code ?? e.message);
			console.log(local, remote);
			server.close();
		});`);
	assert.equal(out, 'local ECONNREFUSED');
});
