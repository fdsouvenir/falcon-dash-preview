# Contributing to Falcon Dash

Thank you for your interest in contributing to Falcon Dash!

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- A running [OpenClaw](https://github.com/openclaw/openclaw) gateway (for integration testing)

## Local Setup

```bash
git clone https://github.com/fdsouvenir/falcon-dash.git
cd falcon-dash
npm install
npm run dev
```

The dev server starts at `http://localhost:5173`. The gateway connection is maintained server-side; the browser talks to the dashboard over same-origin `/api/gateway/*` routes. Gateway config is resolved from `GATEWAY_URL`/`GATEWAY_TOKEN` env vars, the OpenClaw CLI, or `~/.openclaw/openclaw.json` (in that order).

## Available Scripts

| Command                 | Description                        |
| ----------------------- | ---------------------------------- |
| `npm run dev`           | Start the Vite dev server with HMR |
| `npm run build`         | Production build                   |
| `npm run check`         | TypeScript type checking           |
| `npm run lint`          | ESLint                             |
| `npm run format`        | Format all files with Prettier     |
| `npm run format:check`  | Check formatting without writing   |
| `npm run test`          | Run tests                          |
| `npm run test:watch`    | Run tests in watch mode            |
| `npm run test:coverage` | Run tests with coverage report     |

## Branch Naming

- `feat/` — new features
- `fix/` — bug fixes
- `chore/` — maintenance, dependencies, tooling
- `docs/` — documentation changes

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — a new feature
- `fix:` — a bug fix
- `chore:` — maintenance tasks
- `docs:` — documentation changes
- `refactor:` — code restructuring without behavior change
- `test:` — adding or updating tests

## Pull Request Process

1. Create a branch from `main` using the naming convention above.
2. Make your changes and ensure all checks pass:
   ```bash
   npm run format:check
   npm run lint
   npm run check
   npm run test
   npm run build
   ```
3. Open a PR against `main`. Fill out the PR template.
4. Address review feedback.

## Code Style

Code style is enforced automatically:

- **Prettier** formats on save and at commit time (via Husky + lint-staged)
- **ESLint** catches common issues
- **TypeScript** strict mode is enabled

Configuration: tabs, single quotes, no trailing commas, 100 character print width.

### Svelte 5

This project uses Svelte 5 runes. Use `$state()`, `$derived()`, `$effect()`, `$props()` and `onevent` handlers (not Svelte 4 `on:event` syntax).

## Testing

Unit tests use [Vitest](https://vitest.dev/) with happy-dom. Test files live next to the code they test using the `*.test.ts` convention.

```bash
npm run test              # Run all tests once
npm run test:watch        # Watch mode
npm run test:coverage     # With v8 coverage report
npm run test:ui           # Browser UI
```

## CI/CD

All pushes and PRs to `main` trigger the **CI** workflow, which runs format check, lint, type check, tests with coverage, and a production build.

Additional workflows:

- **Release** — triggered by pushing a `v*` tag; runs CI then creates a GitHub Release with auto-generated notes
- **Publish** — triggered by pushing a `v*` tag; publishes the npm package to GitHub Packages
- **E2E** — Playwright end-to-end tests on pushes and PRs
- **Dependabot** — weekly npm dependency updates

## Release Process

```bash
npm version patch    # or minor / major — bumps version in package.json and creates a git tag
git push origin main --tags
```

This triggers the Release and Publish workflows automatically.

## Branch Protection (recommended for `main`)

- Require pull request before merging (1 approval minimum)
- Require status checks to pass: `quality` (from CI workflow)
- Require branches to be up to date before merging
- Require linear history (squash or rebase merges)
- Do not allow force pushes
- Do not allow branch deletion
