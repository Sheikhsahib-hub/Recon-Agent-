# Recon Agent — Private Inventory

A loopback-only dashboard that reads DNS records from provider accounts you
configure, and can also import a CSV/JSON inventory. Provider credentials stay
in the local Node.js API process. The app does not discover arbitrary domains
or send DNS/HTTP requests to the hostnames listed in provider records.

## Run locally

Requires Node.js 20 or newer.

```powershell
npm install
npm run dev
```

Copy `.env.example` to `.env`, configure only the provider(s) you use, then run
`npm run dev`. Open the loopback URL printed by Vite. Both the UI and API bind
to `127.0.0.1`. Never commit `.env` or paste credentials into chat.

The `dev` script runs the Vite frontend and the local API together. Stop it
with `Ctrl+C` in the terminal where it was started.

## GitHub

This repository includes a GitHub Actions workflow that installs locked
dependencies and verifies the TypeScript/Vite production build on Node.js 20
and 22. From the project folder, you can create a repository on GitHub and
push this project using the commands GitHub provides for an existing project.
Do not upload `.env`, cloud credential files, or other secrets.

This project is **not a static GitHub Pages app**: provider sync requires the
Node.js API. The API intentionally listens on loopback and is not configured
for public hosting. Do not expose it to the internet without adding user
authentication, authorization, CSRF protections, and secure secret management.

## Read-only provider setup

- **Cloudflare:** create an API token with `Zone:Read` and `DNS:Read` access and
  set `CLOUDFLARE_API_TOKEN`.
- **AWS Route 53:** configure the AWS SDK credential chain locally (environment
  variables or `~/.aws/credentials`). The IAM
  identity should have only `route53:ListHostedZones` and
  `route53:ListResourceRecordSets` permissions.
- **Google Cloud DNS:** configure Application Default Credentials locally and
  set `GOOGLE_CLOUD_PROJECT`. Grant only DNS read access.

Click **Sync provider accounts** to list managed zones and DNS records. API
errors are shown per provider. No credentials are returned to the browser or
stored by this app.

## Import format

Choose a CSV or JSON file to merge additional inventory. CSV requires a
`hostname` column and can optionally include `state`, `status`, `server`,
`tech` (or `technology`), `recordType`, `value`, `ttl`, and `provider` columns.
JSON can be an array of host objects or an object containing a `hosts` array.
Each host may use `hostname` (or `host`), `state`, `status`, `server`, and
`tech` (or `technology`) fields. If `state` is missing, a numeric HTTP status
produces `up`; otherwise the state defaults to `unknown`. State and status are
values from your file, not observations made by this app.

Provider records show `Configured` state because the DNS provider has a
configured record; this is not a live availability check. Server headers,
HTTP status, and technology are shown only if supplied in an imported file:
the app does not probe target websites to obtain them. DNS record values may
contain sensitive account data, so use only a trusted local machine.

The domain field filters loaded hostnames locally. JSON and CSV exports contain
the currently visible records.
