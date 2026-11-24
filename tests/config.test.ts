import { describe, expect, it } from "vitest";

import type { PrivateDestination } from "@/config/settings";

import {
  ConfigError,
  environment,
  secretProblems,
  settingsFor,
  settingsProblems,
  validateConfig,
  type Settings,
} from "@/config";

const PROD_SECRETS = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://db",
  THESYS_API_KEY: "key",
  KMS_KEY_ID: "kms",
  KMS_ROLE_ARN: "arn:aws:iam::1:role/opendashboards",
  SUPABASE_URL: "https://project.supabase.co",
  DEMO_DATABASE_PASSWORD: "demo",
};

/** prod's settings with some changed, as if someone edited prod.ts. */
const editedProd = (change: (settings: Settings) => void): Settings => {
  const settings = structuredClone(settingsFor("prod"));
  change(settings);
  return settings;
};

describe("environment", () => {
  it("follows Next.js's mode", () => {
    expect(environment({ NODE_ENV: "production" })).toBe("prod");
    expect(environment({ NODE_ENV: "development" })).toBe("local");
    expect(environment({ NODE_ENV: "test" })).toBe("local");
    expect(environment({})).toBe("local");
  });
});

describe("the settings files", () => {
  it("ships public-only network policy in both environments", () => {
    expect(settingsFor("local").network).toHaveProperty("privateDestinations", []);
    expect(settingsFor("prod").network).toHaveProperty("privateDestinations", []);
  });

  it("pass validation as shipped", () => {
    expect(settingsProblems("local", settingsFor("local"))).toEqual([]);
    expect(settingsProblems("prod", settingsFor("prod"))).toEqual([]);
  });

  it("change the connect timeout, allow a dev user and plaintext only locally", () => {
    const local = settingsFor("local");
    const prod = settingsFor("prod");
    expect(local.network.connectAttemptTimeoutMs).toBe(2_000);
    expect(prod.network.connectAttemptTimeoutMs).toBeNull();
    expect(local.auth.devUser).toEqual({ id: "dev-user", email: "user@example.dev" });
    expect(prod.auth.devUser).toBeNull();
    expect([local.secrets.allowPlaintext, prod.secrets.allowPlaintext]).toEqual([true, false]);
  });

  it("share common settings", () => {
    expect(settingsFor("local").openui).toEqual(settingsFor("prod").openui);
  });
});

