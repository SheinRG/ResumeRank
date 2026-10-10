import { generateKeyPairSync, randomBytes } from "node:crypto";

import { stripCertHeaderAndFooter } from "@boxyhq/saml20/dist/cert";
import { createIdPMetadataXML } from "@boxyhq/saml20/dist/metadata";
import { decodeBase64, parseSAMLRequest } from "@boxyhq/saml20/dist/request";
import { createSAMLResponse } from "@boxyhq/saml20/dist/response";
import forge from "node-forge";

/**
 * A throwaway SAML identity provider: a fresh key and self-signed
 * certificate per test run (never a committed key), the metadata an admin
 * would paste, and signed responses like Okta or Entra would post back.
 */
export interface FakeIdp {
  entityId: string;
  metadataXml: string;
  respond(input: {
    samlRequest: string;
    email: string;
    firstName?: string;
    lastName?: string;
    audience: string;
  }): Promise<string>;
}

function selfSignedCertificate(publicKeyPem: string, privateKeyPem: string, commonName: string): string {
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
  cert.serialNumber = `01${randomBytes(8).toString("hex")}`;
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: "commonName", value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(forge.pki.privateKeyFromPem(privateKeyPem), forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

export function createFakeIdp(tag: string): FakeIdp {
  const entityId = `https://idp.example.test/${tag}`;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const certificate = selfSignedCertificate(publicKey, privateKey, `idp-${tag}`);

  return {
    entityId,
    metadataXml: createIdPMetadataXML({
      ssoUrl: `${entityId}/sso`,
      entityId,
      x509cert: stripCertHeaderAndFooter(certificate),
      wantAuthnRequestsSigned: false,
    }),
    async respond({ samlRequest, email, firstName = "Ada", lastName = "Lovelace", audience }) {
      const request = await parseSAMLRequest(await decodeBase64(samlRequest, true), false);
      const xml = await createSAMLResponse({
        audience,
        issuer: entityId,
        acsUrl: request.acsUrl,
        requestId: request.id,
        privateKey,
        publicKey: certificate,
        claims: {
          email,
          raw: {
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": email,
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname": firstName,
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname": lastName,
          },
        },
      });
      return Buffer.from(xml).toString("base64");
    },
  };
}
