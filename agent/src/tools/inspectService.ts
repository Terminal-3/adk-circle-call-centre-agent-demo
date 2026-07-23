// WHAT THIS FILE DOES: Exposes inspect_service (loop.ts) -- lets the model
// check a specific service's price/method/schema before paying for it. Pure
// discovery: shells out to the Circle CLI (or hits a mock relay endpoint in
// MOCK_CIRCLE mode) and normalizes the price into a plain dollar amount. No
// Terminal 3 involvement and no money moves here.
//
// Discovery only -- no money moves, no Terminal 3 involvement. See
// searchServices.ts for the mock/real split rationale.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MOCK_CIRCLE = process.env.MOCK_CIRCLE === "1";
const RELAY_BASE_URL = process.env.RELAY_BASE_URL ?? "http://localhost:8787";

// USDC's standard 6 decimals -- confirmed against two independent real
// listings' price.amount/price.formatted pairs (StablePhone: "540000" /
// "$0.54 USDC"; AIsa/Tavily: "9600" / "$0.0096 USDC"), both consistent with
// dividing the raw on-chain base-unit integer by 1e6.
const USDC_BASE_UNITS = 1_000_000;

// Real mode's `circle services inspect` output has no clean top-level dollar
// number -- only the raw x402 `price: {amount, formatted}` shape (`amount`
// is the on-chain base-unit integer). Mock mode's /mock/inspect always
// returned a clean `data.amount_usdc` number instead, and a live run
// confirmed why that asymmetry matters: the model read `price.amount`
// directly as if it were already dollars and tried to pay $9600 for a
// $0.0096 service (the enclave's own per-call cap caught it, but the tool
// output itself was the real, avoidable ambiguity). Inject the same clean
// `amount_usdc` field real mode was missing, so both paths return the same
// shape and there's nothing left to misread.
function normalizeRealInspectResult(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const data = (parsed as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) return parsed;
  const price = (data as Record<string, unknown>).price;
  if (typeof price !== "object" || price === null) return parsed;
  const rawAmount = (price as Record<string, unknown>).amount;
  if (typeof rawAmount !== "string" && typeof rawAmount !== "number") return parsed;
  const amount = Number(rawAmount) / USDC_BASE_UNITS;
  if (Number.isFinite(amount)) (data as Record<string, unknown>).amount_usdc = amount;
  return parsed;
}

export async function inspectService(serviceUrl: string): Promise<unknown> {
  if (MOCK_CIRCLE) {
    const resp = await fetch(`${RELAY_BASE_URL}/mock/inspect?service_url=${encodeURIComponent(serviceUrl)}`);
    if (!resp.ok) throw new Error(`mock inspect failed: HTTP ${resp.status}`);
    return resp.json();
  }
  const { stdout } = await execFileAsync("circle", ["services", "inspect", serviceUrl, "--output", "json"], {
    timeout: 30_000,
  });
  return normalizeRealInspectResult(JSON.parse(stdout));
}
