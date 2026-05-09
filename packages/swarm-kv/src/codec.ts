export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export type StoredValue = string | Uint8Array | JsonValue;

const TAG_TOMBSTONE = 0x00;
const TAG_STRING = 0x73; // 's'
const TAG_JSON = 0x6a; // 'j'
const TAG_BYTES = 0x62; // 'b'

export const TOMBSTONE: Buffer = Buffer.of(TAG_TOMBSTONE);

export function encodeValue(value: StoredValue): Buffer {
  if (typeof value === "string") {
    return Buffer.concat([Buffer.of(TAG_STRING), Buffer.from(value, "utf8")]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([Buffer.of(TAG_BYTES), Buffer.from(value)]);
  }
  return Buffer.concat([Buffer.of(TAG_JSON), Buffer.from(JSON.stringify(value), "utf8")]);
}

export interface Decoded {
  kind: "string" | "json" | "bytes" | "tombstone";
  value: StoredValue | null;
}

export function decodeValue(blob: Uint8Array): Decoded {
  if (blob.length === 0) throw new Error("empty value");
  const tag = blob[0]!;
  const rest = blob.subarray(1);
  switch (tag) {
    case TAG_TOMBSTONE:
      return { kind: "tombstone", value: null };
    case TAG_STRING:
      return { kind: "string", value: Buffer.from(rest).toString("utf8") };
    case TAG_JSON:
      return {
        kind: "json",
        value: JSON.parse(Buffer.from(rest).toString("utf8")) as JsonValue,
      };
    case TAG_BYTES:
      return { kind: "bytes", value: Uint8Array.from(rest) };
    default:
      throw new Error(`unknown value tag: 0x${tag.toString(16)}`);
  }
}
