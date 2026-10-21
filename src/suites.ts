import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Suite } from './types.ts';

/** Full-lane routes one CI job checks: about 40 minutes at the measured pace of a route. */
export const ROUTES_PER_SHARD = 60;

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

/** Shard `index` of `count` (1-based) of a lane's work: whole suites for the sample, routes for the full lane. */
export function shard<T>(items: readonly T[], spec: string | undefined): T[] {
	if (!spec) return [...items];
	const [index, count] = spec.split('/').map(Number);
	if (!index || !count || index > count) throw new Error(`--shard must be i/n, got ${spec}`);
	return items.filter((_, i) => i % count === index - 1);
}
