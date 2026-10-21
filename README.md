# markless-ecosystem-ci

The sites ported to [Markless](https://github.com/compiled-run/markless) by
[markless-migrate](https://github.com/thejackshelton/markless-migrate), used as a regression suite for Markless
itself. Each suite builds one migrated site against a Markless commit, runs the site's build (and its own tests,
when it has any), serves it, and runs `markless-migrate check` on a sample of its routes against a capture of the
old site. The result is compared with Markless main's last nightly result, so only what got worse fails.

It follows [vite-ecosystem-ci](https://github.com/vitejs/vite-ecosystem-ci) and
[vuejs/ecosystem-ci](https://github.com/vuejs/ecosystem-ci): one file per suite in `suites/`, the framework
replaced by tarballs packed from the ref under test through package manager overrides, a PR comment trigger, a
nightly run, and a results table that compares each suite with main. It differs in what a suite checks: instead
of a project's test command, each suite runs the browser check that proved the port, route by route, and compares
failures one by one, not only pass or fail.

## How a run works

1. **Markless at the ref.** `ecosystem-ci.ts build` checks out the ref (or uses a checkout), runs `pnpm install`
   and `pnpm build`, and packs every published `@markless/*` package with `pnpm pack`. Private workspace packages
   (today `@markless/ui`, `@markless/icons`, `@markless/ui-tools`) are not overridden: a real site can only get
   them from npm, so the sites keep the published version.
2. **The site on those packs.** The markless-migrate checkout is pinned in `migrate.json`. For each suite, the
   site's `package.json` gets every `@markless/*` dependency pointed at its tarball, as a dependency and as an npm
   `overrides` entry (so a package that depends on another `@markless` package gets the packed one too). Then
   `npm install`, the suite's prepare steps, `npm run build`, and the site's own tests.
3. **A sealed network.** The site server and the checker run with every request going through the seal
   (`src/seal/server.ts`), an HTTP proxy. Chromium is pointed at it by `src/seal/preload.mjs`; Node processes get
   `HTTPS_PROXY` with `NODE_USE_ENV_PROXY=1` and trust the run's own certificate authority through
   `NODE_EXTRA_CA_CERTS`. The site under test (on `127.0.0.1`) is passed straight through. Every other request,
   the old site included, is answered from `captures/<suite>/` and never reaches the network. A request the
   capture does not hold gets a 504 and is listed in the result as a miss.
4. **The check.** `markless-migrate check --old <the old site's real origin> --new http://127.0.0.1:<port>` on the
   lane's routes. The old side is the same origin the port was proved against, served from the capture, so the
   checker sees the same old pages every run.
5. **The comparison.** `ecosystem-ci.ts compare` reads every suite's result and `baselines/<lane>/<suite>.json`
   (main's last nightly result) and reports a regression when:
   - a step (install, build, test, serve, check) fails that passed on main;
   - a route has a failure whose id main does not have (failure ids are stable across runs for the same
     difference on the same route and viewport);
   - JavaScript downloaded or run at load grows by more than 2 KB and 5% over main;
   - a route main checked could not be checked;
   - the site makes a request main does not make (a capture miss main did not have).
   A route red on main too is a known red: it is listed with its owner and never fails a run.

## Lanes

- **sample** (per pull request, release gate): a few routes per site, picked to cover the shapes that break:
  in-place navigation, big pages, dialogs and menus, keyed lists, idle or visible handlers, page scripts, theme
  classes and streaming. `node ecosystem-ci.ts list` prints each route and what it covers.
- **full** (nightly): every route each port is checked on, split into CI jobs of up to 60 routes.

## Triggers

Nothing here needs a stored secret, a GitHub App or a personal token.

- **A pull request comment.** A maintainer (owner, member or collaborator) comments `/ecosystem-ci run` (or
  `/ecosystem-ci run shadcn-admin htmx-org`) on a compiled-run/markless pull request. Markless's own
  `.github/workflows/ecosystem-ci.yml` checks out this public repository and the pull request's commit, runs the
  suites in its own Actions run (the jobs that build pull request code get a read-only token), and posts the table
  on the pull request with its own `GITHUB_TOKEN`.
- **A dispatch.** In compiled-run/markless: `gh workflow run ecosystem-ci.yml -f ref=<commit> [-f pr=<n>]`. Here:
  `gh workflow run nightly.yml -f ref=<branch, tag, commit or pr/<n>>`.
- **The release gate.** Markless's release cut (`release.yml`, mode `cut`) dispatches its `ecosystem-ci.yml` on the
  release commit and waits for it before `main` moves; a regression stops the release.
- **Nightly.** `nightly.yml` runs both lanes on Markless main every night, opens (or adds to) an issue labelled
  `ecosystem-regression` here when there are new reds, and commits the night's results to `baselines/`.

## Running it locally

```sh
npm install
# against a Markless checkout, one suite, the per-PR sample:
node ecosystem-ci.ts run shadcn-admin --markless-dir ../markless
# against a ref:
node ecosystem-ci.ts run --ref pr/123
# compare with the baseline:
node ecosystem-ci.ts compare --lane sample --markdown report.md
```

From a Markless checkout, `node scripts/ci/ecosystem-ci.mjs run shadcn-admin` fetches this repository into
`.ecosystem-ci/` and runs it against that checkout.

## Captures

`node ecosystem-ci.ts run <suite> --record` runs the suite against the live network and writes what every request
got into `captures/<suite>/` (`index.json`, and each body once, brotli-compressed, under `bodies/`). Record with
Markless main, so the capture holds what main's build asks for too, then rerun without `--record` twice to see the
replay is complete (no misses) and stable (the same failures). Only GET, HEAD and OPTIONS requests and
third-party reads are recorded; the old site's own writes are held back by the checker, and nothing else is sent.

## Suites

One file per site in `suites/`, with its route lists in `suites/routes/`. A suite that cannot run yet carries a
`disabled` reason, shown in every report.

| Suite | Site | Old site |
| --- | --- | --- |
| shadcn-admin | `examples/shadcn-admin-markless` | https://mm-shadcn-admin-old.vercel.app |

## Known reds

A red route on main is listed in its suite's baseline with its owner (`owner` on the route in
`baselines/<lane>/<suite>.json`), and in the "Known reds" part of every report. It is fixed in the port, in
markless-migrate, and the next nightly baseline drops it.
