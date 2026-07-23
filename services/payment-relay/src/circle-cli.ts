// WHAT THIS FILE IS: the thin wrapper around the real `circle` CLI binary.
// It is the only code in this whole demo that actually shells out to Circle
// to search for services, inspect what a seller accepts, and execute a real
// x402/USDC payment. Everything upstream of this file (the TEE contract's
// policy check, the Express /pay route in server.ts) is just deciding
// *whether* to call these functions -- this file is what makes the money move.
//
// Wraps the real `circle` CLI. Uses execFile with an argv array (never a
// shell string) so seller-controlled fields (service_url, method) flowing in
// from the marketplace can't break out of a shell command -- the exact risk
// the `pay-via-agent-wallet` skill warns about. Method is additionally
// allowlist-checked as defense in depth.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// `execFile` (not `exec` + a shell string) is used deliberately here: it runs
// `circle` as a direct argv array with no shell interpolation step, so a
// malicious/compromised seller can't smuggle shell metacharacters through
// `service_url` (or any other field we forward) to run arbitrary commands.
// Never swap this for `exec`/template-string shell invocation.
const execFileAsync = promisify(execFile);

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

// CAIP-2 chain id -> circle CLI's --chain value. Circle's own pay-via-agent-wallet
// skill warns about exactly this: "Don't assume BASE" -- a seller's accepts[]
// dictates which chains are payable, and passing the wrong one fails outright
// ("Seller does not accept --chain X. Accepted chains: Y."). This project hit
// that for real: a hardcoded CIRCLE_DEFAULT_CHAIN of MATIC (Polygon) worked for
// the two Polygon-only sellers captured during initial research, then produced
// an opaque failure the first time a real agent run picked a Base-only seller
// (Arrays' Fear & Greed Index, eip155:8453) -- see docs/DEVELOPER_BUILD_LOG.md.
const CAIP2_TO_CIRCLE_CHAIN: Record<string, string> = {
  "eip155:1": "ETH",
  "eip155:137": "MATIC",
  "eip155:8453": "BASE",
  "eip155:42161": "ARB",
  "eip155:10": "OP",
  "eip155:43114": "AVAX",
  "eip155:130": "UNI",
};
const CIRCLE_CHAIN_TO_CAIP2: Record<string, string> = Object.fromEntries(
  Object.entries(CAIP2_TO_CIRCLE_CHAIN).map(([caip2, chain]) => [chain, caip2])
);

export interface CirclePayResult {
  relay_ref: string;
  service_response: unknown;
}

// Inspects the seller to find a chain it actually accepts, mapped to the CLI's
// expected --chain value. Falls back to `fallbackChain` if inspect fails or
// reports a CAIP-2 id this project doesn't have a mapping for yet.
//
// Confirmed as a real bug: picking chains[0] unconditionally (as this used
// to) ignores which chain the wallet is actually funded on. A seller listing
// many accepted chains, with the known-funded one further down the list (or
// missing --chain reported as chains[0] instead), caused a real payment
// attempt to hang against an unfunded chain until execFileAsync's own 30s
// timeout killed it ("Error: terminated") -- a much worse failure mode than
// a clean, fast "insufficient balance" rejection. Prefer `fallbackChain`
// (the project's known-funded default) whenever the seller accepts it at
// all, and only fall back to chains[0]'s mapping for sellers that don't
// accept the default chain at all (e.g. a Base/Solana-only seller).
//
// CUSTOMIZE: `fallbackChain` here is whatever the caller passes as
// `opts.chain`, which server.ts sources from CIRCLE_DEFAULT_CHAIN (defaults
// to "MATIC" in this demo). Set CIRCLE_DEFAULT_CHAIN to whichever chain your
// own Circle wallet is actually funded on -- otherwise every payment attempt
// falls back to a chain resolvePayChain can't confirm the wallet can pay on,
// which is exactly the hang-until-timeout failure mode described above.
async function resolvePayChain(serviceUrl: string, fallbackChain: string): Promise<string> {
  try {
    const inspected = (await inspectServiceViaCli(serviceUrl)) as { data?: { chains?: string[] } };
    const chains = inspected?.data?.chains ?? [];
    const fallbackCaip2 = CIRCLE_CHAIN_TO_CAIP2[fallbackChain];
    if (fallbackCaip2 && chains.includes(fallbackCaip2)) return fallbackChain;
    const firstMapped = chains.map((caip2) => CAIP2_TO_CIRCLE_CHAIN[caip2]).find((mapped) => mapped);
    if (firstMapped) return firstMapped;
  } catch {
    // fall through to fallbackChain -- inspect failing shouldn't block the pay
    // attempt outright, since the fallback may still be correct for this seller
  }
  return fallbackChain;
}

