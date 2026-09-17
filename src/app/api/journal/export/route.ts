import { listJournal } from "@/lib/store/journal";
import { journalQueryFromUrl } from "@/lib/api/journalQuery";
import { errorResponse } from "@/lib/api/respond";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  try {
    const entries = listJournal({ ...journalQueryFromUrl(new URL(request.url)), limit: 5000 });
    const header = ["date", "connection", "environment", "author", "ip", "action", "table", "rows", "error", "sql"];
    const lines = entries.map((e) =>
      [e.at, e.connectionName, e.envType, e.actor, e.ip, e.action, e.tableName, e.rows, e.error, e.sql].map(csvCell).join(","),
    );
    const date = new Date().toISOString().slice(0, 10);
    return new Response([header.join(","), ...lines].join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="overlook-journal-${date}.csv"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
