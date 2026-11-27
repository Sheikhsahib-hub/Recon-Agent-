import "./styles.css";
import { HostTable, type HostRecord } from "./components/HostTable";
import { ProgressBar } from "./components/ProgressBar";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="Recon Agent home">
        <span class="brand-mark">R</span><span>RECON<span class="brand-light">/AGENT</span></span>
      </a>
      <div class="topbar-right"><span class="local-indicator"></span> OWNED PROVIDER ASSETS</div>
    </header>
    <section class="hero">
      <p class="eyebrow">AUTHORIZED ASSET INVENTORY</p>
      <h1>Know your <span>surface.</span></h1>
      <p class="hero-copy">Sync DNS inventory from your own Cloudflare, AWS Route 53 or Google Cloud DNS account. This app reads provider account records only; it never probes the hosts.</p>
      <form class="search-panel panel" id="inventory-form" novalidate>
        <label for="domain-input">FILTER BY DOMAIN (OPTIONAL)</label>
        <div class="input-row">
          <input id="domain-input" name="domain" type="text" placeholder="example.com — leave blank for all" autocomplete="off" spellcheck="false" />
          <button class="primary-button" type="submit" id="filter-button" disabled>Filter inventory</button>
        </div>
        <div class="inventory-actions">
          <button class="upload-button" type="button" id="sync-providers">↻ Sync provider accounts</button>
          <label class="upload-button" for="inventory-file">↑ Load CSV / JSON inventory</label>
          <input id="inventory-file" type="file" accept=".csv,.json,text/csv,application/json" />
          <button class="template-button" type="button" id="template-button">Download CSV template</button>
        </div>
        <p class="form-note" id="form-note">Provider credentials stay on this machine in the API process. Only official provider account APIs are queried; listed hosts are never contacted.</p>
      </form>
    </section>
    <section class="metrics" aria-label="Inventory summary">
      <article class="metric-card panel"><span class="metric-label">MATCHING HOSTS</span><strong id="metric-total">—</strong><span class="metric-foot">From loaded inventory</span></article>
      <article class="metric-card panel"><span class="metric-label">STATE: UP</span><strong id="metric-up">—</strong><span class="metric-foot">As reported in your file</span></article>
      <article class="metric-card panel"><span class="metric-label">DATA SOURCE</span><strong class="metric-mode">YOUR ACCOUNTS</strong><span class="metric-foot">DNS inventory metadata</span></article>
    </section>
    <div id="progress-slot"></div>
    <div class="results-heading"><div><p class="eyebrow">ASSET INVENTORY</p><h2>Surface overview</h2></div>
      <div class="export-actions"><button class="secondary-button" id="export-json" disabled>↓ JSON</button><button class="secondary-button" id="export-csv" disabled>↓ CSV</button></div>
    </div>
    <div id="table-slot"></div>
    <footer><span>RECON/AGENT <span class="footer-divider">•</span> PRIVATE INVENTORY</span><span>DNS account data only; HTTP status, server and tech are not probed.</span></footer>
  </main>
