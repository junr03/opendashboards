import { describe, expect, it } from "vitest";

import { isAllowedDestinationAddress } from "@/lib/net/destination-policy";

describe("operator-authorized private destinations", () => {
  it.each(["10.0.0.8", "172.20.0.8", "192.168.1.8", "127.0.0.1", "100.90.0.8", "fd7a:115c:a1e0::8", "::1"])(
    "requires exact operator permission for %s", (address) => {
      expect(isAllowedDestinationAddress(address, 5432, address, [])).toBe(false);
      expect(isAllowedDestinationAddress(address, 5432, address, [{ host: address, port: 5432 }])).toBe(true);
      expect(isAllowedDestinationAddress(address, 5433, address, [{ host: address, port: 5432 }])).toBe(false);
    },
  );

  it.each(["169.254.169.254", "fd00:ec2::254", "100.100.100.200", "::ffff:100.100.100.200", "::ffff:169.254.169.254", "0.0.0.0", "::", "fe80::1", "224.0.0.1", "ff02::1", "192.0.2.1", "198.18.0.1", "240.0.0.1", "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1", "2001::1"])(
    "never authorizes protected address %s, even under an overlapping rule", (address) => {
      const rules = [{ host: "analytics.internal", port: 5432, addresses: ["0.0.0.0/0", "::/0"] }];
      expect(isAllowedDestinationAddress("analytics.internal", 5432, address, rules)).toBe(false);
      expect(isAllowedDestinationAddress(address, 5432, address, [{ host: address, port: 5432 }])).toBe(false);
    },
  );

  it("normalizes mapped addresses and matches IPv6 subnet bounds", () => {
    expect(isAllowedDestinationAddress("[::ffff:127.0.0.1]", 5432, "127.0.0.1", [{ host: "127.0.0.1", port: 5432 }])).toBe(true);
    const rules = [{ host: "db.internal", port: 5432, addresses: ["fd7a:115c:a1e0::/64", "::ffff:10.42.0.0/120"] }];
    expect(isAllowedDestinationAddress("db.internal", 5432, "fd7a:115c:a1e0::8", rules)).toBe(true);
    expect(isAllowedDestinationAddress("db.internal", 5432, "fd7a:115c:a1e1::8", rules)).toBe(false);
    expect(isAllowedDestinationAddress("db.internal", 5432, "::ffff:10.42.0.8", rules)).toBe(true);
  });

  it("preserves public-only behavior without matching exceptions", () => {
    for (const address of ["8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isAllowedDestinationAddress("public.example", 443, address, [])).toBe(true);
    }
  });

  it("follows a named service only within its authorized subnet and port", () => {
    const rules = [{ host: "Analytics.Internal.", port: 5432, addresses: ["10.42.0.0/24"] }];
    const allowed = (host: string, port: number, address: string) => isAllowedDestinationAddress(host, port, address, rules);
    expect(allowed("analytics.internal", 5432, "10.42.0.8")).toBe(true);
    expect(allowed("analytics.internal", 5432, "10.42.0.9")).toBe(true);
    expect(allowed("analytics.internal", 5432, "10.42.1.8")).toBe(false);
    expect(allowed("other.internal", 5432, "10.42.0.8")).toBe(false);
    expect(allowed("analytics.internal", 5433, "10.42.0.8")).toBe(false);
    expect(allowed("analytics.internal", 5432, "8.8.8.8")).toBe(false);
  });
});
