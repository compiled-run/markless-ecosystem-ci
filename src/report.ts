// The results table posted on a pull request, in a release gate and on a nightly issue.
import type { Comparison, SuiteComparison } from './compare.ts';
import type { Lane } from './types.ts';

export const COMMENT_MARKER = '<!-- markless-ecosystem-ci -->';

function seconds(ms: number | undefined): string {
	if (!ms) return '';
	const s = Math.round(ms / 1000);
	return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

function status(c: SuiteComparison): string {
	if (c.suite.disabled) return 'not run';
	if (!c.result) return 'no result';
	if (c.regressions.length) return `**${c.regressions.length} regression${c.regressions.length === 1 ? '' : 's'}**`;
	if (!c.baseline) return 'no baseline yet';
	return 'no regression';
}

function greenCount(routes: Record<string, { ok: boolean }> | undefined): string {
	if (!routes) return '';
	const all = Object.values(routes);
	return all.length ? `${all.filter((r) => r.ok).length} of ${all.length}` : '';
}

export function renderMarkdown(comparison: Comparison, options: { title: string; lane: Lane; runUrl?: string }): string {
	const lines: string[] = [COMMENT_MARKER, `### ${options.title}`, ''];
	const first = comparison.suites.find((c) => c.result)?.result;
	const verdict = comparison.regressed ? 'Regressions against main' : 'No regression against main';
	lines.push(`**${verdict}.** ${options.lane === 'sample' ? 'Per-PR route sample' : 'Every route'}${first ? `, Markless \`${first.markless.sha.slice(0, 9)}\` (${first.markless.version}), markless-migrate \`${first.migrate.sha.slice(0, 9)}\`` : ''}${options.runUrl ? `. [Run](${options.runUrl})` : ''}.`);
	lines.push('', '| Suite | Result | Build | Green routes | Green on main | Time |', '| --- | --- | --- | --- | --- | --- |');
	for (const c of comparison.suites) {
		const build = c.result ? (c.result.steps.build === 'pass' ? 'pass' : c.result.steps.build) : '';
		const time = c.result ? seconds(Object.values(c.result.timings).reduce((a, b) => a + b, 0)) : '';
		lines.push(`| ${c.suite.name} | ${status(c)} | ${build} | ${greenCount(c.result?.routes)} | ${greenCount(c.baseline?.routes)} | ${time} |`);
	}
	const regressed = comparison.suites.filter((c) => c.regressions.length);
	if (regressed.length) {
		lines.push('', '#### Regressions', '');
		for (const c of regressed) {
			lines.push(`**${c.suite.name}**`, '');
			for (const r of c.regressions.slice(0, 25)) lines.push(`- ${r.route ? `\`${r.route}\` ` : ''}${r.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')}`);
			if (c.regressions.length > 25) lines.push(`- and ${c.regressions.length - 25} more in the run's results`);
			lines.push('');
		}
	}
	const timing = comparison.suites.filter((c) => c.timing.length);
	if (timing.length) {
		lines.push('', '<details><summary>Timing differences (reported, not counted: they vary between replays of the same build)</summary>', '');
		for (const c of timing) for (const t of c.timing.slice(0, 15)) lines.push(`- ${c.suite.name} \`${t.route}\` ${t.detail.replace(/\|/g, '\\|')}`);
		lines.push('', '</details>');
	}
	const fixed = comparison.suites.filter((c) => c.fixed.length);
	if (fixed.length) {
		lines.push('', '<details><summary>Routes green here that are red on main</summary>', '');
		for (const c of fixed) lines.push(`- ${c.suite.name}: ${c.fixed.map((r) => `\`${r}\``).join(', ')}`);
		lines.push('', '</details>');
	}
	const known = comparison.suites.filter((c) => c.knownReds.length);
	if (known.length) {
		lines.push('', '<details><summary>Known reds (red on main too, not counted)</summary>', '', '| Suite | Route | Red on | Owner |', '| --- | --- | --- | --- |');
		for (const c of known) for (const k of c.knownReds) lines.push(`| ${c.suite.name} | \`${k.route}\` | ${k.dimensions.join(', ')} | ${k.owner} |`);
		lines.push('', '</details>');
	}
	const disabled = comparison.suites.filter((c) => c.suite.disabled);
	if (disabled.length) {
		lines.push('', '<details><summary>Suites not run</summary>', '');
		for (const c of disabled) lines.push(`- ${c.suite.name}: ${c.suite.disabled}`);
		lines.push('', '</details>');
	}
	lines.push('');
	return lines.join('\n');
}
