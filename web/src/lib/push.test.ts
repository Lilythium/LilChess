import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./push";

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url without padding", () => {
    // "hello?>" encodes to aGVsbG8_Pg in base64url (it uses "_" where base64 has "/").
    expect([...urlBase64ToUint8Array("aGVsbG8_Pg")]).toEqual([...new TextEncoder().encode("hello?>")]);
  });

  it("decodes a 65-byte VAPID public key", () => {
    const key = "BEl62iUYgUivxIkv69yViEuiBIa-ib37J8xQmEg7Z4LKMmDLQzJkn1Z4LX8SZCzq3Yg5gX9s9DDZ5A6OtqfBaB4";
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });
});
