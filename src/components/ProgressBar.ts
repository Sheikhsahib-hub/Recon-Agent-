export class ProgressBar {
  private readonly root: HTMLElement;

  constructor() {
    this.root = document.createElement("section");
    this.root.className = "progress-panel panel";
    this.root.setAttribute("aria-live", "polite");
    this.setProgress(0, "Ready", "Enter a domain to preview a simulated run.");
  }

  get element(): HTMLElement {
    return this.root;
  }

  setProgress(percent: number, phase: string, message: string): void {
    const safePercent = Math.min(100, Math.max(0, Math.round(percent)));
    this.root.innerHTML = `
      <div class="progress-heading">
        <div>
          <p class="eyebrow">RUN STATUS</p>
          <h2 class="phase">${this.escape(phase)}</h2>
        </div>
        <span class="progress-value">${safePercent}%</span>
      </div>
      <div class="progress-track" role="progressbar"
        aria-valuenow="${safePercent}" aria-valuemin="0" aria-valuemax="100">
        <span class="progress-fill" style="width:${safePercent}%"></span>
      </div>
      <p class="progress-message">${this.escape(message)}</p>
    `;
  }

  private escape(value: string): string {
    const span = document.createElement("span");
    span.textContent = value;
    return span.innerHTML;
  }
}
