# n8n-nodes-domain

An n8n community node package for looking up domain registration information.

The first node, **Domain Lookup**, accepts a domain, subdomain, or HTTP(S) URL and returns normalized RDAP registration data that can be used in n8n workflows for expiration checks.

## Features

- Normalize user input to an ASCII registrable domain.
- Collapse subdomains to the registrable domain, for example `api.shop.example.co.uk` to `example.co.uk`.
- Query free RDAP sources without credentials or API keys.
- Return a stable output shape for registered, not found, and failure cases.
- Exclude registrant, contact, address, phone, and other personal data.

## Node

### Domain Lookup

Input:

- `Domain`: a required domain, subdomain, HTTP(S) URL, or no-protocol URL-like value.

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

## Runtime dependency

This package uses `tldts` to calculate the registrable domain from the ICANN Public Suffix List. This is required so inputs like `api.shop.example.co.uk` normalize correctly to `example.co.uk` instead of using an unsafe "last two labels" rule.

## Build note

The node imports `n8n-workflow` at runtime from the n8n environment. This repository currently uses local minimal type declarations in `types/n8n-workflow.d.ts` so the package can install and build without pulling the full n8n runtime dependency tree into this project.

## Credentials

No credentials are required for v1.
