import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AuthorityKeyIdentifierExtension, BasicConstraintsExtension, ExtendedKeyUsage, ExtendedKeyUsageExtension, Extension,
  KeyUsageFlags, KeyUsagesExtension, SubjectAlternativeNameExtension, SubjectKeyIdentifierExtension, X509CertificateGenerator
} from "@peculiar/x509";

// The backend's local https certificate (Core-Backend #377). 7.00 turns the http:// service addresses in its config into
// https:// while it loads them, and 7.10 won't log in unless the identity service's Protocol is https, so the purchase
// flow's built-in browser (CEF), which goes straight to the backend (CoreRedirect and the -httpproxy don't carry it),
// opens https://127.0.0.1:<port>/exchange?.... That browser only takes a certificate Windows trusts.
//
// So each backend makes its own: a root that can only ever vouch for 127.0.0.1 and localhost (a critical nameConstraints
// extension, pathlen 0), and one leaf it signs for those names. The root's private key only lives in memory while the
// leaf is signed (a non-extractable WebCrypto key, dropped right after): it is never written anywhere, so nothing else
// can ever be issued under that root, and trusting it (the launcher's opt-in, Core-Launcher) can't make any other site
// look genuine. Nothing is shared between backends: every install has its own root, its own leaf and its own key.
//
// Kept in <dataDir>/tls: the leaf's key and certificate and the root's certificate, PEM. Made again, with a new root,
// when one is missing or unreadable, doesn't match the others, or is within renewDays of expiring.

export const rootSubject = "CN=Core local backend (127.0.0.1 only), O=Core";
const leafSubject = "CN=localhost, O=Core";
const validYears = 10;
const renewDays = 30;
const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
const { webcrypto } = crypto;

export const tlsFiles = (dataDir) => {
  const dir = path.join(dataDir, "tls");
  return { dir, key: path.join(dir, "backend-key.pem"), cert: path.join(dir, "backend-cert.pem"), root: path.join(dir, "root-cert.pem") };
};

// DER, enough for the one extension @peculiar/x509 has no class for.
function der(tag, ...parts) {
  const body = Buffer.concat(parts);
  if (body.length > 0xff) throw new Error("DER value too long");
  const length = body.length < 0x80 ? [body.length] : [0x81, body.length];
  return Buffer.concat([Buffer.from([tag, ...length]), body]);
}

// NameConstraints ::= SEQUENCE { permittedSubtrees [0] GeneralSubtrees } (RFC 5280 4.2.1.10), each GeneralSubtree a
// SEQUENCE of its base GeneralName: iPAddress [7] 127.0.0.1 with mask 255.255.255.255, and dNSName [2] "localhost"
// (which RFC 5280 also lets cover the names under it, *.localhost, loopback names too). No other name of either type is
// permitted, and no IPv6 address either: an iPAddress constraint of one length excludes the other's.
export const nameConstraintsOid = "2.5.29.30";
export const nameConstraintsDer = () => der(0x30, der(0xa0,
  der(0x30, der(0x87, Buffer.from([127, 0, 0, 1, 255, 255, 255, 255]))),
  der(0x30, der(0x82, Buffer.from("localhost", "ascii")))));

const serial = () => {
  const bytes = crypto.randomBytes(16);
  bytes[0] = (bytes[0] & 0x7f) | 0x01;
  return bytes.toString("hex");
};

const validity = (now) => {
  const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + validYears);
  return { notBefore, notAfter };
};

export const generateKeys = (extractable) => webcrypto.subtle.generateKey(algorithm, extractable, ["sign", "verify"]);

// The root: CA, pathlen 0 (it signs leaves only), certificate signing only, and the nameConstraints above, critical.
export async function buildRoot(keys, now = new Date()) {
  return X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: rootSubject,
    ...validity(now),
    keys,
    signingAlgorithm: algorithm,
    extensions: [
      new BasicConstraintsExtension(true, 0, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
      new Extension(nameConstraintsOid, true, nameConstraintsDer()),
      await SubjectKeyIdentifierExtension.create(keys.publicKey, false, webcrypto)
    ]
  }, webcrypto);
}

const defaultNames = [{ type: "ip", value: "127.0.0.1" }, { type: "dns", value: "localhost" }];

// A leaf the root signs: a TLS server's, for the names given (127.0.0.1 and localhost).
export async function buildLeaf(root, rootPrivateKey, leafKeys, now = new Date(), names = defaultNames) {
  return X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: leafSubject,
    issuer: root.subject,
    ...validity(now),
    publicKey: leafKeys.publicKey,
    signingKey: rootPrivateKey,
    signingAlgorithm: algorithm,
    extensions: [
      new BasicConstraintsExtension(false, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment, true),
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth], false),
      new SubjectAlternativeNameExtension(names, false),
      await SubjectKeyIdentifierExtension.create(leafKeys.publicKey, false, webcrypto),
      await AuthorityKeyIdentifierExtension.create(root.publicKey, false, webcrypto)
    ]
  }, webcrypto);
}

// A new root and leaf. The root's key pair is non-extractable and goes out of scope here: only its certificate is kept.
export async function createCertificates(now = new Date()) {
  const rootKeys = await generateKeys(false);
  const root = await buildRoot(rootKeys, now);
  const leafKeys = await generateKeys(true);
  const leaf = await buildLeaf(root, rootKeys.privateKey, leafKeys, now);
  const key = crypto.KeyObject.from(leafKeys.privateKey).export({ type: "pkcs8", format: "pem" });
  return { key, cert: leaf.toString("pem"), rootCert: root.toString("pem") };
}

// Whether a set is usable at `now`: the leaf signed by the root, the key the leaf's, neither within renewDays of expiring.
export function usable({ key, cert, rootCert }, now = new Date()) {
  try {
    const leaf = new crypto.X509Certificate(cert);
    const root = new crypto.X509Certificate(rootCert);
    const renewAt = now.getTime() + renewDays * 24 * 60 * 60 * 1000;
    for (const certificate of [leaf, root]) {
      if (new Date(certificate.validFrom).getTime() > now.getTime() || new Date(certificate.validTo).getTime() < renewAt) return false;
    }
    return root.ca && !leaf.ca && leaf.checkIssued(root) && leaf.verify(root.publicKey) && leaf.checkPrivateKey(crypto.createPrivateKey(key));
  } catch {
    return false;
  }
}

function writeFile(file, text, mode) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, text, { mode });
  fs.renameSync(temp, file);
}

function readSet(files) {
  try {
    return { key: fs.readFileSync(files.key, "utf8"), cert: fs.readFileSync(files.cert, "utf8"), rootCert: fs.readFileSync(files.root, "utf8") };
  } catch {
    return null;
  }
}

// The data folder's set, made and written first when it has no usable one: { key, cert, rootCert, created }.
export async function loadCertificates(dataDir, now = new Date()) {
  const files = tlsFiles(dataDir);
  const existing = readSet(files);
  if (existing && usable(existing, now)) return { ...existing, created: false };
  const made = await createCertificates(now);
  fs.mkdirSync(files.dir, { recursive: true });
  writeFile(files.root, made.rootCert, 0o644);
  writeFile(files.key, made.key, 0o600);
  writeFile(files.cert, made.cert, 0o644);
  return { ...made, created: true };
}

// A certificate's SHA-1 thumbprint as Windows shows it (certmgr, X509Certificate2.Thumbprint): 40 hex digits, upper case.
export const thumbprint = (pem) => new crypto.X509Certificate(pem).fingerprint.replace(/:/g, "").toUpperCase();
