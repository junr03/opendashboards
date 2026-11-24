import "server-only";

import dns, { type LookupAddress, type LookupAllOptions, type LookupOneOptions } from "node:dns";
import net from "node:net";

import { config } from "@/config";

import { isAllowedDestinationAddress, normalizeHost } from "./destination-policy";
import { isOwnHost } from "./own-hosts";

export { isPublicAddress } from "./destination-policy";

/**
 * SSRF protection for connections to hosts a user typed in (a Postgres
 * server, say). Public-only by default; operators can authorize exact private
 * endpoints with bounded DNS answers. Metadata, own infrastructure and other
 * special addresses remain refused even under an operator exception.
 *
 * The check runs inside the socket's own DNS lookup, on the addresses it is
 * about to connect to, so a hostname can't pass a check and then resolve
 * somewhere else (DNS rebinding). The same policy applies in every environment.
 */

/** The host resolves to an address we refuse to connect to. */
export class BlockedAddressError extends Error {
  constructor(
    readonly host: string,
    readonly address: string,
  ) {
    super(`Refusing to connect to ${host}: ${address} is not an authorized destination`);
    this.name = "BlockedAddressError";
  }
}

/**
 * The host has an AAAA record but no A record, so it only answers over
 * IPv6. We have no IPv6 egress, so it can never be reached from here
 * (Supabase's direct connection host is the common case).
 */
export class Ipv6OnlyHostError extends Error {
  constructor(readonly host: string) {
    super(`${host} only has an IPv6 address, which can't be reached from here`);
    this.name = "Ipv6OnlyHostError";
  }
}

/**
 * Whether a host resolves over IPv6 only: an AAAA record, and DNS answering
 * that there is no A record. Any other A-query failure (a timeout, SERVFAIL)
 * says nothing about the host, so it doesn't count.
 */
async function isIpv6Only(hostname: string): Promise<boolean> {
  const [v4, v6] = await Promise.allSettled([dns.promises.resolve4(hostname), dns.promises.resolve6(hostname)]);
  const noARecord = v4.status === "rejected" && (v4.reason as NodeJS.ErrnoException)?.code === dns.NODATA;
  return noARecord && v6.status === "fulfilled" && v6.value.length > 0;
}

/** Used for literal addresses too: Node bypasses lookup for them. */
export function isAllowedAddress(host: string, port: number | undefined, address: string): boolean {
  return !isOwnHost(host) && isAllowedDestinationAddress(host, port, address, config().network.privateDestinations);
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A `dns.lookup` replacement for `net.connect`: resolves every address and
 * fails if any of them is blocked, so a host can't mix a public and a private
 * address and hope for the latter.
 */
export function createGuardedLookup(port?: number) {
  return function guardedLookup(
    hostname: string,
    options: LookupOneOptions | LookupAllOptions,
    callback: LookupCallback,
  ): void {
    // Our own database is publicly reachable, so it's refused by name before any lookup.
    if (isOwnHost(hostname)) return callback(new BlockedAddressError(hostname, "our own infrastructure"), []);
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        // ENOTFOUND here can also mean "IPv6-only, and this process can't use it":
        // tell those apart before reporting a host that doesn't actually fail to resolve.
        isIpv6Only(hostname).then(
          (ipv6Only) => callback(ipv6Only ? new Ipv6OnlyHostError(hostname) : error, []),
          () => callback(error, []),
        );
        return;
      }
      const blocked = addresses.find(({ address }) => !isAllowedAddress(hostname, port, address));
      if (blocked) return callback(new BlockedAddressError(hostname, blocked.address), []);
      if (!addresses.length) {
        return callback(Object.assign(new Error(`No addresses for ${hostname}`), { code: "ENOTFOUND" }), []);
      }
      if ((options as LookupAllOptions).all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/**
 * A TCP socket that only connects to allowed addresses. Pass it to drivers
 * that accept a custom socket (pg's `stream` option): they call
 * `socket.connect(port, host)`, which this routes through the guarded lookup.
 * TLS upgrades still see the original hostname, so certificate checks work.
 */
export function createGuardedSocket(): net.Socket {
  const socket = new net.Socket();
  const connect = socket.connect.bind(socket) as (options: net.TcpNetConnectOpts) => net.Socket;

  socket.connect = ((port: number, host: string) => {
    if (net.isIP(normalizeHost(host))) host = normalizeHost(host);
    // Node skips the lookup for IP literals, so check those directly.
    if ((net.isIP(host) && !isAllowedAddress(host, port, host)) || isOwnHost(host)) {
      process.nextTick(() => socket.destroy(new BlockedAddressError(host, host)));
      return socket;
    }
    return connect({ port, host, lookup: createGuardedLookup(port) as net.LookupFunction });
  }) as typeof socket.connect;

  return socket;
}
