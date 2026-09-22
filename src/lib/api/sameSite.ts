// Overlook has no login: whoever can talk to it controls every saved database.
// These checks keep it reachable only under the host names it's meant to be used with
// (blocks DNS rebinding, where a web page re-points its own domain at 127.0.0.1),
// and refuse state-changing requests sent by another site (CSRF). The proxy runs
// them on every request; a route the proxy skips runs them itself.

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

/**
 * Why the request must be refused, or null when it may go through. A body must
 * be of `bodyType`: a type other than a form's can't be sent cross-site without
 * a CORS preflight, which is never granted.
 */
export function foreignRequestRefusal(request: Request, bodyType: string): string | null {
  const host = request.headers.get("host");
  if (!hostAllowed(host)) {
    return `Hôte non autorisé : ${host ?? "(aucun)"}. Ajoutez-le à OVERLOOK_ALLOWED_HOSTS pour accéder à Overlook sous ce nom.`;
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
        return "Requête refusée : elle ne vient pas d'Overlook.";
      }
    }
    if (new URL(request.url).pathname.startsWith("/api/")) {
      const type = request.headers.get("content-type");
      if (type && !type.toLowerCase().startsWith(bodyType)) {
        return bodyType === "application/json" ? "Requête refusée : le corps doit être en JSON." : `Requête refusée : le corps doit être de type ${bodyType}.`;
      }
    }
  }
  return null;
}
