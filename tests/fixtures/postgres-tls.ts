import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";

/** TLS at the test boundary, so the ordinary development PostgreSQL needs no SSL configuration. */
export async function postgresTlsProxy(databaseUrl: string) {
  const directory = mkdtempSync(join(tmpdir(), "od-postgres-tls-"));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
    "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"),
  ], { stdio: "ignore" });
  const context = tls.createSecureContext({ key: readFileSync(join(directory, "key.pem")), cert: readFileSync(join(directory, "cert.pem")) });
  const destination = new URL(databaseUrl);
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let request = Buffer.alloc(0);
    const startTls = (chunk: Buffer) => {
      request = Buffer.concat([request, chunk]);
      if (request.length < 8) return;
      socket.off("data", startTls);
      // PostgreSQL SSLRequest: length 8 and protocol request code 80877103.
      if (request.length !== 8 || request.readInt32BE(0) !== 8 || request.readInt32BE(4) !== 80877103) {
        socket.destroy();
        return;
      }
      socket.write("S");
      const encrypted = new tls.TLSSocket(socket, { isServer: true, secureContext: context });
      const upstream = net.connect(Number(destination.port || 5432), destination.hostname);
      sockets.add(upstream);
      upstream.on("close", () => { sockets.delete(upstream); encrypted.destroy(); });
      upstream.on("error", () => encrypted.destroy());
      encrypted.on("error", () => upstream.destroy());
      encrypted.on("close", () => upstream.destroy());
      encrypted.pipe(upstream).pipe(encrypted);
    };
    socket.on("data", startTls);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
