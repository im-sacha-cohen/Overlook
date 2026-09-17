import { listJournal } from "@/lib/store/journal";
import { journalQueryFromUrl } from "@/lib/api/journalQuery";
import { errorResponse } from "@/lib/api/respond";

export async function GET(request: Request) {
  try {
    return Response.json({ entries: listJournal(journalQueryFromUrl(new URL(request.url))) });
  } catch (err) {
    return errorResponse(err);
  }
}
