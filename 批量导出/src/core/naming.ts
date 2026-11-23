export interface NamingContext {
  timeline: string;
  project: string;
  index: number;
  now?: Date;
}

export function sanitizeWindowsFileName(input: string): string {
  return input.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim();
}

export function formatNamingTemplate(template: string, context: NamingContext): string {
  const now = context.now ?? new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");

  const raw = template
    .replaceAll("{timeline}", context.timeline)
    .replaceAll("{project}", context.project)
    .replaceAll("{date}", date)
    .replaceAll("{time}", time)
    .replaceAll("{index}", String(context.index).padStart(2, "0"));

  return sanitizeWindowsFileName(raw) || sanitizeWindowsFileName(context.timeline) || `timeline_${context.index}`;
}