export async function payViaCli(opts: {
  serviceUrl: string;
  method: string;
  payload: unknown;
  walletAddress: string;
  chain: string; // fallback only -- used if inspect fails to report a known chain
}): Promise<CirclePayResult> {
  const method = opts.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`refusing unrecognized HTTP method from service listing: ${opts.method}`);
  }
  let serviceUrl: URL;
  try {
    serviceUrl = new URL(opts.serviceUrl);
  } catch {
    throw new Error(`refusing non-URL service_url: ${opts.serviceUrl}`);
  }
  if (serviceUrl.protocol !== "http:" && serviceUrl.protocol !== "https:") {
    throw new Error(`refusing non-http(s) service_url: ${opts.serviceUrl}`);
  }

  // Ask the seller which chain(s) it actually accepts rather than trusting a
  // single hardcoded default -- mirrors the skill doc's own guidance to always
  // inspect before paying to confirm the chain.
  const chain = await resolvePayChain(serviceUrl.toString(), opts.chain);
  // Logged directly so a future hang/failure doesn't need to be reconstructed
  // from the CLI's own error text (see the resolvePayChain fix above -- the
  // resolved chain was previously invisible until something went wrong).
  console.log(`[pay] resolved chain=${chain} for ${serviceUrl.toString()}`);

  // `circle services pay` does NOT fold `--data` into the URL's query string
  // for GET/HEAD -- confirmed empirically (see docs/DEVELOPER_BUILD_LOG.md
  // §3f): a GET endpoint with a required query param (e.g. `?pair=BTC/USDT`)
  // returns a plain 400 (never reaching the 402 payment challenge, so no
  // funds are spent on the failed attempt) unless that param is already in
  // the URL. So for GET/HEAD, fold a plain-object payload into the URL's
  // query string ourselves and omit --data; for methods that take a body,
  // keep --data as before.
  const hasNoBody = method === "GET" || method === "HEAD";
  if (hasNoBody && opts.payload && typeof opts.payload === "object") {
    for (const [key, value] of Object.entries(opts.payload as Record<string, unknown>)) {
      serviceUrl.searchParams.set(key, String(value));
    }
  }

  const args = [
    "services",
    "pay",
    serviceUrl.toString(),
    "-X",
    method,
    "--address",
    opts.walletAddress,
    "--chain",
    chain,
    "--output",
    "json",
  ];
  if (!hasNoBody) {
    args.push("--data", JSON.stringify(opts.payload ?? {}));
  }

  // Real shape, confirmed against a live GatewayWalletBatched payment (M0
  // spike -- see docs/DEVELOPER_BUILD_LOG.md §3e):
  //   { data: { response: <the paid API's body>,
  //             payment: { amount, chain, scheme, seller,
  //                        receipt: <base64 JSON: {success, transaction, network, payer}> } } }
  // The real transaction reference is nested inside the base64-encoded
  // `receipt`, not a flat `paymentReference`/`txHash` field -- those
  // fallbacks are kept in case a different scheme (vanilla x402, a
  // different seller) shapes its response differently.
  const { stdout } = await execFileAsync("circle", args, { timeout: 30_000 });
  const parsed = JSON.parse(stdout);

  let relayRef: string | undefined;
  const receiptB64 = parsed?.data?.payment?.receipt;
  if (typeof receiptB64 === "string") {
    try {
      const receipt = JSON.parse(Buffer.from(receiptB64, "base64").toString("utf-8"));
      relayRef = receipt?.transaction;
    } catch {
      // fall through to the flatter guesses below
    }
  }
  relayRef ??=
    parsed?.data?.paymentReference ?? parsed?.data?.txHash ?? parsed?.paymentReference ?? parsed?.txHash;
  relayRef ??= `unverified-shape:${Date.now()}`;

  const serviceResponse = parsed?.data?.response ?? parsed?.response ?? parsed;

  return { relay_ref: String(relayRef), service_response: serviceResponse };
}

export async function searchServicesViaCli(keyword: string): Promise<unknown> {
  const { stdout } = await execFileAsync("circle", ["services", "search", keyword, "--output", "json"], {
    timeout: 30_000,
  });
  return JSON.parse(stdout);
}

export async function inspectServiceViaCli(serviceUrl: string): Promise<unknown> {
  let url: URL;
  try {
    url = new URL(serviceUrl);
  } catch {
    throw new Error(`refusing non-URL service_url: ${serviceUrl}`);
  }
  const { stdout } = await execFileAsync("circle", ["services", "inspect", url.toString(), "--output", "json"], {
    timeout: 30_000,
  });
  return JSON.parse(stdout);
}
