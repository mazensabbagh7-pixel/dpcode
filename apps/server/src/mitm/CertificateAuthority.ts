// FILE: CertificateAuthority.ts
// Purpose: Bootstrap and load the local root CA used by the MITM proxy to mint
// leaf certificates on the fly for upstream hosts (api.anthropic.com etc.).
//
// The CA lives in ~/.dpcode/ca/ so it's scoped to the user account. Keys are
// chmod 0600. Validity is 1 year; on load we regenerate if expired or within
// 30 days of expiry. We NEVER touch the system trust store — CLIs trust our
// CA via the NODE_EXTRA_CA_CERTS env var injected at spawn time.

import { promises as fs } from "node:fs";
import * as OS from "node:os";
import * as path from "node:path";
import forge from "node-forge";

const CA_DIR_NAME = ".dpcode";
const CA_SUBDIR = "ca";
const CA_CERT_FILENAME = "root.pem";
const CA_KEY_FILENAME = "root.key";
const CA_VALIDITY_YEARS = 1;
const CA_RENEW_WITHIN_DAYS = 30;
const CA_SUBJECT = [
  { name: "commonName", value: "DP Code Local MITM Root CA" },
  { name: "organizationName", value: "DP Code" },
];

export interface CertificateAuthority {
  readonly caDir: string;
  readonly caCertPath: string;
  readonly caKeyPath: string;
  readonly caCertPem: string;
  readonly caKeyPem: string;
  readonly caCert: forge.pki.Certificate;
  readonly caKey: forge.pki.rsa.PrivateKey;
  readonly validFrom: Date;
  readonly validTo: Date;
}

function resolveCaDir(): string {
  return path.join(OS.homedir(), CA_DIR_NAME, CA_SUBDIR);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function generateRootCa(): {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
} {
  // 2048-bit RSA is the sweet spot: fast generation, broadly trusted, more than
  // strong enough for a local-only trust root that never leaves ~/.dpcode.
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = Date.now().toString(16).padStart(16, "0");
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(
    cert.validity.notAfter.getFullYear() + CA_VALIDITY_YEARS,
  );
  cert.setSubject(CA_SUBJECT);
  cert.setIssuer(CA_SUBJECT);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    {
      name: "keyUsage",
      critical: true,
      keyCertSign: true,
      cRLSign: true,
      digitalSignature: true,
    },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keypair.privateKey, forge.md.sha256.create());
  return { cert, key: keypair.privateKey };
}

function isNearExpiry(cert: forge.pki.Certificate): boolean {
  const now = Date.now();
  const expiresAtMs = cert.validity.notAfter.getTime();
  const renewBeforeMs = expiresAtMs - CA_RENEW_WITHIN_DAYS * 24 * 60 * 60 * 1000;
  return now >= renewBeforeMs;
}

async function loadExistingCa(
  certPath: string,
  keyPath: string,
): Promise<{
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
  certPem: string;
  keyPem: string;
} | null> {
  if (!(await fileExists(certPath)) || !(await fileExists(keyPath))) {
    return null;
  }
  try {
    const certPem = await fs.readFile(certPath, "utf-8");
    const keyPem = await fs.readFile(keyPath, "utf-8");
    const cert = forge.pki.certificateFromPem(certPem);
    const key = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
    return { cert, key, certPem, keyPem };
  } catch {
    return null;
  }
}

async function writeCa(
  certPath: string,
  keyPath: string,
  certPem: string,
  keyPem: string,
): Promise<void> {
  await fs.writeFile(certPath, certPem, { mode: 0o644 });
  await fs.writeFile(keyPath, keyPem, { mode: 0o600 });
}

/**
 * Load the MITM root CA from ~/.dpcode/ca/, generating a fresh one if none
 * exists or the current one is near expiry. Returns the PEM-encoded cert+key
 * (for env-var injection) plus the parsed forge objects (for leaf signing).
 */
export async function loadOrCreateCertificateAuthority(): Promise<CertificateAuthority> {
  const caDir = resolveCaDir();
  const caCertPath = path.join(caDir, CA_CERT_FILENAME);
  const caKeyPath = path.join(caDir, CA_KEY_FILENAME);

  await ensureDir(caDir);

  const existing = await loadExistingCa(caCertPath, caKeyPath);
  if (existing && !isNearExpiry(existing.cert)) {
    return {
      caDir,
      caCertPath,
      caKeyPath,
      caCertPem: existing.certPem,
      caKeyPem: existing.keyPem,
      caCert: existing.cert,
      caKey: existing.key,
      validFrom: existing.cert.validity.notBefore,
      validTo: existing.cert.validity.notAfter,
    };
  }

  const generated = generateRootCa();
  const certPem = forge.pki.certificateToPem(generated.cert);
  const keyPem = forge.pki.privateKeyToPem(generated.key);
  await writeCa(caCertPath, caKeyPath, certPem, keyPem);

  return {
    caDir,
    caCertPath,
    caKeyPath,
    caCertPem: certPem,
    caKeyPem: keyPem,
    caCert: generated.cert,
    caKey: generated.key,
    validFrom: generated.cert.validity.notBefore,
    validTo: generated.cert.validity.notAfter,
  };
}
