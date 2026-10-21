export type Lane = 'sample' | 'full';

/** One migrated site from markless-migrate: how to build it against a Markless ref and which routes to check. */
export interface Suite {
	readonly name: string;
	/** The app's folder inside the markless-migrate checkout. */
	readonly app: string;
	/** The old site's origin, exactly as its port was checked against it; served from the capture. */
	readonly old: string;
	/** Who answers for a red on this site. */
	readonly owner: string;
	/** Extra `npm install` flags the app needs. */
	readonly install?: readonly string[];
	/** Environment for the build, the site's own tests and its server. */
	readonly env?: Readonly<Record<string, string>>;
	/** Environment for the server only (NODE_ENV=production would make npm install skip devDependencies). */
	readonly serveEnv?: Readonly<Record<string, string>>;
	/** Commands run in the app folder before the build, after install (each an argv). */
	readonly prepare?: readonly (readonly string[])[];
	/** Defaults to `npm run build`. */
	readonly build?: readonly (readonly string[])[];
	/** The site's own tests, run after the build. */
	readonly test?: readonly (readonly string[])[];
	/** Defaults to `node .output/server/index.mjs` with PORT and HOST. */
	readonly serve?: readonly string[];
	readonly routes: {
		/** The per-PR sample: the risky shapes this site carries. */
		readonly sample: readonly SampleRoute[];
		/** The nightly lane: every route the port is checked on. */
		readonly full: readonly string[];
	};
	/** Extra `markless-migrate check` flags. */
	readonly check?: readonly string[];
	/**
	 * Checks whose result two replays of one build disagreed on: they run and are shown, not counted, until the
	 * nondeterminism is fixed. Each needs an owner and an expiry at most two weeks out; expired, it fails every run.
	 */
	readonly quarantine?: readonly Quarantine[];
	/** Why the suite is not run yet, when it is not; the reason shows in every report. */
	readonly disabled?: string;
}

export interface Quarantine {
	readonly route: string;
	readonly dimension: string;
	/** The start of the failure's check text. */
	readonly check: string;
	/** What varied, measured: which run had it and what it said. */
	readonly reason: string;
	readonly owner: string;
	/** YYYY-MM-DD */
	readonly until: string;
}

export interface SampleRoute {
	readonly route: string;
	/** The risky shape this route stands for. */
	readonly covers: readonly Shape[];
}

export type Shape = 'in-place navigation' | 'big page' | 'dialog' | 'menu' | 'keyed list' | 'idle or visible handler' | 'page script' | 'theme class' | 'streaming';

export interface FailureRecord {
	readonly id: string;
	readonly dimension: string;
	readonly check: string;
	readonly viewport?: string;
	readonly expected?: string;
	readonly actual?: string;
}

export interface RouteRecord {
	readonly ok: boolean;
	readonly dimensions: Record<string, string>;
	readonly failures: FailureRecord[];
	/** JavaScript at load on the new side, bytes. */
	readonly weight?: { readonly downloaded: number; readonly executed: number };
	readonly infrastructure?: string;
}

export type StepStatus = 'pass' | 'fail' | 'skipped';

/** One suite's run against one Markless commit: what CI compares and what a baseline stores. */
export interface SuiteResult {
	readonly suite: string;
	readonly lane: Lane;
	readonly markless: { readonly sha: string; readonly version: string; readonly ref?: string };
	readonly migrate: { readonly sha: string };
	readonly startedAt: string;
	readonly steps: { install: StepStatus; build: StepStatus; test: StepStatus; serve: StepStatus; check: StepStatus };
	readonly error?: string;
	readonly timings: Record<string, number>;
	readonly routes: Record<string, RouteRecord>;
	readonly seal: { readonly served: number; readonly loose: number; readonly misses: readonly string[] };
	readonly disabled?: string;
}
