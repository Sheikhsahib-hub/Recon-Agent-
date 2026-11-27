import { createTechBadge } from "./TechBadge";

export interface HostRecord {
  hostname: string;
  state: string;
  status: number | null;
  server: string;
  tech: string;
  provider: string;
  recordType: string;
  value: string;
  ttl: number | null;
}

type SortKey = keyof HostRecord;

export class HostTable {
  private readonly root: HTMLElement;
  private readonly viewport: HTMLDivElement;
  private rows: HostRecord[] = [];
  private sortKey: SortKey = "hostname";
  private sortDirection: 1 | -1 = 1;
  private readonly rowHeight = 48;
  private readonly overscan = 5;

  constructor() {
    this.root = document.createElement("section");
    this.root.className = "hosts-panel panel";
    this.root.innerHTML = `
      <div class="section-heading">
        <div>
          <p class="eyebrow">OBSERVATIONS</p>
          <h2>Hosts <span class="count" id="host-count">0</span></h2>
        </div>
        <span class="table-hint">Imported inventory</span>
      </div>
      <div class="table-wrap">
        <div class="table-header" role="row">
          <button type="button" data-sort="hostname">Hostname <span></span></button>
          <button type="button" data-sort="state">State <span></span></button>
          <button type="button" data-sort="status">Status <span></span></button>
          <button type="button" data-sort="recordType">DNS record <span></span></button>
          <button type="button" data-sort="provider">Source <span></span></button>
          <button type="button" data-sort="server">Server <span></span></button>
          <button type="button" data-sort="tech">Tech <span></span></button>
        </div>
        <div class="table-viewport" tabindex="0" aria-label="Host results">
          <div class="table-spacer"></div>
          <div class="table-rows"></div>
        </div>
        <div class="empty-state">No inventory loaded. Choose a CSV or JSON file to view your assets.</div>
      </div>
    `;
    this.viewport = this.root.querySelector<HTMLDivElement>(".table-viewport")!;
    this.viewport.addEventListener("scroll", () => this.renderRows());
    this.root.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((button) => {
      button.addEventListener("click", () => this.sortBy(button.dataset.sort as SortKey));
    });
    this.renderRows();
  }

  get element(): HTMLElement {
    return this.root;
  }

  setRows(rows: HostRecord[]): void {
    this.rows = [...rows];
    this.root.querySelector("#host-count")!.textContent = String(rows.length);
    this.root.querySelector<HTMLElement>(".empty-state")!.hidden = rows.length > 0;
    this.viewport.hidden = rows.length === 0;
    this.renderRows();
  }

  private sortBy(key: SortKey): void {
    this.sortDirection = this.sortKey === key ? (this.sortDirection === 1 ? -1 : 1) : 1;
    this.sortKey = key;
    this.rows.sort((a, b) => {
      const left = a[key];
      const right = b[key];
      if (left === null) return 1;
      if (right === null) return -1;
      return (typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right))) * this.sortDirection;
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((button) => {
      const marker = button.querySelector("span")!;
      marker.textContent = button.dataset.sort === key ? (this.sortDirection === 1 ? "↑" : "↓") : "";
    });
    this.viewport.scrollTop = 0;
    this.renderRows();
  }

  private renderRows(): void {
    const spacer = this.root.querySelector<HTMLElement>(".table-spacer")!;
    const container = this.root.querySelector<HTMLElement>(".table-rows")!;
    spacer.style.height = `${this.rows.length * this.rowHeight}px`;

    const first = Math.max(0, Math.floor(this.viewport.scrollTop / this.rowHeight) - this.overscan);
    const visibleCount = Math.ceil((this.viewport.clientHeight || 360) / this.rowHeight) + this.overscan * 2;
    const last = Math.min(this.rows.length, first + visibleCount);
    container.style.transform = `translateY(${first * this.rowHeight}px)`;
    container.replaceChildren(...this.rows.slice(first, last).map((record) => this.createRow(record)));
  }

  private createRow(record: HostRecord): HTMLElement {
    const row = document.createElement("div");
    row.className = "table-row";
    row.setAttribute("role", "row");

    const hostname = document.createElement("span");
    hostname.className = "hostname";
    hostname.textContent = record.hostname;

    const status = document.createElement("span");
    status.className = record.status === null ? "status status-dead" : "status status-live";
    status.textContent = record.status === null ? "—" : String(record.status);

    const state = document.createElement("span");
    state.className = `state state-${record.state.toLowerCase() === "up" ? "up" : record.state.toLowerCase() === "down" ? "down" : "unknown"}`;
    state.textContent = record.state;

    const server = document.createElement("span");
    server.className = "server-cell";
    server.textContent = record.server;

    const dnsRecord = document.createElement("span");
    dnsRecord.className = "record-cell";
    dnsRecord.textContent = record.recordType
      ? `${record.recordType}: ${record.value}${record.ttl === null ? "" : ` · TTL ${record.ttl}s`}`
      : "—";

    const provider = document.createElement("span");
    provider.className = "server-cell";
    provider.textContent = record.provider;

    const tech = document.createElement("span");
    tech.className = "tech-cell";
    tech.append(createTechBadge(record.tech));

    row.append(hostname, state, status, dnsRecord, provider, server, tech);
    return row;
  }
}
