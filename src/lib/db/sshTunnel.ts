import net from "node:net";
import { Client, type ConnectConfig } from "ssh2";
import type { ConnectionSecrets, SshTunnel } from "../types";

export interface Tunnel {
  host: string;
  port: number;
  close(): Promise<void>;
}

/**
 * Listens on a free local port and forwards every connection made to it through
 * SSH to targetHost:targetPort (as seen from the SSH server). The SSH session is
 * opened up front, so bad credentials fail here, and reopened if it drops.
 */
export async function openTunnel(ssh: SshTunnel, secrets: ConnectionSecrets, targetHost: string, targetPort: number): Promise<Tunnel> {
  const config: ConnectConfig = {
    host: ssh.host,
    port: ssh.port,
    username: ssh.user,
    readyTimeout: 15_000,
    keepaliveInterval: 15_000,
  };
  if (ssh.auth === "key") {
    if (!secrets.sshPrivateKey) throw new Error("Tunnel SSH : clé privée manquante");
    config.privateKey = secrets.sshPrivateKey;
    if (secrets.sshPassphrase) config.passphrase = secrets.sshPassphrase;
  } else {
    if (!secrets.sshPassword) throw new Error("Tunnel SSH : mot de passe manquant");
    config.password = secrets.sshPassword;
  }

  let current: Promise<Client> | null = null;
  let closed = false;
  const getClient = () => {
    if (!current) {
      const attempt = new Promise<Client>((resolve, reject) => {
        const client = new Client();
        const forget = () => {
          if (current === attempt) current = null;
        };
        client.on("ready", () => resolve(client));
        client.on("error", (err) => {
          forget();
          reject(new Error(`Tunnel SSH (${ssh.host}) : ${err.message}`));
        });
        client.on("close", forget);
        try {
          client.connect(config);
        } catch (err) {
          // e.g. a private key that can't be parsed
          forget();
          reject(new Error(`Tunnel SSH : ${err instanceof Error ? err.message : String(err)}`));
        }
      });
      current = attempt;
    }
    return current;
  };

  await getClient();

  const server = net.createServer((socket) => {
    socket.on("error", () => socket.destroy());
    getClient()
      .then((client) =>
        client.forwardOut("127.0.0.1", socket.remotePort ?? 0, targetHost, targetPort, (err, stream) => {
          if (err) {
            socket.destroy();
            return;
          }
          stream.on("error", () => socket.destroy());
          stream.on("close", () => socket.destroy());
          socket.on("close", () => stream.destroy());
          socket.pipe(stream).pipe(socket);
        }),
      )
      .catch(() => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as net.AddressInfo;

  return {
    host: "127.0.0.1",
    port: address.port,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const client = await current?.catch(() => null);
      client?.end();
    },
  };
}
