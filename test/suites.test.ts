import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobCount, shard } from '../src/suites.ts';
import docusaurus from '../suites/docusaurus.ts';
import shadcnUi from '../suites/shadcn-ui.ts';

test('shadcn-ui splits its full lane so the heaviest routes land in different jobs', () => {
	assert.equal(jobCount(shadcnUi, 'full'), 9);
	const jobs = Array.from({ length: 9 }, (_, i) => shard(shadcnUi.routes.full, `${i + 1}/9`));
	assert.ok(jobs.every((routes) => routes.length <= 3));
	assert.ok(!jobs.some((routes) => routes.includes('/colors') && routes.includes('/docs/components/radix/dropdown-menu')));
});

test('a suite without routesPerJob keeps the default split', () => {
	assert.equal(jobCount(docusaurus, 'full'), Math.ceil(docusaurus.routes.full.length / 25));
	assert.equal(jobCount(shadcnUi, 'sample'), Math.ceil(shadcnUi.routes.sample.length / 2));
});
