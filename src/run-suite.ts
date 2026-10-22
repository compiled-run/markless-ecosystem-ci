// One suite end to end: the site on the Markless packs, its build and own tests, its server, then the checker
// against the captured old site, with every request inside the seal.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { background, exec, execAllowFail, ExecError } from './exec.ts';
import type { MarklessPacks } from './markless.ts';
import type { MigrateCheckout } from './migrate.ts';
import { sealEnv, startSeal, type SealMode } from './seal/server.ts';
import type { FailureRecord, Lane, RouteRecord, StepStatus, Suite, SuiteResult } from './types.ts';

export interface RunSuiteOptions {
	readonly root: string;
	readonly workspace: string;
	readonly suite: Suite;
	readonly lane: Lane;
	readonly packs: MarklessPacks;
	readonly migrate: MigrateCheckout;
	readonly seal: SealMode;
	readonly ref?: string;
	/** Routes at once inside the checker. */
	readonly concurrency?: number;
	/** Only these routes (a shard of the lane). */
	readonly routes?: readonly string[];
}

/**
 * The sample explores each route by count, not by time, so a slower runner explores the same journeys. The full
 * lane keeps the checker's 120 s journey budget to fit every route into a night; controls it does not reach are
 * not counted either way (see explorationOnly).
 */
export const CHECK_DEFAULTS: Record<Lane, readonly string[]> = {
	sample: ['--journey-budget', '3600', '--max-journeys', '40', '--timeout', '1800'],
	full: ['--timeout', '1800'],
};

export function routesFor(suite: Suite, lane: Lane): string[] {
	return lane === 'sample' ? suite.routes.sample.map((r) => r.route) : [...suite.routes.full];
}

async function freePort(): Promise<number> {
	return new Promise((done, fail) => {
		const server = createServer();
		server.on('error', fail);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as { port: number };
			server.close(() => done(port));
		});
	});
}

/** The app's package.json with every published @markless package pointed at the packed tarball, as an npm override. */
export async function applyOverrides(appDir: string, packs: MarklessPacks): Promise<string[]> {
	const file = join(appDir, 'package.json');
	const pkg = JSON.parse(await readFile(file, 'utf8')) as Record<string, any>;
	const changed: string[] = [];
	pkg.overrides ??= {};
	for (const [name, tarball] of Object.entries(packs.tarballs)) {
		const spec = `file:${tarball}`;
		for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
			if (pkg[field]?.[name]) {
				pkg[field][name] = spec;
				changed.push(name);
			}
		}
		const existing = pkg.overrides[name];
		if (existing && typeof existing === 'object') existing['.'] = spec;
		else pkg.overrides[name] = spec;
	}
	await writeFile(file, `${JSON.stringify(pkg, null, '\t')}\n`);
	return [...new Set(changed)];
}

async function waitForServer(url: string, exited: Promise<number>, ms: number): Promise<void> {
	const deadline = Date.now() + ms;
	let gone = false;
	void exited.then(() => (gone = true));
	while (Date.now() < deadline) {
		if (gone) throw new Error('the site server exited before it answered');
		try {
			await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
			return;
		} catch {
			await new Promise((done) => setTimeout(done, 500));
		}
	}
	throw new Error(`the site server did not answer ${url} within ${ms / 1000} s`);
}

function routeKey(route: { route: string; role?: string }): string {
	return route.role && route.role !== 'anonymous' ? `${route.route} as ${route.role}` : route.route;
}

interface ReportRoute {
	route: string;
	role?: string;
	ok: boolean;
	dimensions: Record<string, string>;
	failures: { id: string; dimension: string; check: string; viewport?: string; expected?: string; actual?: string; accepted?: unknown }[];
	weight?: { new?: { downloaded: number; executed: number } };
	infrastructure?: { message?: string; cause?: string };
}

export function readRoutes(report: { routes: ReportRoute[] }): Record<string, RouteRecord> {
	const routes: Record<string, RouteRecord> = {};
	for (const route of report.routes) {
		const failures: FailureRecord[] = route.failures
			.filter((f) => !f.accepted)
			.map((f) => ({ id: f.id, dimension: f.dimension, check: f.check, ...(f.viewport ? { viewport: f.viewport } : {}), ...(f.expected !== undefined ? { expected: String(f.expected).slice(0, 300) } : {}), ...(f.actual !== undefined ? { actual: String(f.actual).slice(0, 300) } : {}) }));
		routes[routeKey(route)] = {
			ok: route.ok,
			dimensions: route.dimensions,
			failures,
			...(route.weight?.new ? { weight: { downloaded: route.weight.new.downloaded, executed: route.weight.new.executed } } : {}),
			...(route.infrastructure ? { infrastructure: route.infrastructure.message ?? route.infrastructure.cause ?? 'not checked' } : {}),
		};
	}
	return routes;
}

