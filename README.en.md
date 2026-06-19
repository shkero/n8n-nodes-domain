# n8n-nodes-domain

[中文](README.md) | [English](README.en.md)

An n8n community node package for looking up domain registration information.

The first node, **Domain Lookup**, accepts a domain, subdomain, or HTTP(S) URL and returns normalized RDAP registration data that can be used in n8n workflows for expiration checks.

## Features

- Normalize user input to an ASCII registrable domain.
- Collapse subdomains to the registrable domain, for example `api.shop.example.co.uk` to `example.co.uk`.
- Query free RDAP sources without credentials or API keys.
- Return a stable output shape for registered, not found, and failure cases.
- Exclude registrant, contact, address, phone, and other personal data.

## Supported TLDs

This package supports two TLD groups:

- `.cn`: queried directly through CNNIC WHOIS `whois.cnnic.cn:43`; it does not use the generic RDAP fallback path.
- TLDs published in the IANA RDAP DNS bootstrap: fetched at runtime from `https://data.iana.org/rdap/dns.json` and cached for 24 hours.

Common supported examples:

- `.com`
- `.net`
- `.org`
- `.io`
- `.uk`
- `.cn`

Unsupported TLDs do not enter the RDAP fallback lookup flow. The node returns an unsupported TLD error instead, so "no authoritative lookup source" is not misreported as "domain is not registered".

## Node

### Domain Lookup

Input:

- `Domain`: required. Supports a domain, subdomain, HTTP(S) URL, or no-protocol URL-like value.

Output fields:

- `asciiDomain`
- `publicSuffix`
- `isRegistered`
- `status`
- `dates.registeredAt`
- `dates.expiresAt`
- `dates.lastChangedAt`
- `dates.dataUpdatedAt`
- `expiry.daysUntilExpiration`
- `expiry.isExpired`
- `nameservers`
- `source`

`isRegistered` is the field that distinguishes a found domain from an authoritative not-found response.

For `.cn` lookups, `source.protocol` is `whois`. For RDAP lookups, `source.protocol` is `rdap`.

## Development

Requirements:

- Node.js 22 or newer
- npm

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Type check:

```bash
npm run typecheck
```

Check formatting:

```bash
npm run format:check
```

## Runtime Dependency

This package uses `tldts` to calculate the registrable domain from the ICANN Public Suffix List. This is required so inputs like `api.shop.example.co.uk` normalize correctly to `example.co.uk` instead of using an unsafe "last two labels" rule.

`.cn` uses CNNIC WHOIS. CNNIC WHOIS timestamps do not include an explicit timezone, so the node outputs them as UTC ISO 8601 strings to keep the output format stable.

## Build Note

The node imports `n8n-workflow` at runtime from the n8n environment. This repository currently uses local minimal type declarations in `types/n8n-workflow.d.ts` so the package can install and build without pulling the full n8n runtime dependency tree into this project.

## Publishing

This project publishes packages through GitHub Actions and npm Trusted Publishing.

Trigger:

- Push a Git tag matching `v*`, for example `v0.1.1`.
- Workflow file: `.github/workflows/publish.yml`.
- GitHub Actions uses Node.js 24.
- `NPM_TOKEN` is not required, but the npm package must be configured with Trusted Publisher on npmjs.com.

Release steps:

```bash
npm version patch
git push
git push --tags
```

Notes:

- Update `package.json` `version` before every release. npm package versions cannot be reused.
- If `n8n-nodes-domain` does not exist on npm yet, the first publish may need to be completed before Trusted Publisher can be configured in package Settings.

## Credentials

No credentials are required for v1.
