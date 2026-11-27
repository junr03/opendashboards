import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { assertSecretSize, SecretProviderMismatchError, SecretUnreadableError, type SecretBox, type SecretContext } from "./types";

const aad = ({ purpose, userId, connectionId }: SecretContext) => Buffer.from(JSON.stringify({ purpose, userId, connectionId }));

/** Standalone authenticated encryption. Back up the key separately from the database. */
export function createAesSecretBox(hexKey: string): SecretBox {
  if (!/^[a-f0-9]{64}$/i.test(hexKey)) throw new Error("ENCRYPTION_KEY must be 64 hexadecimal characters");
  const key = Buffer.from(hexKey, "hex");
  return {
    provider: "aes-gcm",
    async seal(plaintext, context) {
      assertSecretSize(plaintext);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(context));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
      return { v: 1, provider: "aes-gcm", iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64") };
    },
    async open(sealed, context) {
      if (sealed.provider !== "aes-gcm") throw new SecretProviderMismatchError("aes-gcm", sealed.provider);
      try {
        const ciphertext = Buffer.from(sealed.ciphertext, "base64");
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
        decipher.setAAD(aad(context));
        decipher.setAuthTag(ciphertext.subarray(-16));
        return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString("utf8");
      } catch (cause) { throw new SecretUnreadableError({ cause }); }
    },
  };
}
