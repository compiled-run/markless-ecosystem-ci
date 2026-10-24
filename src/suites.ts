import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Lane, Suite } from './types.ts';

/**
 * Routes one CI job checks. A sampled route takes 4 to 8 minutes to check on a runner (shadcn-admin /: 361 s), so
 * two keep a per-PR job near a quarter of an hour; the nightly lane packs more into each job.
 */
export const ROUTES_PER_JOB = { sample: 2, full: 25 } as const;

export async function loadSuites(root: string): Promise<Suite[]> {
	const dir = join(root, 'suites');
	const files = (await readdir(dir)).filter((file) => file.endsWith('.ts')).sort();
	const suites: Suite[] = [];
	for (const file of files) suites.push((await import(pathToFileURL(join(dir, file)).href)).default as Suite);
	return suites;
}

export async function selectSuites(root: string, names: readonly string[]): Promise<Suite[]> {
	const all = await loadSuites(root);
	if (!names.length || (names.length === 1 && names[0] === 'all')) return all;
	const unknown = names.filter((name) => !all.some((suite) => suite.name === name));
	if (unknown.length) throw new Error(`unknown suite ${unknown.join(', ')}; suites: ${all.map((s) => s.name).join(', ')}`);
	return all.filter((suite) => names.includes(suite.name));
}

/** CI jobs a suite's lane is split into. */
export function jobCount(suite: Suite, lane: Lane): number {
	const routes = lane === 'full' ? suite.routes.full.length : suite.routes.sample.length;
	return Math.max(1, Math.ceil(routes / (suite.routesPerJob?.[lane] ?? ROUTES_PER_JOB[lane])));
}

/** Shard `index` of `count` (1-based) of a suite's routes. */
export function shard<T>(items: readonly T[], spec: string | undefined): T[] {
	if (!spec) return [...items];
	const [index, count] = spec.split('/').map(Number);
	if (!index || !count || index > count) throw new Error(`--shard must be i/n, got ${spec}`);
	return items.filter((_, i) => i % count === index - 1);
}
