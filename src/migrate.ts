// The markless-migrate checkout that holds the sites and the checker, at the commit pinned in migrate.json.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from './exec.ts';

export interface MigratePin {
	readonly repo: string;
	readonly ref: string;
	/** yuku-css from npm when the pinned commit still links a sibling checkout. */
	readonly yukuCss: string;
}

export async function readPin(root: string): Promise<MigratePin> {
	return JSON.parse(await readFile(join(root, 'migrate.json'), 'utf8')) as MigratePin;
}

export interface MigrateCheckout {
	readonly dir: string;
	readonly sha: string;
}

export async function checkoutMigrate(pin: MigratePin, workspace: string, ref = pin.ref, name = 'markless-migrate'): Promise<MigrateCheckout> {
	const dir = join(workspace, name);
	if (!existsSync(join(dir, '.git'))) {
		await mkdir(dir, { recursive: true });
		await exec('git', ['init', '-q'], { cwd: dir });
		await exec('git', ['remote', 'add', 'origin', pin.repo], { cwd: dir });
	}
	await exec('git', ['fetch', '-q', '--depth', '1', 'origin', ref], { cwd: dir });
	await exec('git', ['checkout', '-q', '--force', 'FETCH_HEAD'], { cwd: dir });
	await exec('git', ['clean', '-q', '-fdx', '-e', 'node_modules', '-e', 'examples/*/node_modules'], { cwd: dir });
	const { output } = await exec('git', ['rev-parse', 'HEAD'], { cwd: dir, quiet: true });
	const manifest = join(dir, 'package.json');
	const pkg = JSON.parse(await readFile(manifest, 'utf8')) as { dependencies: Record<string, string> };
	const linked = pkg.dependencies['yuku-css']?.startsWith('link:');
	if (linked) {
		// What markless-migrate's own CI change does (its PR 25): yuku-css from npm, tree-sitter grammars as wasm only.
		pkg.dependencies['yuku-css'] = pin.yukuCss;
		await writeFile(manifest, `${JSON.stringify(pkg, null, '\t')}\n`);
		const workspaceFile = join(dir, 'pnpm-workspace.yaml');
		let workspace = await readFile(workspaceFile, 'utf8');
		if (!workspace.includes('yuku-css@')) workspace = workspace.replace(/(minimumReleaseAgeExclude:\n(?: {2}- .*\n)*)/, `$1  - yuku-css@${pin.yukuCss}\n`);
		if (!workspace.includes('allowBuilds:')) workspace += 'allowBuilds:\n  tree-sitter-php: false\n  tree-sitter-python: false\n  tree-sitter-ruby: false\n';
		await writeFile(workspaceFile, workspace);
	}
	await exec('pnpm', ['install', linked ? '--no-frozen-lockfile' : '--frozen-lockfile', '--prefer-offline'], { cwd: dir, quiet: true, env: { CI: 'true' } });
	const systemDeps = process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true';
	await exec('pnpm', ['exec', 'playwright', 'install', ...(systemDeps ? ['--with-deps'] : []), 'chromium'], { cwd: dir, quiet: true });
	return { dir, sha: output.trim() };
}
