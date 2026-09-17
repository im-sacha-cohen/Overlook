import { getJournalRetentionDays, setJournalRetentionDays } from "@/lib/store/journal";
import { errorResponse } from "@/lib/api/respond";

export async function GET() {
  try {
    return Response.json({ journalRetentionDays: getJournalRetentionDays() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { journalRetentionDays?: unknown };
    return Response.json({ journalRetentionDays: setJournalRetentionDays(body.journalRetentionDays) });
  } catch (err) {
    return errorResponse(err);
  }
}
