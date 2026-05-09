import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export interface DerivedKeys {
  encKey: Buffer;
  macKey: Buffer;
}

const HKDF_HASH = "sha256";
const ENC_INFO = Buffer.from("swarm-kv-enc-v1");
const MAC_INFO = Buffer.from("swarm-kv-mac-v1");

export function deriveKeys(privateKey: Uint8Array, namespace: string): DerivedKeys {
  const salt = Buffer.from(namespace, "utf8");
  const enc = Buffer.from(hkdfSync(HKDF_HASH, privateKey, salt, ENC_INFO, 32) as ArrayBuffer);
  const mac = Buffer.from(hkdfSync(HKDF_HASH, privateKey, salt, MAC_INFO, 32) as ArrayBuffer);
  return { encKey: enc, macKey: mac };
}

export function topicForKey(macKey: Uint8Array, namespace: string, key: string): Buffer {
  return createHmac("sha256", macKey).update(`kv:${namespace}:user:${key}`).digest();
}

export function topicForIndex(macKey: Uint8Array, namespace: string): Buffer {
  return createHmac("sha256", macKey).update(`kv:${namespace}:index`).digest();
}

const CIPHER_VERSION = 0x01;
const NONCE_LEN = 12;
const TAG_LEN = 16;

export function aesEncrypt(
  encKey: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Buffer {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", encKey, nonce);
  if (aad) cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.of(CIPHER_VERSION), nonce, body, tag]);
}

export function aesDecrypt(
  encKey: Uint8Array,
  blob: Uint8Array,
  aad?: Uint8Array,
): Buffer {
  if (blob.length < 1 + NONCE_LEN + TAG_LEN) {
    throw new Error("ciphertext too short");
  }
  if (blob[0] !== CIPHER_VERSION) {
    throw new Error(`unsupported cipher version: 0x${blob[0]?.toString(16)}`);
  }
  const nonce = blob.subarray(1, 1 + NONCE_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const body = blob.subarray(1 + NONCE_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", encKey, nonce);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
