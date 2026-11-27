export function createTechBadge(value: string): HTMLElement {
  const badge = document.createElement("span");
  badge.className = value === "—" ? "tech-badge muted" : "tech-badge";
  badge.textContent = value;
  return badge;
}