export async function runSuite(options: RunSuiteOptions): Promise<SuiteResult> {
	const { suite, packs, migrate, lane } = options;
	const started = new Date();
	const timings: Record<string, number> = {};
	const steps: SuiteResult['steps'] = { install: 'skipped', build: 'skipped', test: 'skipped', serve: 'skipped', check: 'skipped' };
	const base = {
		suite: suite.name,
		lane,
		markless: { sha: packs.sha, version: packs.version, ...(options.ref ? { ref: options.ref } : {}) },
		migrate: { sha: migrate.sha },
		startedAt: started.toISOString(),
	};
	if (suite.disabled) return { ...base, steps, timings, routes: {}, seal: { served: 0, loose: 0, misses: [] }, disabled: suite.disabled };

	const appDir = join(migrate.dir, suite.app);
	const capture = join(options.root, 'captures', suite.name);
	const runDir = join(options.workspace, 'runs', suite.name);
	await rm(runDir, { recursive: true, force: true });
	await mkdir(runDir, { recursive: true });
	const sealLog: string[] = [];
	const seal = await startSeal({ mode: options.seal, archive: capture, certs: join(options.workspace, 'certs'), log: (line) => sealLog.push(line) });
	const env = { ...suite.env, CI: 'true', NO_COLOR: '1' };
	const sealed = { ...env, ...sealEnv(seal) };
	let step: keyof SuiteResult['steps'] = 'install';
	let server: ReturnType<typeof background> | undefined;
	let routes: Record<string, RouteRecord> = {};
	let error: string | undefined;
	const time = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
		const at = performance.now();
		try {
			return await work();
		} finally {
			timings[name] = Math.round(performance.now() - at);
		}
	};
	const runAll = async (commands: readonly (readonly string[])[]) => {
		for (const [command, ...args] of commands) await exec(command!, args, { cwd: appDir, env, quiet: true });
	};
	const stamp = join(appDir, '.output', '.ecosystem-ci-build');
	const reuse = process.env.MARKLESS_ECOSYSTEM_REUSE_BUILD === '1' && existsSync(stamp) && (await readFile(stamp, 'utf8')) === packs.sha;
	const build = async () => {
		await time('install', async () => {
			const changed = await applyOverrides(appDir, packs);
			console.log(`[${suite.name}] Markless ${packs.sha.slice(0, 9)} overrides ${changed.join(', ')}`);
			await rm(join(appDir, 'node_modules', '.vite'), { recursive: true, force: true });
			await exec('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', ...(suite.install ?? [])], { cwd: appDir, env, quiet: true });
			if (suite.prepare) await runAll(suite.prepare);
		});
		steps.install = 'pass';
		step = 'build';
		await time('build', () => runAll(suite.build ?? [['npm', 'run', 'build']]));
		steps.build = 'pass';
		if (suite.test) {
			step = 'test';
			await time('test', () => runAll(suite.test!));
			steps.test = 'pass';
		}
		await writeFile(stamp, packs.sha);
	};
	try {
		if (reuse) {
			console.log(`[${suite.name}] reusing the build of Markless ${packs.sha.slice(0, 9)} (MARKLESS_ECOSYSTEM_REUSE_BUILD)`);
			steps.install = steps.build = 'pass';
		} else {
			await build();
		}
		step = 'serve';
		const port = await freePort();
		const origin = `http://127.0.0.1:${port}`;
		const [command, ...args] = suite.serve ?? ['node', '.output/server/index.mjs'];
		server = background(command!, args, { cwd: appDir, env: { ...sealed, ...suite.serveEnv, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${pathToFileURL(resolve(options.root, 'src/seal/guard.mjs')).href}`.trim(), PORT: String(port), HOST: '127.0.0.1', NITRO_PORT: String(port), NITRO_HOST: '127.0.0.1' } });
		await time('serve', () => waitForServer(`${origin}/`, server!.exited, 60_000));
		steps.serve = 'pass';
		step = 'check';
		const selected = options.routes ?? routesFor(suite, lane);
		await rm(join(appDir, '.migrate', 'report.json'), { force: true });
		const checkArgs = [
			'--import',
			resolve(options.root, 'src/seal/preload.mjs'),
			join(migrate.dir, 'src/cli.ts'),
			'check',
			'--old',
			suite.old,
			'--new',
			origin,
			...selected.flatMap((route) => ['--route', route]),
			'--concurrency',
			String(options.concurrency ?? 2),
			'--new-source',
			'.',
			...CHECK_DEFAULTS[lane],
			...(suite.check ?? []),
		];
		const result = await time('check', () =>
			execAllowFail(process.execPath, checkArgs, {
				cwd: appDir,
				env: { ...sealed, MARKLESS_ECOSYSTEM_PLAYWRIGHT_FROM: join(migrate.dir, 'package.json') },
				quiet: true,
				timeoutMs: 75 * 60_000,
				logFile: join(runDir, 'check.log'),
			}),
		);
		const reportFile = join(appDir, '.migrate', 'report.json');
		if (!existsSync(reportFile) || ![0, 1, 3, 4].includes(result.code)) throw new ExecError('markless-migrate check', result);
		const report = JSON.parse(await readFile(reportFile, 'utf8'));
		routes = readRoutes(report);
		steps.check = 'pass';
		for (const file of ['report.json', 'report.html']) {
			if (existsSync(join(appDir, '.migrate', file))) await writeFile(join(runDir, file), await readFile(join(appDir, '.migrate', file)));
		}
	} catch (caught) {
		steps[step] = 'fail' as StepStatus;
		error = caught instanceof Error ? caught.message : String(caught);
		await writeFile(join(runDir, `${step}-error.log`), error);
		if (server) await writeFile(join(runDir, 'server.log'), server.output());
		console.log(`[${suite.name}] ${step} failed: ${error.split('\n')[0]}`);
		console.log(error.split('\n').slice(-40).map((line) => `[${suite.name}]   ${line}`).join('\n'));
	} finally {
		if (server) {
			await writeFile(join(runDir, 'server.log'), server.output());
			await server.stop();
		}
		await seal.close();
		await writeFile(join(runDir, 'seal.log'), `${sealLog.join('\n')}\n`);
	}
	const result: SuiteResult = {
		...base,
		steps,
		...(error ? { error: error.slice(0, 4000) } : {}),
		timings,
		routes,
		seal: { served: seal.stats.served, loose: seal.stats.loose, misses: [...new Set(seal.stats.misses.map((m) => m.key))].sort() },
	};
	await writeFile(join(runDir, 'result.json'), `${JSON.stringify(result, null, '\t')}\n`);
	return result;
}
