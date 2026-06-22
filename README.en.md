# n8n-nodes-domain

[中文](README.md) | [English](README.en.md)

An n8n community node package for looking up domain registration information.

The first node, **Domain Lookup**, accepts a domain, subdomain, or HTTP(S) URL and returns normalized domain registration data that can be used in n8n workflows for expiration checks.

## Features

- Normalize user input to an ASCII registrable domain.
- Collapse subdomains to the registrable domain, for example `api.shop.example.co.uk` to `example.co.uk`.
- Query free IANA RDAP or registry WHOIS sources without credentials or API keys.
- Return a stable output shape for registered, not found, and failure cases.
- Exclude registrant, contact, address, phone, and other personal data.

## Lookup Routes

The node currently has two lookup route types:

- Dedicated WHOIS providers: domains whose root TLD is `.cn` use CNNIC WHOIS `whois.cnnic.cn:43`; root TLD `.io` uses `whois.nic.io:43`; root TLD `.co` uses `whois.registry.co:43`.
- TLDs published in the IANA RDAP DNS bootstrap: fetched at runtime from `https://data.iana.org/rdap/dns.json` and cached in the current n8n process for up to 24 hours.

Dedicated WHOIS examples:

- `.cn`
- `.io`
- `.co`

Common IANA RDAP examples:

- `.com`
- `.net`
- `.org`
- `.xyz`
- `.uk`

Dedicated WHOIS providers do not use RDAP fallback. RDAP fallback is only an internal reliability mechanism for the RDAP route.

If the normalized TLD is neither handled by a dedicated WHOIS provider nor present in the runtime IANA RDAP DNS bootstrap, the node returns a structured `TLD_NOT_SUPPORTED` result and does not request RDAP fallback. This prevents "no authoritative lookup source" from being misreported as "domain is not registered".

## Node

### Domain Lookup

Input:

- `Domain`: required. Supports a domain, subdomain, HTTP(S) URL, or no-protocol URL-like value.

Optional settings:

- `Include Input Data`: disabled until this option is added in `Options`; once added, it defaults to enabled and copies the current input item's `json` data into the output.
- `Input Data Mode`: `All Fields` copies the full input `json`; `Selected Fields` copies only the selected fields.
- `Input Field Name`: output container field name, default `input`. It may only contain letters, numbers, and underscores, and cannot conflict with node output fields.
- `Input Fields`: used in `Selected Fields` mode. It accepts comma-separated or newline-separated field paths, and supports dragging multiple fields from the n8n input data panel. Missing fields are ignored.

`Input Fields` expects field paths, not field values. For non-ASCII field names or field names containing special characters, use bracket notation.

`Input Fields` examples:

```text
recordId, fields.domain, fields["Chinese Field"].text
```

Common n8n current-item path syntax is also supported:

```text
$json.fields["expiresAt"]
={{ $json.fields["Chinese Field"].text }}
```

Output fields are grouped by purpose:

- Domain: `asciiDomain`, `publicSuffix`
- Registration status: `isRegistered`, `status`
- Dates and expiration: `dates`, `expiry`
- DNS: `nameservers`
- Lookup source: `source`
- Error details: `error`

`isRegistered` is the field that distinguishes a found domain from an authoritative not-found response.

For `.cn`, `.io`, and `.co` lookups, `source.protocol` is `whois`. For RDAP lookups, `source.protocol` is `rdap`.

For successful lookups and authoritative not-found responses, `error` is `null`. When the node cannot determine the registration status, `isRegistered` is `null` and `error.code` contains the reason, for example `TLD_NOT_SUPPORTED`.

RDAP fallback is an internal reliability mechanism, not a node option. When fallback succeeds, `source.type` is `fallback`, and `source.url` records the fallback entry URL requested by this node.

`expiry.expiresAtTimestamp` is the millisecond timestamp for `dates.expiresAt`; it is `null` when no valid expiration time is available. `expiry.daysUntilExpiration` is calculated from the current node execution time and expiration time, rounded down to whole days. This node does not output reminder thresholds; reminder timing should be handled by downstream n8n nodes.

Error handling:

| Error Code                          | Meaning                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `INVALID_INPUT`                     | The input is not a supported domain, subdomain, or HTTP(S) URL              |
| `TLD_NOT_SUPPORTED`                 | The domain was normalized, but this package has no lookup route for the TLD |
| `RDAP_BOOTSTRAP_UNAVAILABLE`        | The IANA RDAP bootstrap request failed or returned an invalid structure     |
| `RDAP_SOURCE_UNAVAILABLE`           | The RDAP HTTP, network, or service source is unavailable                    |
| `RDAP_RESPONSE_PARSE_FAILED`        | The RDAP response could not be parsed as a domain object                    |
| `WHOIS_SOURCE_UNAVAILABLE`          | The registry WHOIS connection, timeout, or network path is unavailable      |
| `WHOIS_RATE_LIMITED`                | Registry WHOIS returned a rate limit response                               |
| `WHOIS_RESPONSE_PARSE_FAILED`       | The registry WHOIS response could not be parsed as a domain record          |
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

`.io` and `.co` use their registry WHOIS services. Registrant, contact, address, phone, and other personal data from WHOIS responses are not included in the node output.

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
