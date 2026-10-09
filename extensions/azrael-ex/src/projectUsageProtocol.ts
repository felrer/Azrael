import { isRecord } from "./protocol";
import type { ProjectUsageSnapshot } from "./projectUsagePresentation";

export const PROJECT_USAGE_METHOD = "azrael/projectUsage";

export function validateProjectUsageYear(year: number): void {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error("Invalid project usage year.");
}

export function parseProjectUsageSnapshot(value: unknown, year: number): ProjectUsageSnapshot {
  validateProjectUsageYear(year);
  if (!isRecord(value) || value.currency !== "USD" || !Array.isArray(value.days)) throw new Error("Invalid project usage response.");
  const dates = new Set<string>();
  const days = value.days.map(day => {
    if (!isRecord(day) || typeof day.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)
      || Number(day.date.slice(0, 4)) !== year || dates.has(day.date) || !Array.isArray(day.projects)) throw new Error("Invalid project usage day.");
    const parsed = new Date(`${day.date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day.date) throw new Error("Invalid project usage date.");
    dates.add(day.date);
    const ids = new Set<string>();
    const projects = day.projects.map(project => {
      if (!isRecord(project) || typeof project.id !== "string" || !project.id || ids.has(project.id)
        || typeof project.name !== "string" || !project.name || typeof project.amount !== "number"
        || !Number.isFinite(project.amount) || project.amount < 0 || typeof project.unpriced !== "number"
        || !Number.isSafeInteger(project.unpriced) || project.unpriced < 0) throw new Error("Invalid project usage project.");
      ids.add(project.id);
      return { id: project.id, name: project.name, amount: project.amount, unpriced: project.unpriced };
    });
    return { date: day.date, projects };
  });
  return { currency: "USD", days };
}
