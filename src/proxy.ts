import { NextResponse, type NextRequest } from "next/server";
import { foreignRequestRefusal } from "@/lib/api/sameSite";

export function proxy(request: NextRequest) {
  const refusal = foreignRequestRefusal(request, "application/json");
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  return NextResponse.next();
}

export const config = {
  // Everything except Next's static assets, the landing page's public screenshots
  // (next/image fetches them internally without a Host header, which the checks would
  // refuse), and the pieces of a SQL import: the proxy would copy each one in memory
  // once more. That route runs the same checks itself.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|landing/.+\\.png$|api/connections/[^/]+/import-sql/[^/]+$).*)"],
};
