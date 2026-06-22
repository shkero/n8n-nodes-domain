# n8n-nodes-domain

[中文](README.md) | [English](README.en.md)

An n8n community node package for looking up domain registration information.

The first node, **Domain Lookup**, accepts a domain, subdomain, or HTTP(S) URL and returns normalized domain registration data that can be used in n8n workflows for expiration checks.

## Features

- Normalize user input to an ASCII registrable domain.
- Collapse subdomains to the registrable domain, for example `api.shop.example.co.uk` to `example.co.uk`.
- Query free IANA RDAP or CNNIC WHOIS sources without credentials or API keys.
- Return a stable output shape for registered, not found, and failure cases.
- Exclude registrant, contact, address, phone, and other personal data.

## Supported TLDs

This package supports two TLD groups:

- Domains whose root TLD is `.cn`, including `.cn`, `.com.cn`, `.net.cn`, and `.org.cn`: queried directly through CNNIC WHOIS `whois.cnnic.cn:43`; they do not use the generic RDAP fallback path.
- TLDs published in the IANA RDAP DNS bootstrap: fetched at runtime from `https://data.iana.org/rdap/dns.json` and cached for 24 hours.

Common supported examples:

- `.com`
- `.net`
- `.org`
- `.xyz`
- `.uk`
- `.cn`

`.xyz` is only a common IANA RDAP-covered example, not a project-specific special case.

If a TLD is not supported by the IANA RDAP DNS bootstrap and this package has no project-specific provider for it, the node returns a structured `TLD_NOT_SUPPORTED` result and does not request RDAP fallback. This prevents "no authoritative lookup source" from being misreported as "domain is not registered". `.co` and `.io` are not supported by default at this time.

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
- `expiry.expiresAtTimestamp`
- `expiry.daysUntilExpiration`
- `expiry.isExpired`
- `nameservers`
- `source`
- `error`

`isRegistered` is the field that distinguishes a found domain from an authoritative not-found response.

For `.cn` lookups, `source.protocol` is `whois`. For RDAP lookups, `source.protocol` is `rdap`.

For successful lookups and authoritative not-found responses, `error` is `null`. When the node cannot determine the registration status, `isRegistered` is `null` and `error.code` contains the reason, for example `TLD_NOT_SUPPORTED`.

RDAP fallback is an internal reliability mechanism, not a node option. When fallback succeeds, `source.type` is `fallback`, and `source.url` records the fallback entry URL requested by this node.

`expiry.expiresAtTimestamp` is the millisecond timestamp for `dates.expiresAt`; it is `null` when no valid expiration time is available. `expiry.daysUntilExpiration` is calculated from the current node execution time and expiration time, rounded down to whole days. This node does not output reminder thresholds; reminder timing should be handled by downstream n8n nodes.

Common error codes:

| Error Code                          | Meaning                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `INVALID_INPUT`                     | The input is not a supported domain, subdomain, or HTTP(S) URL              |
| `TLD_NOT_SUPPORTED`                 | The domain was normalized, but this package has no lookup route for the TLD |
| `RDAP_BOOTSTRAP_UNAVAILABLE`        | The IANA RDAP bootstrap request failed or returned an invalid structure     |
| `RDAP_SOURCE_UNAVAILABLE`           | The RDAP HTTP, network, or service source is unavailable                    |
| `RDAP_RESPONSE_PARSE_FAILED`        | The RDAP response could not be parsed as a domain object                    |
| `CNNIC_WHOIS_UNAVAILABLE`           | The CNNIC WHOIS connection, timeout, or network path is unavailable         |
| `CNNIC_WHOIS_RATE_LIMITED`          | CNNIC WHOIS returned a rate limit response                                  |
| `CNNIC_WHOIS_RESPONSE_PARSE_FAILED` | The CNNIC WHOIS response could not be parsed as a domain record             |

Invalid input throws a node error by default. Query-stage errors after the domain has been normalized are returned in the structured `error` output when n8n `Continue On Fail` is enabled.

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
