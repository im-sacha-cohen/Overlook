import { buildBundle } from "@/lib/store/connectionBundle";
import { errorResponse } from "@/lib/api/respond";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { ids?: unknown; includePasswords?: unknown; passphrase?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
    const passphrase = body.includePasswords === true ? (typeof body.passphrase === "string" ? body.passphrase : "") : null;
    const bundle = buildBundle(ids, passphrase);
    const filename = `overlook-connections-${bundle.exportedAt.slice(0, 10)}.json`;
    return new Response(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
