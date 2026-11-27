import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { createAesSecretBox } from "@/lib/secrets/aes";
import { createSession, passwordMatches, SESSION_COOKIE, sessionProvider } from "@/lib/auth/providers/session";
import { secretProblems, settingsFor, settingsProblems } from "@/config";

const key = "12".repeat(32);
const secret = "standalone-test-signing-key-32-characters";
const user = { id: "operator", email: "operator@localhost" };
const context = { purpose: "postgres-password", userId: "alice", connectionId: "c1" };

describe("standalone encrypted credential storage", () => {
  it("uses fresh nonces and authenticates the ciphertext, key, and owner context", async () => {
    const box = createAesSecretBox(key);
    const sealed = await box.seal("database-password", context);
    expect(JSON.stringify(sealed)).not.toContain("database-password");
    expect(await box.seal("database-password", context)).not.toEqual(sealed);
    expect(await box.open(sealed, context)).toBe("database-password");
    for (const changed of [{ ...context, userId: "bob" }, { ...context, connectionId: "c2" }, { ...context, purpose: "oauth" }]) {
      await expect(box.open(sealed, changed)).rejects.toThrow("can't be decrypted");
    }
    await expect(createAesSecretBox("34".repeat(32)).open(sealed, context)).rejects.toThrow("can't be decrypted");
    if (sealed.provider !== "aes-gcm") throw new Error("Wrong provider");
    await expect(box.open({ ...sealed, ciphertext: "AAAA" }, context)).rejects.toThrow("can't be decrypted");
    await expect(box.seal("a".repeat(65537), context)).rejects.toThrow("65");
    expect(() => createAesSecretBox("bad")).toThrow("64 hexadecimal");
  });
});

describe("standalone sessions", () => {
  it("accepts only locally signed, unexpired tokens for this account", async () => {
    const provider = sessionProvider(secret, user);
    const signed = await createSession(secret, user);
    const headers = (token: string) => new Headers({ cookie: `other=value; ${SESSION_COOKIE}=${token}` });
    expect(await provider.authenticate(headers(signed))).toEqual({ ok: true, user });
    expect(await provider.authenticate(new Headers())).toMatchObject({ ok: false });
    expect(await provider.authenticate(headers(signed + "changed"))).toMatchObject({ ok: false });
    expect(await sessionProvider(secret, { ...user, id: "another" }).authenticate(headers(signed))).toMatchObject({ ok: false });
    expect(await sessionProvider(secret + "other", user).authenticate(headers(signed))).toMatchObject({ ok: false });
    const expired = await new SignJWT({ email: user.email }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id)
      .setIssuer("opendashboards").setAudience("opendashboards-session").setExpirationTime(1).sign(new TextEncoder().encode(secret));
    expect(await provider.authenticate(headers(expired))).toMatchObject({ ok: false });
    expect(passwordMatches("correct", "correct")).toBe(true);
    expect(passwordMatches("incorrect", "correct")).toBe(false);
  });

  it("can start production without Thesys, Supabase, KMS, or demo credentials", () => {
    expect(secretProblems("prod", settingsFor("prod"), {
      DATABASE_URL: "postgres://local", AUTH_SECRET: secret, AUTH_PASSWORD: "a-long-operator-password", ENCRYPTION_KEY: key,
    })).toEqual([]);
    const settings = structuredClone(settingsFor("prod"));
    settings.appOrigin = "http://localhost:3100";
    expect(settingsProblems("prod", settings)).toEqual([]);
    settings.appOrigin = "http://public.example";
    expect(settingsProblems("prod", settings).join(" ")).toContain("https");
    expect(secretProblems("prod", settings, { DATABASE_URL: "postgres://local", AUTH_SECRET: "short", AUTH_PASSWORD: "short", ENCRYPTION_KEY: "bad" }).join(" ")).toMatch(/ENCRYPTION_KEY.*AUTH_SECRET.*AUTH_PASSWORD/);
  });
});
