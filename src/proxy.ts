import { NextResponse, type NextRequest } from "next/server";

// Overlook has no login: whoever can talk to it controls every saved database.
// This keeps it reachable only under the host names it's meant to be used with
// (blocks DNS rebinding, where a web page re-points its own domain at 127.0.0.1),
// and refuses state-changing requests sent by another site (CSRF).

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

function allowedHosts(): string[] {
  const extra = (process.env.OVERLOOK_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...LOCAL_HOSTS, ...extra];
}

/** "Example.com:3000" → "example.com", "[::1]:3000" → "[::1]". */
function hostname(hostHeader: string): string {
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

function hostAllowed(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const allowed = allowedHosts();
  if (allowed.includes("*")) return true;
  const name = hostname(hostHeader);
  return allowed.some((h) => h === name || h === hostHeader.toLowerCase());
}

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  if (!hostAllowed(host)) {
    return forbidden(
      `Hôte non autorisé : ${host ?? "(aucun)"}. Ajoutez-le à OVERLOOK_ALLOWED_HOSTS pour accéder à Overlook sous ce nom.`,
    );
  }

  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
    // Browsers always send Origin on cross-site writes; tools like curl send none.
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!originHost || originHost.toLowerCase() !== host!.toLowerCase()) {
        return forbidden("Requête refusée : elle ne vient pas d'Overlook.");
      }
    }
    // A JSON body can't be sent cross-site without a CORS preflight, which is never granted.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      const type = request.headers.get("content-type");
      if (type && !type.toLowerCase().startsWith("application/json")) {
        return forbidden("Requête refusée : le corps doit être en JSON.");
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
