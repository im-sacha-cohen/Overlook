import { getJournalRetentionDays, setJournalRetentionDays } from "@/lib/store/journal";
import { getPageSize, setPageSize } from "@/lib/store/settings";
import { errorResponse } from "@/lib/api/respond";

function current() {
  return { journalRetentionDays: getJournalRetentionDays(), pageSize: getPageSize() };
}

export async function GET() {
  try {
    return Response.json(current());
  } catch (err) {
    return errorResponse(err);
  }
}

// Each setting sent is saved; the others stay as they are.
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { journalRetentionDays?: unknown; pageSize?: unknown };
    if (body.journalRetentionDays !== undefined) setJournalRetentionDays(body.journalRetentionDays);
    if (body.pageSize !== undefined) setPageSize(body.pageSize);
    return Response.json(current());
  } catch (err) {
    return errorResponse(err);
  }
}
