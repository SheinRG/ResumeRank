import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

import { isoCBOR } from "@simplewebauthn/server/helpers";

import type { authenticationResponseSchema, registrationResponseSchema } from "../../src/validators/mfa";
import type { z } from "zod";

type RegistrationResponse = z.infer<typeof registrationResponseSchema>;
type AuthenticationResponse = z.infer<typeof authenticationResponseSchema>;

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function sha256(data: Uint8Array | string): Buffer {
  return createHash("sha256").update(data).digest();
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

/**
 * A software ES256 authenticator speaking the WebAuthn wire format ("none"
 * attestation), so passkey registration and sign-in run through the real
 * verifier without a browser.
 */
export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  counter = 0;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  private clientData(type: "webauthn.create" | "webauthn.get", challenge: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  private coseKey(): Uint8Array {
    const jwk = this.publicKey.export({ format: "jwk" });
    if (!jwk.x || !jwk.y) throw new Error("EC public key without coordinates");
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x, "base64url")],
        [-3, Buffer.from(jwk.y, "base64url")],
      ]),
    );
  }

  register(challenge: string): RegistrationResponse {
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_CREDENTIAL]),
      uint32(this.counter),
      Buffer.alloc(16),
      credentialIdLength,
      this.credentialId,
      this.coseKey(),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, never>>([
        ["fmt", "none"],
        ["attStmt", new Map<string, never>()],
        ["authData", authData],
      ]),
    );
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", challenge)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
    };
  }

  /** Signs an assertion; the counter moves forward unless one is given. */
  assert(challenge: string, counter = this.counter + 1): AuthenticationResponse {
    this.counter = counter;
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED]),
      uint32(counter),
    ]);
    const clientDataJSON = this.clientData("webauthn.get", challenge);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
    };
  }
}
