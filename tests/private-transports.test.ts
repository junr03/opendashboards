import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { local } from "@/config/local";
import { createGuardedFetch } from "@/lib/net/guarded-fetch";
import { guardedHttpsRequest } from "@/lib/net/guarded-https";
import { BlockedAddressError, createGuardedSocket } from "@/lib/net/guarded-socket";

const limits = { timeoutMs: 2_000, maxBytes: 1_000 };

describe("private destinations through production transport guards", () => {
  const savedRules = local.network.privateDestinations;
  let certDir: string;
  let server: https.Server;
  let port: number;

  beforeAll(async () => {
    certDir = mkdtempSync(join(tmpdir(), "od-private-tls-"));
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"),
    ], { stdio: "ignore" });
    server = https.createServer({ key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) }, (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(() => {
    local.network.privateDestinations = savedRules;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(certDir, { recursive: true, force: true });
  });

  it("HTTPS uses an exact operator rule for a private IP and retains TLS verification", async () => {
    const target = new URL(`https://127.0.0.1:${port}/`);
    await expect(guardedHttpsRequest(target, limits)).rejects.toBeInstanceOf(BlockedAddressError);
    local.network.privateDestinations = [{ host: "127.0.0.1", port }];
    await expect(guardedHttpsRequest(target, { ...limits, rejectUnauthorized: false })).resolves.toMatchObject({ status: 200, body: '{"ok":true}' });
    await expect(guardedHttpsRequest(target, limits)).rejects.toThrow(/self.signed/i);
  });

  it("fetch independently authorizes each actual destination in OAuth's multi-origin mode", async () => {
    local.network.privateDestinations = [{ host: "127.0.0.1", port }];
    const guarded = createGuardedFetch({ origin: "any-https", ...limits, rejectUnauthorized: false });
    try {
      expect(await (await guarded(`https://127.0.0.1:${port}/`)).json()).toEqual({ ok: true });
      await expect(guarded(`https://127.0.0.1:${port === 9 ? 10 : 9}/`)).rejects.toBeInstanceOf(BlockedAddressError);
    } finally {
      await guarded.close();
    }
  });

  it("fetch does not reuse the first origin's DNS permission for another port", async () => {
    let otherRequests = 0;
    const other = https.createServer({
      key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")),
    }, (_req, res) => { otherRequests++; res.end("not authorized"); });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const otherPort = (other.address() as AddressInfo).port;
    local.network.privateDestinations = [{ host: "localhost", port, addresses: ["127.0.0.0/8", "::1"] }];
    const guarded = createGuardedFetch({ origin: "any-https", ...limits, rejectUnauthorized: false });
    try {
      expect(await (await guarded(`https://localhost:${port}/`)).json()).toEqual({ ok: true });
      await expect(guarded(`https://localhost:${otherPort}/`)).rejects.toSatisfy(hasBlockedCause);
      expect(otherRequests).toBe(0);
    } finally {
      await guarded.close();
      other.closeAllConnections();
      await new Promise<void>((resolve) => other.close(() => resolve()));
    }
  });

  const request = async (transport: string, target: URL) => {
    if (transport === "HTTPS") return (await guardedHttpsRequest(target, { ...limits, rejectUnauthorized: false })).body;
    if (transport === "fetch") {
      const guarded = createGuardedFetch({ origin: "any-https", ...limits, rejectUnauthorized: false });
      try { return await (await guarded(target)).text(); }
      finally { await guarded.close(); }
    }
    return new Promise<string>((resolve, reject) => {
      const socket = createGuardedSocket();
      socket.once("error", reject);
      socket.once("connect", () => { socket.end(); resolve("connected"); });
      socket.connect(Number(target.port), target.hostname);
    });
  };

  it.each(["HTTPS", "fetch", "TCP"])("%s enforces actual-port DNS bounds", async (transport) => {
    const target = new URL(`https://localhost:${port}/`);
    const addresses = ["127.0.0.0/8", "::1"];
    local.network.privateDestinations = [{ host: "localhost", port, addresses }];
    await expect(request(transport, target)).resolves.toBe(transport === "TCP" ? "connected" : '{"ok":true}');
    local.network.privateDestinations = [{ host: "localhost", port: port + 1, addresses }];
    await expect(request(transport, target)).rejects.toSatisfy(hasBlockedCause);
    local.network.privateDestinations = [{ host: "localhost", port, addresses: ["127.0.0.2"] }];
    await expect(request(transport, target)).rejects.toSatisfy(hasBlockedCause);
  });

  it.each(["HTTPS", "fetch", "TCP"])("%s cannot authorize the application's own mapped-IP hostname", async (transport) => {
    vi.stubEnv("DATABASE_URL", "postgres://owner:ignored@[::ffff:127.0.0.1]:5432/app");
    local.network.privateDestinations = [{ host: "127.0.0.1", port }];
    await expect(request(transport, new URL(`https://127.0.0.1:${port}/`))).rejects.toSatisfy(hasBlockedCause);
  });
});

function hasBlockedCause(error: unknown): boolean {
  for (let cause = error, depth = 0; cause instanceof Error && depth < 8; cause = cause.cause, depth++) {
    if (cause instanceof BlockedAddressError) return true;
  }
  return false;
}
