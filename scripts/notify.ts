// Tells people about an ecosystem run on Markless main or a release commit, with the workflow's own GITHUB_TOKEN:
// on a regression it comments on the merged pull requests that came in since main's baseline and opens (or adds to)
// one tracking issue that mentions the owner; on a clean run it closes that issue.
// node scripts/notify.ts --summary summary.json --repo compiled-run/markless --run-url <url> [--mention <login>] [--label ecosystem-ci] [--dry-run]
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { Summary } from '../src/report.ts';

const { values } = parseArgs({
	options: {
		summary: { type: 'string' },
		repo: { type: 'string' },
		'run-url': { type: 'string' },
		mention: { type: 'string', default: 'thejackshelton' },
		label: { type: 'string', default: 'ecosystem-ci' },
		context: { type: 'string', default: 'main' },
		'dry-run': { type: 'boolean', default: false },
	},
});
if (!values.summary || !values.repo || !values['run-url']) throw new Error('--summary, --repo and --run-url are required');
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (!token && !values['dry-run']) throw new Error('GITHUB_TOKEN is not set');
const summary = JSON.parse(await readFile(values.summary, 'utf8')) as Summary;
const repo = values.repo;
const runUrl = values['run-url'];
const MAX_PULLS = 20;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
	if (values['dry-run'] && method !== 'GET') {
		console.log(`would ${method} ${path}${body ? ` ${JSON.stringify(body).slice(0, 300)}` : ''}`);
		return {} as T;
	}
	const response = await fetch(`https://api.github.com${path}`, {
		method,
		headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	if (!response.ok && response.status !== 422) throw new Error(`${method} ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`);
	return (response.status === 204 ? {} : await response.json()) as T;
}

function failureList(): string {
	const lines: string[] = [];
	for (const suite of summary.suites) {
		for (const r of suite.regressions.slice(0, 10)) lines.push(`- **${suite.suite}**${r.route ? ` \`${r.route}\`` : ''}: ${r.detail.replace(/\n/g, ' ')}`);
		if (suite.regressions.length > 10) lines.push(`- **${suite.suite}**: and ${suite.regressions.length - 10} more in the run`);
	}
	return lines.join('\n');
}

/** Merged pull requests whose commits landed after the commit main's baseline was recorded on, up to this run's commit. */
async function suspectPulls(sha: string): Promise<number[]> {
	const commits = new Set<string>([sha]);
	for (const base of summary.baselineShas) {
		if (base === sha) continue;
		const range = await api<{ commits?: { sha: string }[] }>('GET', `/repos/${repo}/compare/${base}...${sha}`);
		for (const commit of range.commits ?? []) commits.add(commit.sha);
	}
	const pulls = new Set<number>();
	for (const commit of commits) {
		const found = await api<{ number: number; merged_at: string | null }[]>('GET', `/repos/${repo}/commits/${commit}/pulls`);
		for (const pull of Array.isArray(found) ? found : []) if (pull.merged_at) pulls.add(pull.number);
	}
	return [...pulls].sort((a, b) => a - b).slice(0, MAX_PULLS);
}

async function trackingIssue(): Promise<{ number: number } | undefined> {
	const open = await api<{ number: number; pull_request?: unknown }[]>('GET', `/repos/${repo}/issues?labels=${encodeURIComponent(values.label!)}&state=open&per_page=10`);
	return (Array.isArray(open) ? open : []).find((issue) => !issue.pull_request);
}

const sha = summary.sha ?? 'unknown';
const short = sha.slice(0, 9);
if (summary.regressed) {
	const marker = `<!-- ecosystem-ci-failure ${sha} -->`;
	const pulls = sha === 'unknown' ? [] : await suspectPulls(sha);
	for (const pull of pulls) {
		const comments = await api<{ body: string }[]>('GET', `/repos/${repo}/issues/${pull}/comments?per_page=100`);
		if ((Array.isArray(comments) ? comments : []).some((c) => c.body.includes(marker))) continue;
		await api('POST', `/repos/${repo}/issues/${pull}/comments`, {
			body: `${marker}\nEcosystem CI found regressions on ${values.context} at \`${short}\`, which includes this pull request (it merged after the commit main's ecosystem baseline was recorded on). It may or may not be the cause.\n\n${failureList()}\n\n[The run](${runUrl}). Tracking issue: label \`${values.label}\`.`,
		});
		console.log(`commented on #${pull}`);
	}
	const body = `@${values.mention} Ecosystem CI found regressions on ${values.context} at \`${short}\` ([run](${runUrl})).\n\n${failureList()}\n\nPull requests merged since main's baseline: ${pulls.length ? pulls.map((p) => `#${p}`).join(', ') : 'none found'}.`;
	await api('POST', `/repos/${repo}/labels`, { name: values.label, color: 'B60205', description: 'Ecosystem CI found a regression in the migrated sites' });
	const issue = await trackingIssue();
	if (issue) {
		await api('POST', `/repos/${repo}/issues/${issue.number}/comments`, { body });
		console.log(`updated issue #${issue.number}`);
	} else {
		const created = await api<{ number: number }>('POST', `/repos/${repo}/issues`, { title: `Ecosystem CI: regressions on ${values.context}`, body, labels: [values.label] });
		console.log(`opened issue #${created.number}`);
	}
	process.exitCode = 0;
} else {
	const issue = await trackingIssue();
	if (issue) {
		await api('POST', `/repos/${repo}/issues/${issue.number}/comments`, { body: `Ecosystem CI is clean again on ${values.context} at \`${short}\` ([run](${runUrl})). Closing.` });
		await api('PATCH', `/repos/${repo}/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
		console.log(`closed issue #${issue.number}`);
	} else console.log('clean, no open tracking issue');
}
