/**
 * Minimal DER (ASN.1) reader — just enough to pull DNS names and notBefore out of an X.509
 * certificate or a bare TBSCertificate (CT pre-certificate entries contain only the TBS part,
 * which node:crypto cannot parse). Never throws on garbage: returns null / empty results.
 */
export interface Tlv {
  tag: number;
  start: number; // offset of the value
  end: number; // offset after the value
  constructed: boolean;
}

export function readTlv(buf: Uint8Array, pos: number, limit = buf.length): Tlv | null {
  if (pos + 2 > limit) return null;
  const tag = buf[pos];
  let len = buf[pos + 1];
  let p = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || p + n > limit) return null; // indefinite / absurd lengths are not DER
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p + i];
    p += n;
  }
  if (p + len > limit) return null;
  return { tag, start: p, end: p + len, constructed: (tag & 0x20) !== 0 };
}

export function children(buf: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let p = t.start;
  while (p < t.end) {
    const c = readTlv(buf, p, t.end);
    if (!c) break;
    out.push(c);
    p = c.end;
  }
  return out;
}

const OID_SAN = [0x55, 0x1d, 0x11]; // 2.5.29.17 subjectAltName
const OID_CN = [0x55, 0x04, 0x03]; // 2.5.4.3 commonName
const ascii = (b: Uint8Array, t: Tlv) => String.fromCharCode(...b.subarray(t.start, t.end));
const eqBytes = (b: Uint8Array, t: Tlv, ref: number[]) =>
  t.end - t.start === ref.length && ref.every((v, i) => b[t.start + i] === v);

function parseTime(b: Uint8Array, t: Tlv): Date | null {
  const s = ascii(b, t);
  // UTCTime: YYMMDDHHMMSSZ (YY >= 50 -> 19YY); GeneralizedTime: YYYYMMDDHHMMSSZ
  const m =
    t.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s)
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return null;
  let year = Number(m[1]);
  if (t.tag === 0x17) year += year >= 50 ? 1900 : 2000;
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
}

export interface CertNames {
  dnsNames: string[];
  commonName: string | null;
  notBefore: Date | null;
}

/** `der` is a full Certificate (isTbs=false) or a bare TBSCertificate (isTbs=true). */
export function certNames(der: Uint8Array, isTbs: boolean): CertNames | null {
  const outer = readTlv(der, 0);
  if (!outer || outer.tag !== 0x30) return null;
  const tbs = isTbs ? outer : children(der, outer)[0];
  if (!tbs || tbs.tag !== 0x30) return null;
  const f = children(der, tbs);
  let i = 0;
  if (f[i]?.tag === 0xa0) i++; // [0] EXPLICIT version
  // serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo
  const validity = f[i + 3];
  const subject = f[i + 4];
  let notBefore: Date | null = null;
  if (validity?.tag === 0x30) {
    const v = children(der, validity)[0];
    if (v) notBefore = parseTime(der, v);
  }
  let commonName: string | null = null;
  if (subject?.tag === 0x30) {
    for (const rdn of children(der, subject)) {
      for (const atv of children(der, rdn)) {
        const [oid, val] = children(der, atv);
        if (oid && val && eqBytes(der, oid, OID_CN)) commonName = ascii(der, val).toLowerCase();
      }
    }
  }
  const dnsNames: string[] = [];
  const extsWrapper = f.find((x) => x.tag === 0xa3); // [3] EXPLICIT extensions
  if (extsWrapper) {
    const exts = children(der, extsWrapper)[0];
    for (const ext of exts ? children(der, exts) : []) {
      const parts = children(der, ext);
      if (!parts[0] || !eqBytes(der, parts[0], OID_SAN)) continue;
      const octet = parts[parts.length - 1]; // extnValue OCTET STRING (critical flag may precede it)
      const names = readTlv(der, octet.start, octet.end);
      if (!names) continue;
      for (const gn of children(der, names)) if (gn.tag === 0x82) dnsNames.push(ascii(der, gn).toLowerCase());
    }
  }
  return { dnsNames, commonName, notBefore };
}