describe("settingsProblems", () => {
  it("accepts bounded private destinations in either environment", () => {
    const settings = editedProd((s) => {
      s.network.privateDestinations = [
        { host: "Analytics.Internal.", port: 5432, addresses: ["10.42.0.0/24", "fd7a:115c:a1e0::/64"] },
        { host: "[::1]", port: 8443 },
      ];
    });
    expect(settingsProblems("prod", settings)).toEqual([]);
    expect(settingsProblems("local", settings)).toEqual([]);
  });

  it.each<PrivateDestination>([
    { host: "*.internal", port: 5432, addresses: ["10.0.0.1"] },
    { host: "https://analytics.internal", port: 5432, addresses: ["10.0.0.1"] },
    { host: "analytics.internal", port: 0, addresses: ["10.0.0.1"] },
    { host: "analytics.internal", port: 65536, addresses: ["10.0.0.1"] },
    { host: "analytics.internal", port: 5432.5, addresses: ["10.0.0.1"] },
    { host: "analytics.internal", port: 5432 },
    { host: "analytics.internal", port: 5432, addresses: [] },
    { host: "analytics.internal", port: 5432, addresses: ["10.0.0.0/7"] },
    { host: "analytics.internal", port: 5432, addresses: ["10.0.0.0/33"] },
    { host: "analytics.internal", port: 5432, addresses: ["10.0.0.0/-1"] },
    { host: "analytics.internal", port: 5432, addresses: ["0.0.0.0/0"] },
    { host: "analytics.internal", port: 5432, addresses: ["::/0"] },
    { host: "analytics.internal", port: 5432, addresses: ["127.1"] },
    { host: "analytics.internal", port: 5432, addresses: ["8.8.8.8"] },
    { host: "analytics.internal", port: 5432, addresses: ["169.254.169.254"] },
    { host: "analytics.internal", port: 5432, addresses: ["fd00:ec2::254"] },
    { host: "127.0.0.1", port: 5432, addresses: ["10.0.0.0/8"] },
    { host: "0x7f.1", port: 5432, addresses: ["127.0.0.1"] },
    { host: "::bad::ip", port: 5432 },
    { host: "100.100.100.200", port: 443 },
  ])("refuses invalid private authorization %j", (rule) => {
    const settings = editedProd((s) => { s.network.privateDestinations = [rule]; });
    expect(settingsProblems("prod", settings).join(" ")).toContain("network.privateDestinations");
    expect(settingsProblems("local", settings).join(" ")).toContain("network.privateDestinations");
  });

  it("rejects duplicate normalized destination pairs", () => {
    const settings = editedProd((s) => {
      s.network.privateDestinations = [
        { host: "Analytics.Internal.", port: 5432, addresses: ["10.0.0.1"] },
        { host: "analytics.internal", port: 5432, addresses: ["10.0.0.2"] },
        { host: "127.0.0.1", port: 8443 },
        { host: "::ffff:127.0.0.1", port: 8443 },
      ];
    });
    expect(settingsProblems("prod", settings)).toHaveLength(2);
  });

  it.each([
    ["a dev user", (s: Settings) => (s.auth.devUser = { id: "dev-user", email: "user@example.dev" }), "auth.devUser"],
    ["no public host", (s: Settings) => (s.auth.publicHost = null), "auth.publicHost"],
    ["plaintext secrets", (s: Settings) => (s.secrets.allowPlaintext = true), "secrets.allowPlaintext"],
    ["a connect timeout", (s: Settings) => (s.network.connectAttemptTimeoutMs = 2_000), "connectAttemptTimeoutMs"],
  ])("refuses prod with %s", (_label, change, setting) => {
    const problems = settingsProblems("prod", editedProd(change));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(setting);
  });
});

describe("secretProblems", () => {
  it("accepts prod with every secret", () => {
    expect(secretProblems("prod", settingsFor("prod"), PROD_SECRETS)).toEqual([]);
  });

  it("names each missing secret prod needs", () => {
    const problems = secretProblems("prod", settingsFor("prod"), { NODE_ENV: "production" });
    expect(problems.join("\n")).toMatch(/DATABASE_URL[\s\S]*THESYS_API_KEY[\s\S]*SUPABASE_URL[\s\S]*KMS_KEY_ID[\s\S]*KMS_ROLE_ARN/);
  });

  it("needs the demo password in prod when demo datasets are on offer, but not locally", () => {
    const { DEMO_DATABASE_PASSWORD: _, ...withoutDemo } = PROD_SECRETS;
    expect(secretProblems("prod", settingsFor("prod"), withoutDemo)).toEqual([
      "DEMO_DATABASE_PASSWORD is not set; prod offers demo datasets",
    ]);
    expect(secretProblems("prod", editedProd((s) => (s.demoData.datasets = [])), withoutDemo)).toEqual([]);
  });

  it("needs only the database and OpenUI key locally", () => {
    expect(secretProblems("local", settingsFor("local"), { DATABASE_URL: "postgres://db", THESYS_API_KEY: "key" })).toEqual([]);
  });
});

describe("demo datasets", () => {
  it("need unique, stable keys and a database to point at", () => {
    const [retail] = settingsFor("prod").demoData.datasets;
    const broken = editedProd((s) => {
      s.demoData.datasets = [retail, { ...retail, postgres: { ...retail.postgres, host: "" } }, { ...retail, key: "Retail Sales" }];
    });
    expect(settingsProblems("prod", broken)).toEqual([
      "demoData.retail: key is used twice",
      "demoData.retail: postgres needs a host, database and user",
      "demoData.Retail Sales: key must be lowercase letters, digits or _ (at most 40)",
    ]);
  });
});

describe("validateConfig", () => {
  it("checks secrets only when asked (a build machine needn't have them)", () => {
    expect(() => validateConfig({ withSecrets: false }, { NODE_ENV: "production" })).not.toThrow();
    expect(() => validateConfig({ withSecrets: true }, { NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() => validateConfig({ withSecrets: true }, PROD_SECRETS)).not.toThrow();
  });
});
