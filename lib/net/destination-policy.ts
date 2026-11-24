import net from "node:net";

import ipaddr from "ipaddr.js";

import type { PrivateDestination } from "../../config/settings";
import { isHost } from "../sources/host";

function parseAddress(address: string) {
  if (!net.isIP(address) || address.includes("%")) return null;
  return ipaddr.process(address);
}

export function normalizeHost(host: string): string {
  const unwrapped = host.replace(/^\[(.*)\]$/, "$1");
  return parseAddress(unwrapped)?.toString() ?? unwrapped.toLowerCase().replace(/\.$/, "");
}

/** Keep public classification independent of operator permission. */
export function isPublicAddress(address: string): boolean {
  return parseAddress(address)?.range() === "unicast";
}

const PRIVATE_RANGES = new Set(["private", "loopback", "carrierGradeNat", "uniqueLocal"]);
const METADATA = new Set(["169.254.169.254", "fd00:ec2::254", "100.100.100.200"]);
const PRIVATE_NETWORKS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "100.64.0.0/10", "fc00::/7", "::1/128"]
  .map((cidr) => ipaddr.parseCIDR(cidr));

type AddressBound = [ipaddr.IPv4 | ipaddr.IPv6, number];

function parseBound(value: string): AddressBound | null {
  const parts = value.split("/");
  if (parts.length > 2) return null;
  const raw = parts[0];
  const address = parseAddress(raw);
  if (!address) return null;
  const bits = net.isIP(raw) === 6 ? 128 : 32;
  if (parts.length === 2 && !/^(0|[1-9]\d*)$/.test(parts[1])) return null;
  let prefix = parts.length === 2 ? Number(parts[1]) : bits;
  if (prefix > bits) return null;
  // Mapped IPv6 bounds and answers obey the IPv4 policy they carry.
  if (bits === 128 && address.kind() === "ipv4") prefix -= 96;
  return prefix < 0 ? null : [address, prefix];
}

function matches(address: ipaddr.IPv4 | ipaddr.IPv6, [network, prefix]: AddressBound): boolean {
  return address.kind() === network.kind() && address.match(network, prefix);
}

/** Only bounds wholly contained in eligible private space may grant an exception. */
function eligibleBound(value: string): boolean {
  const bound = parseBound(value);
  if (!bound || METADATA.has(bound[0].toString())) return false;
  return PRIVATE_NETWORKS.some((network) => bound[1] >= network[1] && matches(bound[0], network));
}

export function privateDestinationProblems(rules: readonly PrivateDestination[]): string[] {
  if (!Array.isArray(rules)) return ["network.privateDestinations must be a list"];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    const label = `network.privateDestinations[${index}]`;
    if (!rule || typeof rule.host !== "string") {
      problems.push(`${label}: host must be a hostname or IP address`);
      continue;
    }
    const host = normalizeHost(rule.host);
    const literal = parseAddress(host);
    let validHost = literal !== null;
    if (!literal && isHost(rule.host) && !rule.host.includes(":")) {
      try {
        // Reject URL-normalized numeric forms such as 0x7f.1 and 2130706433.
        validHost = !net.isIP(new URL(`https://${rule.host}`).hostname);
      } catch { validHost = false; }
    }
    if (!validHost || rule.host !== rule.host.trim()) problems.push(`${label}: host must be an exact hostname or canonical IP address`);
    if (!Number.isInteger(rule.port) || rule.port < 1 || rule.port > 65535) problems.push(`${label}: port must be 1–65535`);
    const key = `${host}|${rule.port}`;
    if (seen.has(key)) problems.push(`${label}: duplicate host and port`);
    seen.add(key);
    if (literal) {
      if (!eligibleBound(host)) problems.push(`${label}: literal must be an eligible private address, never metadata`);
      if (rule.addresses !== undefined) problems.push(`${label}: literals cannot specify additional addresses`);
    } else if (!Array.isArray(rule.addresses) || !rule.addresses.length) {
      problems.push(`${label}: hostnames require address bounds`);
    } else if (rule.addresses.some((value: unknown) => typeof value !== "string" || !eligibleBound(value))) {
      problems.push(`${label}: addresses must be eligible private IP addresses or CIDRs, never metadata`);
    }
  }
  return problems;
}

/** Evaluate one actual address; callers must check every connection-time DNS answer. */
export function isAllowedDestinationAddress(
  host: string,
  port: number | undefined,
  address: string,
  rules: readonly PrivateDestination[],
): boolean {
  const parsed = parseAddress(address);
  if (!parsed || METADATA.has(parsed.toString())) return false;
  const publicAddress = parsed.range() === "unicast";
  if (!publicAddress && !PRIVATE_RANGES.has(parsed.range())) return false;
  const normalized = normalizeHost(host);
  const rule = rules.find((candidate) => normalizeHost(candidate.host) === normalized && candidate.port === port);
  if (!rule) return publicAddress;
  if (parseAddress(normalized)) return parsed.toString() === normalized;
  return rule.addresses?.some((allowed) => {
    const bound = parseBound(allowed);
    return bound !== null && matches(parsed, bound);
  }) ?? false;
}
