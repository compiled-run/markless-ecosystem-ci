// Markless at the ref under test: checked out, built, and packed into the tarballs a release would publish.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { exec } from './exec.ts';

export const MARKLESS_REPO = 'https://github.com/compiled-run/markless.git';

export interface MarklessPacks {
	/** The commit the packs were built from. */
	readonly sha: string;
	readonly version: string;
	/** Published package name to the absolute path of its tarball. */
	readonly tarballs: Record<string, string>;
	/** Workspace packages still private: a site can only have them from npm, so they are not overridden. */
	readonly unpublished: readonly string[];
}

export interface MarklessSource {
	/** An existing checkout to build as it is (CI checks the ref out itself). */
	readonly dir?: string;
	/** A branch, tag, sha, or `pr/<number>`, cloned into the workspace. */
	readonly ref?: string;
}

/** A shallow clone of exactly one ref; `pr/<n>` is the pull request's head. */
export async function checkoutMarkless(ref: string, dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	const fetchRef = /^pr\/\d+$/.test(ref) ? `refs/pull/${ref.slice(3)}/head` : await fullSha(ref);
	await exec('git', ['init', '-q'], { cwd: dir });
	await exec('git', ['remote', 'add', 'origin', MARKLESS_REPO], { cwd: dir });
	await exec('git', ['fetch', '-q', '--depth', '1', 'origin', fetchRef], { cwd: dir });
	await exec('git', ['checkout', '-q', 'FETCH_HEAD'], { cwd: dir });
}

/** git fetches a commit by its full sha only; a short one is looked up on GitHub first. */
async function fullSha(ref: string): Promise<string> {
	if (!/^[0-9a-f]{7,39}$/.test(ref)) return ref;
	const response = await fetch(`https://api.github.com/repos/compiled-run/markless/commits/${ref}`, { headers: { accept: 'application/vnd.github.sha' } });
	if (!response.ok) throw new Error(`compiled-run/markless has no commit ${ref} (GitHub answered ${response.status})`);
	return (await response.text()).trim();
}

interface WorkspacePackage {
	readonly name: string;
	readonly version: string;
	readonly path: string;
	readonly private?: boolean;
}

async function marklessPackages(dir: string): Promise<WorkspacePackage[]> {
	const { output } = await exec('pnpm', ['m', 'ls', '--json', '--depth=-1'], { cwd: dir, quiet: true });
	const listed = JSON.parse(output.slice(output.indexOf('['))) as WorkspacePackage[];
	return listed.filter((p) => p.name?.startsWith('@markless/') && p.path !== resolve(dir));
}

/** packs.json names each tarball relative to its own folder, so the folder can move between CI jobs as an artifact. */
export async function readPacks(dir: string): Promise<MarklessPacks | undefined> {
	const stamp = join(dir, 'packs.json');
	if (!existsSync(stamp)) return undefined;
	const stored = JSON.parse(await readFile(stamp, 'utf8')) as MarklessPacks;
	const tarballs = Object.fromEntries(Object.entries(stored.tarballs).map(([name, file]) => [name, join(resolve(dir), basename(file))]));
	if (!Object.values(tarballs).every((file) => existsSync(file))) return undefined;
	return { ...stored, tarballs };
}

export async function buildMarkless(source: MarklessSource, workspace: string, packs = join(workspace, 'packs')): Promise<MarklessPacks> {
	const dir = source.dir ? resolve(source.dir) : join(workspace, 'markless');
	if (!source.dir) await checkoutMarkless(source.ref ?? 'main', dir);
	const sha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: dir, quiet: true })).output.trim();
	const cached = await readPacks(packs);
	if (cached?.sha === sha && !process.env.MARKLESS_ECOSYSTEM_REPACK) {
		console.log(`Markless ${sha.slice(0, 9)} already packed in ${packs}`);
		return cached;
	}
	await rm(packs, { recursive: true, force: true });
	await mkdir(packs, { recursive: true });
	await exec('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: dir, quiet: true, env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', CI: 'true' } });
	await exec('pnpm', ['run', 'build'], { cwd: dir, quiet: true });
	const tarballs: Record<string, string> = {};
	const workspacePackages = await marklessPackages(dir);
	const unpublished = workspacePackages.filter((pkg) => pkg.private).map((pkg) => pkg.name);
	for (const pkg of workspacePackages.filter((p) => !p.private)) {
		const before = new Set(await readdir(packs));
		await exec('pnpm', ['pack', '--pack-destination', resolve(packs)], { cwd: pkg.path, quiet: true });
		const made = (await readdir(packs)).find((file) => !before.has(file) && file.endsWith('.tgz'));
		if (!made) throw new Error(`pnpm pack wrote no tarball for ${pkg.name}`);
		tarballs[pkg.name] = made;
	}
	const root = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { version: string };
	await writeFile(join(packs, 'packs.json'), `${JSON.stringify({ sha, version: root.version, tarballs, unpublished }, null, '\t')}\n`);
	console.log(`Markless ${sha.slice(0, 9)} (${root.version}) packed: ${Object.keys(tarballs).join(', ')}; not overridden (private): ${unpublished.join(', ') || 'none'}`);
	return (await readPacks(packs))!;
}
