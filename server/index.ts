import "dotenv/config";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import express from "express";
import { DNS } from "@google-cloud/dns";
import {
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  Route53Client,
  type ListResourceRecordSetsCommandInput
} from "@aws-sdk/client-route-53";

type ProviderName = "Cloudflare" | "AWS Route 53" | "Google Cloud DNS";
interface AssetRecord {
  hostname: string;
  state: string;
  status: number | null;
  server: string;
  tech: string;
  provider: ProviderName | "File";
  recordType: string;
  value: string;
  ttl: number | null;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

const configuredProviders = () => ({
  cloudflare: Boolean(process.env.CLOUDFLARE_API_TOKEN),
  aws: Boolean(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE ||
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
    existsSync(join(homedir(), ".aws", "credentials")) ||
    existsSync(join(homedir(), ".aws", "config"))),
  google: Boolean(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_AUTH ||
    existsSync(join(process.env.APPDATA || homedir(), "gcloud", "application_default_credentials.json")))
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, providers: configuredProviders() });
});

app.post("/api/assets", async (_request, response) => {
  const configured = configuredProviders();
  if (!Object.values(configured).some(Boolean)) {
    response.status(503).json({
      error: "No provider configured. Set up read-only credentials in your local .env file."
    });
    return;
  }

  const results = await Promise.all([
    configured.cloudflare ? loadCloudflare().then(
      (assets) => ({ provider: "Cloudflare", assets, error: null }),
      (error: unknown) => {
        console.error("Cloudflare inventory request failed:", error);
        return { provider: "Cloudflare", assets: [], error: "Could not read Cloudflare inventory. Check token permissions and server logs." };
      }
    ) : null,
    configured.aws ? loadRoute53().then(
      (assets) => ({ provider: "AWS Route 53", assets, error: null }),
      (error: unknown) => {
        console.error("Route 53 inventory request failed:", error);
        return { provider: "AWS Route 53", assets: [], error: "Could not read Route 53 inventory. Check IAM permissions and server logs." };
      }
    ) : null,
    configured.google ? loadGoogleDns().then(
      (assets) => ({ provider: "Google Cloud DNS", assets, error: null }),
      (error: unknown) => {
        console.error("Google Cloud DNS inventory request failed:", error);
        return { provider: "Google Cloud DNS", assets: [], error: "Could not read Google Cloud DNS inventory. Check ADC and IAM permissions." };
      }
    ) : null
  ]);
  const providers = results.filter((result): result is NonNullable<typeof result> => result !== null);
  const assets = providers.flatMap((result) => result.assets);
  response.json({
    source: "provider-account-dns-inventory",
    observationMethod: "Provider account API only; no target DNS or HTTP probing",
    assets,
    providers: providers.map(({ provider, error }) => ({ provider, error }))
  });
});

async function loadCloudflare(): Promise<AssetRecord[]> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("Missing Cloudflare token");
  const zones: Array<{ id: string; name: string }> = [];
  for (let page = 1; page <= 10; page += 1) {
    const data = await cloudflareGet<{ id: string; name: string }[]>(
      `/zones?per_page=50&page=${page}`, token
    );
    zones.push(...data.result);
    if (page >= data.result_info.total_pages) break;
  }

  const assets: AssetRecord[] = [];
  for (const zone of zones) {
    for (let page = 1; page <= 100; page += 1) {
      const data = await cloudflareGet<Array<{
        name: string; type: string; content: string; ttl: number
      }>>(`/zones/${encodeURIComponent(zone.id)}/dns_records?per_page=1000&page=${page}`, token);
      assets.push(...data.result.map((record) => toAsset({
        hostname: record.name,
        type: record.type,
        value: record.content,
        ttl: record.ttl
      }, "Cloudflare")));
      if (page >= data.result_info.total_pages) break;
    }
  }
  return assets;
}

async function cloudflareGet<T>(path: string, token: string): Promise<{
  result: T;
  result_info: { total_pages: number };
}> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Cloudflare API returned HTTP ${response.status}`);
  const body = await response.json() as {
    success: boolean;
    errors?: Array<{ message?: string }>;
    result: T;
    result_info: { total_pages: number };
  };
  if (!body.success) throw new Error(body.errors?.map((error) => error.message).join("; ") || "Cloudflare API request failed");
  return body;
}

async function loadRoute53(): Promise<AssetRecord[]> {
  const client = new Route53Client({});
  const assets: AssetRecord[] = [];
  let marker: string | undefined;
  do {
    const zones = await client.send(new ListHostedZonesCommand({
      Marker: marker,
      MaxItems: 100
    }));
    for (const zone of zones.HostedZones ?? []) {
      if (!zone.Id || !zone.Name) continue;
      let startRecordName: string | undefined;
      let startRecordType: ListResourceRecordSetsCommandInput["StartRecordType"];
      let startRecordIdentifier: string | undefined;
      let truncated: boolean;
      do {
        const page = await client.send(new ListResourceRecordSetsCommand({
          HostedZoneId: zone.Id,
          StartRecordName: startRecordName,
          StartRecordType: startRecordType,
          StartRecordIdentifier: startRecordIdentifier,
          MaxItems: 300
        }));
        for (const record of page.ResourceRecordSets ?? []) {
          const value = record.ResourceRecords?.map((item) => item.Value ?? "").filter(Boolean).join(" | ") ||
            record.AliasTarget?.DNSName || "(no record data)";
          assets.push(toAsset({
            hostname: record.Name ?? zone.Name,
            type: record.Type ?? "Unknown",
            value,
            ttl: record.TTL ?? null
          }, "AWS Route 53"));
        }
        truncated = page.IsTruncated ?? false;
        startRecordName = page.NextRecordName;
        startRecordType = page.NextRecordType;
        startRecordIdentifier = page.NextRecordIdentifier;
      } while (truncated);
    }
    marker = zones.IsTruncated ? zones.NextMarker : undefined;
  } while (marker);
  return assets;
}

async function loadGoogleDns(): Promise<AssetRecord[]> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Set GOOGLE_CLOUD_PROJECT and configure Application Default Credentials");
  }
  const dns = new DNS({ projectId });
  const [zones] = await dns.getZones({ autoPaginate: true, maxApiCalls: 20 });
  const assets: AssetRecord[] = [];
  for (const zone of zones) {
    const [records] = await zone.getRecords({ autoPaginate: true, maxApiCalls: 50 });
    for (const record of records) {
      const metadata = record.metadata;
      assets.push(toAsset({
        hostname: metadata.name,
        type: record.type,
        value: Array.isArray(metadata.data) ? metadata.data.join(" | ") :
          metadata.data ?? metadata.rrdatas?.join(" | ") ?? "(no record data)",
        ttl: metadata.ttl
      }, "Google Cloud DNS"));
    }
  }
  return assets;
}

function toAsset(record: {
  hostname: string;
  type: string;
  value: string;
  ttl: number | null;
}, provider: AssetRecord["provider"]): AssetRecord {
  return {
    hostname: record.hostname.replace(/\.$/, ""),
    state: "Configured",
    status: null,
    server: "Not checked",
    tech: "Not detected",
    provider,
    recordType: record.type,
    value: record.value,
    ttl: record.ttl
  };
}

const port = Number(process.env.API_PORT || 3001);
app.listen(port, "127.0.0.1", () => {
  console.log(`Private inventory API listening at http://127.0.0.1:${port}`);
});
