import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { diffRows } from "@/lib/compare";
import { errorResponse } from "@/lib/api/respond";
import type { Row } from "@/lib/types";

// Enough for reference and configuration tables; big tables are compared on their first rows.
const MAX_ROWS = 20_000;
const PAGE = 1_000;

async function readAll(connectionId: string, table: string, pkColumn: string): Promise<{ rows: Row[]; truncated: boolean }> {
  const adapter = getAdapter(connectionId);
  const rows: Row[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const page = await adapter.selectRows(table, { sorts: [{ column: pkColumn, dir: "asc" }], limit: PAGE, offset });
    rows.push(...page.rows);
    if (page.rows.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { left?: string; right?: string; table?: string };
    if (!body.left || !body.right || !body.table || !getConnection(body.left) || !getConnection(body.right)) {
      return errorResponse(new Error("Choisis deux connexions et une table"));
    }
    const table = body.table;
    const [leftMeta, rightMeta] = await Promise.all([getAdapter(body.left).getTable(table), getAdapter(body.right).getTable(table)]);
    const pk = leftMeta.columns.find((c) => c.isPrimaryKey)?.name;
    if (!pk || !rightMeta.columns.some((c) => c.name === pk && c.isPrimaryKey)) {
      return errorResponse(new Error("La table doit avoir la même clé primaire des deux côtés pour comparer ses lignes"));
    }
    const rightNames = new Set(rightMeta.columns.map((c) => c.name));
    const columns = leftMeta.columns.map((c) => c.name).filter((n) => rightNames.has(n) && n !== pk);
    const [left, right] = await Promise.all([readAll(body.left, table, pk), readAll(body.right, table, pk)]);
    return Response.json(diffRows(pk, columns, left.rows, right.rows, left.truncated || right.truncated));
  } catch (err) {
    return errorResponse(err, 500);
  }
}