`;

const progress = new ProgressBar();
const table = new HostTable();
document.querySelector("#progress-slot")!.append(progress.element);
document.querySelector("#table-slot")!.append(table.element);

const form = document.querySelector<HTMLFormElement>("#inventory-form")!;
const input = document.querySelector<HTMLInputElement>("#domain-input")!;
const fileInput = document.querySelector<HTMLInputElement>("#inventory-file")!;
const syncButton = document.querySelector<HTMLButtonElement>("#sync-providers")!;
const filterButton = document.querySelector<HTMLButtonElement>("#filter-button")!;
const note = document.querySelector<HTMLElement>("#form-note")!;
const jsonButton = document.querySelector<HTMLButtonElement>("#export-json")!;
const csvButton = document.querySelector<HTMLButtonElement>("#export-csv")!;
const allRows: HostRecord[] = [];
let fileRows: HostRecord[] = [];
let providerRows: HostRecord[] = [];
let visibleRows: HostRecord[] = [];

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const domain = input.value.trim().toLowerCase().replace(/\.$/, "");
  if (domain && !isValidDomainLabel(domain)) {
    showError("Enter a valid domain (for example, example.com). No request was sent.");
    input.focus();
    return;
  }
  note.classList.remove("error");
  applyFilter(domain);
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = file.name.toLowerCase().endsWith(".json")
      ? parseJsonInventory(text)
      : parseCsvInventory(text);
    if (parsed.length === 0) throw new Error("The file contains no valid host rows.");
    fileRows = parsed;
    updateAllRows();
    filterButton.disabled = false;
    applyFilter(input.value.trim().toLowerCase().replace(/\.$/, ""));
    note.classList.remove("error");
    note.textContent = `Loaded ${parsed.length} inventory rows from ${file.name}. The file stays in this page; no hosts were contacted.`;
    progress.setProgress(100, "Inventory loaded", "Showing records supplied by your local file.");
  } catch (error) {
    showError(error instanceof Error ? error.message : "Could not read the inventory file.");
  } finally {
    fileInput.value = "";
  }
});

function isValidDomainLabel(domain: string): boolean {
  const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(domain);
  const domainPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
  return domain.length <= 253 && domainPattern.test(domain) && !isIpv4 &&
    domain !== "localhost" && !domain.endsWith(".local");
}

function parseJsonInventory(text: string): HostRecord[] {
  const data: unknown = JSON.parse(text);
  const records = Array.isArray(data)
    ? data
    : data && typeof data === "object" && "hosts" in data && Array.isArray(data.hosts)
      ? data.hosts
      : null;
  if (!records) throw new Error('JSON must be an array of hosts or an object with a "hosts" array.');
  return records.map(normalizeRecord).filter((record): record is HostRecord => record !== null);
}

function parseCsvInventory(text: string): HostRecord[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one host row.");
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const hostnameIndex = headers.findIndex((header) => ["hostname", "host", "name"].includes(header));
  if (hostnameIndex < 0) throw new Error('CSV needs a "hostname" (or "host") column.');
  const records = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ""));
  return records.map((row) => normalizeRecord({
    hostname: row[hostnameIndex],
    state: valueAt(row, headers, "state"),
    status: valueAt(row, headers, "status"),
    server: valueAt(row, headers, "server"),
    tech: valueAt(row, headers, "tech") ?? valueAt(row, headers, "technology")
  })).filter((record): record is HostRecord => record !== null);
}

function valueAt(row: string[], headers: string[], name: string): string | undefined {
  const index = headers.indexOf(name);
  return index < 0 ? undefined : row[index];
}

function parseCsv(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      result.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    result.push(row);
  }
  return result;
}

function normalizeRecord(value: unknown): HostRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const hostname = stringValue(item.hostname ?? item.host ?? item.name).trim();
  if (!hostname || hostname.length > 253 || /[\u0000-\u001f\u007f]/.test(hostname)) return null;

  const rawStatus = item.status;
  const statusText = rawStatus === null || rawStatus === undefined ? "" : String(rawStatus).trim();
  const status = /^\d{3}$/.test(statusText) ? Number(statusText) : null;
  const explicitState = stringValue(item.state).trim().toLowerCase();
  const state = explicitState || (status !== null ? "up" : "unknown");
  const server = stringValue(item.server).trim() || "—";
  const tech = stringValue(item.tech ?? item.technology).trim() || "—";
  const rawTtl = Number(item.ttl);
  return {
    hostname,
    state,
    status,
    server,
    tech,
    provider: stringValue(item.provider) || "File",
    recordType: stringValue(item.recordType ?? item.type).trim(),
    value: stringValue(item.value ?? item.content).trim(),
    ttl: Number.isFinite(rawTtl) && rawTtl >= 0 ? rawTtl : null
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function applyFilter(domain: string): void {
  visibleRows = domain
    ? allRows.filter((record) => {
      const hostname = record.hostname.toLowerCase();
      return hostname === domain || hostname.endsWith(`.${domain}`);
    })
    : [...allRows];
  table.setRows(visibleRows);
  document.querySelector("#metric-total")!.textContent = String(visibleRows.length);
  document.querySelector("#metric-up")!.textContent = String(visibleRows.filter((row) => row.state.toLowerCase() === "up").length);
  jsonButton.disabled = visibleRows.length === 0;
  csvButton.disabled = visibleRows.length === 0;
  if (allRows.length > 0 && visibleRows.length === 0) {
    note.textContent = `No inventory rows match ${domain}. The file remains loaded; try another filter.`;
  }
}

function updateAllRows(): void {
  allRows.splice(0, allRows.length, ...fileRows, ...providerRows);
  filterButton.disabled = allRows.length === 0;
  applyFilter(input.value.trim().toLowerCase().replace(/\.$/, ""));
}

syncButton.addEventListener("click", async () => {
  syncButton.disabled = true;
  syncButton.textContent = "↻ Syncing provider accounts…";
  note.classList.remove("error");
  progress.setProgress(25, "Connecting to providers", "Reading DNS inventory from configured provider accounts.");
  try {
    const response = await fetch("/api/assets", { method: "POST" });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : "Provider inventory could not be loaded.";
      throw new Error(message);
    }
    if (!payload || typeof payload !== "object" || !("assets" in payload) || !Array.isArray(payload.assets)) {
      throw new Error("Provider API returned an invalid inventory response.");
    }
    providerRows = payload.assets
      .map(normalizeRecord)
      .filter((record): record is HostRecord => record !== null);
    updateAllRows();
    const providerErrors = "providers" in payload && Array.isArray(payload.providers)
      ? payload.providers
        .filter((provider): provider is { provider: string; error: string } =>
          Boolean(provider) && typeof provider === "object" &&
          "error" in provider && typeof provider.error === "string" && provider.error.length > 0 &&
          "provider" in provider && typeof provider.provider === "string")
        .map((provider) => `${provider.provider}: ${provider.error}`)
      : [];
    if (providerErrors.length) {
      note.textContent = `Loaded ${providerRows.length} records. ${providerErrors.join(" ")}`;
      note.classList.add("error");
    } else {
      note.textContent = `Loaded ${providerRows.length} DNS records from configured provider accounts. Hostnames were not contacted.`;
    }
    progress.setProgress(100, "Provider inventory loaded", `${providerRows.length} DNS records read from provider APIs.`);
  } catch (error) {
    showError(error instanceof Error ? error.message : "Could not load provider inventory.");
    progress.setProgress(0, "Provider sync failed", "Check local provider credentials and permissions.");
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = "↻ Sync provider accounts";
  }
});

function showError(message: string): void {
  note.textContent = message;
  note.classList.add("error");
}

document.querySelector<HTMLButtonElement>("#template-button")!.addEventListener("click", () => {
  download("asset-inventory-template.csv",
    "hostname,state,status,server,tech\r\napi.example.com,up,200,nginx,Node.js\r\n",
    "text/csv");
});

jsonButton.addEventListener("click", () => {
  download("asset-inventory.json", JSON.stringify({
    source: "configured-provider-account-and-user-inventory",
    observationMethod: "Provider account API only; no target DNS or HTTP probing",
    hosts: visibleRows
  }, null, 2), "application/json");
});

csvButton.addEventListener("click", () => {
  const header = ["hostname", "state", "status", "recordType", "value", "ttl", "provider", "server", "tech"];
  const rows = visibleRows.map((host) => [
    host.hostname, host.state, host.status ?? "", host.recordType, host.value,
    host.ttl ?? "", host.provider, host.server, host.tech
  ]);
  download("asset-inventory.csv", [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"), "text/csv");
});

function csvCell(value: string | number): string {
  const text = String(value);
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
