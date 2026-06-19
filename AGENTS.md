# AGENTS.md

## Branching

- Use `dev` for feature work, fixes, and normal commits.
- Use `main` as the release branch. It should contain only verified, releasable code and stay synced with `origin/main`.
- Do not develop directly on `main`.
- Merge `dev` into `main` with fast-forward only:

```bash
git switch main
git fetch origin
git merge --ff-only dev
```

If fast-forward is not possible, stop and explain the reason. Do not rewrite history.

## Validation

Before committing, run:

```bash
npm run format:check
npm run typecheck
npm test
```

Before releasing, also run:

```bash
npm pack --dry-run
```

## Release

This package is published through GitHub Actions and npm Trusted Publishing. Do not run `npm publish` locally.

Only run this flow when the user explicitly asks for a release. Normal development tasks must not bump versions, push tags, or trigger npm publishing.

Release steps:

```bash
git switch dev
npm run format:check
npm run typecheck
npm test
git status --short

git switch main
git fetch origin
git merge --ff-only dev

npm version patch
npm run format:check
npm run typecheck
npm test
npm pack --dry-run

git push origin main
git push origin vX.Y.Z
```

Notes:

- `npm version patch` updates `package.json` and `package-lock.json`, then creates a version commit and a `vX.Y.Z` tag.
- Use `npm version minor` or `npm version major` only when the user explicitly asks for that release level.
- GitHub Actions is triggered by tags matching `v*`.
- Workflow: `.github/workflows/publish.yml`.
- Do not push `dev` unless the user explicitly asks.

After pushing, confirm the release:

```bash
gh run list --repo shkero/n8n-nodes-domain --workflow publish.yml --limit 5
gh run watch <run-id> --repo shkero/n8n-nodes-domain --exit-status
npm view n8n-nodes-domain version --json
```

After a successful release, fast-forward `dev` to `main`:

```bash
git switch dev
git merge --ff-only main
```

## Domain Lookup Constraints

- The node only queries domain registration information. It must not register, renew, modify, or schedule domains.
- Domain normalization should continue to use `tldts` and the existing helpers.
- `.cn` uses the dedicated CNNIC WHOIS path and must not use the generic RDAP fallback.
- Other TLDs use the IANA RDAP DNS bootstrap to find authoritative endpoints.
- Do not output registrant, contact, address, phone, or other personal information fields.
- User-visible changes to input parameters, output fields, or error messages must update tests and README.
- Explain the need for any new runtime dependency and get user confirmation before adding it.
