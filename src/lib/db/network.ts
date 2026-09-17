import tls from "node:tls";
import type { Connection, ConnectionSecrets } from "../types";

/** A connection as the adapters receive it: with its secrets, and the real host when tunnelled. */
export type AdapterConnection = Connection & {
  password?: string;
  secrets?: ConnectionSecrets;
  /** Where to actually open the TCP connection (a local SSH tunnel); host/port stay the database's. */
  via?: { host: string; port: number };
};

/** TLS options for pg and mysql2 (both hand them to tls.connect), or undefined for a plain connection. */
/**
 * mysql2 builds its own TLS options and ignores checkServerIdentity: it takes
 * verifyIdentity instead, and checks the name against the configured host.
 */
export function mysqlSslOptions(conn: AdapterConnection): { ca?: string; cert?: string; key?: string; rejectUnauthorized: boolean; verifyIdentity: boolean } | undefined {
  const mode = conn.sslMode ?? (conn.ssl ? "require" : "disable");
  if (mode === "disable") return undefined;
  const secrets = conn.secrets ?? {};
  return {
    ...(secrets.sslCa ? { ca: secrets.sslCa } : {}),
    ...(secrets.sslCert ? { cert: secrets.sslCert } : {}),
    ...(secrets.sslKey ? { key: secrets.sslKey } : {}),
    rejectUnauthorized: mode !== "require",
    verifyIdentity: mode === "verify-full",
  };
}

export function tlsOptions(conn: AdapterConnection): tls.ConnectionOptions | undefined {
  const mode = conn.sslMode ?? (conn.ssl ? "require" : "disable");
  if (mode === "disable") return undefined;
  const secrets = conn.secrets ?? {};
  const options: tls.ConnectionOptions = {
    rejectUnauthorized: mode !== "require",
    ...(secrets.sslCa ? { ca: secrets.sslCa } : {}),
    ...(secrets.sslCert ? { cert: secrets.sslCert } : {}),
    ...(secrets.sslKey ? { key: secrets.sslKey } : {}),
  };
  if (mode === "verify-ca") {
    // Chain checked, host name not.
    options.checkServerIdentity = () => undefined;
  } else if (mode === "verify-full") {
    const host = conn.host ?? "";
    options.checkServerIdentity = (_hostname, cert) => tls.checkServerIdentity(host, cert);
  }
  return options;
}
