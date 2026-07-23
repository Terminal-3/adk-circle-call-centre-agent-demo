// WHAT THIS FILE DOES: Exposes search_services (loop.ts) -- lets the model
// browse Circle's x402 paid-service marketplace by keyword before deciding
// what to inspect/pay for. Pure discovery: shells out to the Circle CLI (or
// hits a mock relay endpoint in MOCK_CIRCLE mode), then caps/annotates the
// result list so it stays small and well-formed in the model's context. No
// Terminal 3 involvement and no money moves here.
//
// Discovery only -- no money moves, no Terminal 3 involvement. Real mode
// shells out to the Circle CLI directly; mock mode hits the relay's
// dev-only /mock/search (see services/payment-relay/src/server.ts).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MOCK_CIRCLE = process.env.MOCK_CIRCLE === "1";
const RELAY_BASE_URL = process.env.RELAY_BASE_URL ?? "http://localhost:8787";

// Nothing bounds the real Circle marketplace's result-list size the way
// relay_client.rs's MAX_RELAY_RESPONSE_BYTES bounds a paid response inside
// the enclave -- and unlike that path, this one's result gets JSON.stringify'd
// straight into the agent's OpenAI message history (loop.ts's callTool),
// which is never pruned. A single broad-keyword search returning dozens of
// full listings, repeated across several turns, is enough to blow past
// gpt-4o's 128K context on its own -- confirmed against a live VPS run.
// Cap the item list itself rather than truncating the raw response text, so
// the JSON stays well-formed and the model can still tell how many results
// exist beyond what's shown.
const MAX_RESULTS = 10;

// A static tool-description nudge ("search by category, not ticket topic")
// turned out not to be sticky enough -- confirmed twice on live runs, the
// model kept reaching for "<ticket topic> verification" keywords again
// several turns later regardless. Injecting a hint directly into an empty
// result, right where the model is actually looking, is a much stronger
// nudge than a static description read once near the start of the
// conversation.
const EMPTY_RESULT_HINT =
  "No matches. The marketplace indexes by service category, not ticket topic -- try 'web " +
  "search', 'research', or 'phone call' instead of paraphrasing what the ticket needs verified.";

function capResultList(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const data = (parsed as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) return parsed;
  let sawList = false;
  let empty = true;
  for (const key of ["items", "services"] as const) {
    const list = (data as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    sawList = true;
    if (list.length > 0) empty = false;
    if (list.length > MAX_RESULTS) {
      (data as Record<string, unknown>)[key] = list.slice(0, MAX_RESULTS);
      (data as Record<string, unknown>).truncated = { shown: MAX_RESULTS, total: list.length };
    }
  }
  if (sawList && empty) (data as Record<string, unknown>).hint = EMPTY_RESULT_HINT;
  return parsed;
}

export async function searchServices(keyword: string): Promise<unknown> {
  if (MOCK_CIRCLE) {
    const resp = await fetch(`${RELAY_BASE_URL}/mock/search?keyword=${encodeURIComponent(keyword)}`);
    if (!resp.ok) throw new Error(`mock search failed: HTTP ${resp.status}`);
    return capResultList(await resp.json());
  }
  const { stdout } = await execFileAsync("circle", ["services", "search", keyword, "--output", "json"], {
    timeout: 30_000,
  });
  return capResultList(JSON.parse(stdout));
}
