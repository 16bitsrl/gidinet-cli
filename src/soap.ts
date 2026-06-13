import { XMLParser } from "fast-xml-parser";

/**
 * Minimal SOAP 1.1 client for the QuickServiceBox / GiDiNet ASMX services.
 *
 * Rather than fetching and parsing the WSDL on every invocation (slow for a
 * CLI), envelopes are built by hand — the operations and their namespaces are
 * fixed and known. Every response is unwrapped from its `{method}Result`
 * wrapper and checked for the API's `resultCode`.
 */

export class GidinetError extends Error {
  constructor(
    message: string,
    readonly resultCode = -1,
    readonly resultSubCode = -1,
    readonly method = "",
  ) {
    super(message);
    this.name = "GidinetError";
  }
}

/** A parameter tree. Arrays repeat the element; objects nest. */
export type SoapValue = string | number | boolean | SoapParams | SoapValue[];
export interface SoapParams {
  [key: string]: SoapValue;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildNode(name: string, value: SoapValue): string {
  if (Array.isArray(value)) {
    return value.map((item) => buildNode(name, item)).join("");
  }
  if (value !== null && typeof value === "object") {
    const inner = Object.entries(value)
      .map(([k, v]) => buildNode(k, v))
      .join("");
    return `<${name}>${inner}</${name}>`;
  }
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

export interface SoapEndpoint {
  url: string;
  namespace: string;
}

export interface CallOptions {
  username: string;
  password: string;
  timeout?: number;
}

/**
 * Invoke a SOAP method and return the unwrapped, result-checked payload object.
 * Credentials are injected as `accountUsername` / `accountPasswordB64`.
 */
export async function soapCall(
  endpoint: SoapEndpoint,
  method: string,
  params: SoapParams,
  opts: CallOptions,
): Promise<any> {
  const body =
    buildNode("accountUsername", opts.username) +
    buildNode("accountPasswordB64", Buffer.from(opts.password).toString("base64")) +
    Object.entries(params)
      .map(([k, v]) => buildNode(k, v))
      .join("");

  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><${method} xmlns="${endpoint.namespace}">${body}</${method}></soap:Body>` +
    `</soap:Envelope>`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (opts.timeout ?? 30) * 1000);

  let res: Response;
  try {
    res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${endpoint.namespace}/${method}"`,
      },
      body: envelope,
      signal: controller.signal,
    });
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "request timed out" : (e as Error).message;
    throw new GidinetError(`Network error calling ${method}: ${reason}`, -1, -1, method);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const doc = parser.parse(text);

  const envelopeNode = doc.Envelope ?? doc;
  const fault = envelopeNode?.Body?.Fault;
  if (fault) {
    throw new GidinetError(`SOAP fault calling ${method}: ${fault.faultstring ?? "unknown"}`, -1, -1, method);
  }

  const response = envelopeNode?.Body?.[`${method}Response`];
  const result = response?.[`${method}Result`] ?? response;
  if (result === undefined) {
    throw new GidinetError(`Malformed response for ${method} (HTTP ${res.status})`, -1, -1, method);
  }

  const code = Number(result.resultCode ?? -1);
  if (code !== 0) {
    throw new GidinetError(
      String(result.resultText ?? `Call ${method} failed`),
      code,
      Number(result.resultSubCode ?? -1),
      method,
    );
  }

  return result;
}

/** Normalize a SOAP list node (single object | array | undefined) into an array. */
export function listOf<T = any>(node: T | T[] | undefined | null): T[] {
  if (node === null || node === undefined) return [];
  return Array.isArray(node) ? node : [node];
}
