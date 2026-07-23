// WHAT THIS FILE IS: a small Express server that is the ONLY thing outside
// the TEE enclave that the Terminal 3 contract ever talks to. The contract
// enforces spend policy inside the enclave, then calls this relay's /pay
// route to actually execute the payment via the real Circle CLI (see
// ./circle-cli.ts). MOCK_CIRCLE=1 lets you run the whole demo end-to-end with
// zero real Circle credentials, using canned data from mock-data/services.json.
//
// The relay: the one thing the Terminal 3 contract is allowed to call, and
// (in production) the only place that ever touches a live Circle session.
// MOCK_CIRCLE=1 swaps the real `circle` CLI calls for canned responses seeded
// from mock-data/services.json (real captured marketplace data, see its
// README) -- everything else (the /pay auth check, the contract's policy
// enforcement, the ledger) runs unmocked.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { payViaCli, searchServicesViaCli, inspectServiceViaCli } from "./circle-cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? "8787");
const RELAY_SHARED_SECRET = requireEnv("RELAY_SHARED_SECRET");
const MOCK_CIRCLE = process.env.MOCK_CIRCLE === "1";
const CIRCLE_WALLET_ADDRESS = process.env.CIRCLE_WALLET_ADDRESS; // required only in real mode
// CUSTOMIZE: set this to whichever chain your own Circle wallet is actually
// funded on. It's only a fallback (circle-cli.ts's resolvePayChain asks the
// seller what it accepts first), but a wrong/unfunded default here can still
// cause a slow hang-until-timeout on a seller that doesn't accept anything
// else -- see circle-cli.ts for the full story.
const CIRCLE_DEFAULT_CHAIN = process.env.CIRCLE_DEFAULT_CHAIN ?? "MATIC";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

interface MockService {
  resource: string;
  type: string;
  x402Version: number;
  accepts: unknown[];
  metadata: {
    provider: { name: string; website: string; description: string; category: string; tags: string[] };
    path: string;
    method: string;
    description: string;
    amount_usdc: number;
  };
}

const mockServices: MockService[] = JSON.parse(
  readFileSync(path.join(__dirname, "..", "mock-data", "services.json"), "utf-8")
);

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, mock: MOCK_CIRCLE });
});

// --- Contract-facing endpoint: the only call the TEE contract makes. ---
// Authenticated by a shared secret sent in the `X-Relay-Secret` header (set
// via the RELAY_SHARED_SECRET env var on both the contract side and here).
// This is what stops anyone else who can reach this port from spending real
// USDC through your wallet -- this route must NEVER be exposed (directly or
// via a reverse proxy) without that header check passing.
app.post("/pay", async (req, res) => {
  if (req.header("X-Relay-Secret") !== RELAY_SHARED_SECRET) {
    return res.status(401).json({ error: "bad relay secret" });
  }

  const { service_url, method, payload, idempotency_key } = req.body ?? {};
  if (!service_url || !method || !idempotency_key) {
    return res.status(400).json({ error: "service_url, method, and idempotency_key are required" });
  }

  const startedAt = Date.now();
  console.log(`[pay] -> ${idempotency_key} ${method} ${service_url}`);

  try {
    let responseBody: unknown;
    if (MOCK_CIRCLE) {
      const match = mockServices.find((s) => s.resource === service_url);
      responseBody = {
        relay_ref: `mock-${idempotency_key}`,
        service_response: match
          ? { description: match.metadata.description, provider: match.metadata.provider.name, mocked: true }
          : { mocked: true, note: "no matching mock service listing; returning a generic canned response" },
      };
    } else {
      if (!CIRCLE_WALLET_ADDRESS) throw new Error("CIRCLE_WALLET_ADDRESS is required in real (non-mock) mode");
      responseBody = await payViaCli({
        serviceUrl: service_url,
        method,
        payload,
        walletAddress: CIRCLE_WALLET_ADDRESS,
        chain: CIRCLE_DEFAULT_CHAIN,
      });
    }
    // Logging the response SIZE (not the full body -- may contain real API
    // data) is the key diagnostic for the WASM-trap investigation in
    // docs/DEVELOPER_BUILD_LOG.md §3q: was the response the relay sent back
    // to the contract unexpectedly large?
    const bodyBytes = Buffer.byteLength(JSON.stringify(responseBody));
    console.log(`[pay] <- ${idempotency_key} ok, ${bodyBytes} bytes, ${Date.now() - startedAt}ms`);
    res.json(responseBody);
  } catch (err) {
    console.log(`[pay] <- ${idempotency_key} error after ${Date.now() - startedAt}ms:`, err);
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Agent-facing discovery endpoints, mock mode only. In production the
// agent shells out to `circle services search/inspect` directly (no money
// moves, no relay involvement) -- these exist purely so mock-mode dev/testing
// doesn't need a real Circle CLI session anywhere. ---
// /mock/search and /mock/inspect below let a developer run the entire demo
// with MOCK_CIRCLE=1 and zero real Circle credentials -- they just read back
// canned data from mock-data/services.json instead of shelling out to the
// real `circle` CLI.
app.get("/mock/search", (req, res) => {
  if (!MOCK_CIRCLE) return res.status(404).json({ error: "not in mock mode -- call the real circle CLI directly" });
  const keyword = String(req.query.keyword ?? "").toLowerCase();
  const results = mockServices.filter((s) => {
    const haystack = [
      s.metadata.description,
      s.metadata.provider.description,
      s.metadata.provider.name,
      ...s.metadata.provider.tags,
    ]
      .join(" ")
      .toLowerCase();
    return keyword === "" || haystack.includes(keyword);
  });
  res.json({ data: { services: results, pagination: { total: results.length } } });
});

app.get("/mock/inspect", (req, res) => {
  if (!MOCK_CIRCLE) return res.status(404).json({ error: "not in mock mode -- call the real circle CLI directly" });
  const serviceUrl = String(req.query.service_url ?? "");
  const match = mockServices.find((s) => s.resource === serviceUrl);
  if (!match) return res.status(404).json({ error: `no mock listing for ${serviceUrl}` });
  res.json({
    data: {
      status: "payable",
      method: match.metadata.method,
      amount_usdc: match.metadata.amount_usdc,
      accepts: match.accepts,
      metadata: match.metadata,
    },
  });
});

app.listen(PORT, () => {
  console.log(`payment-relay listening on :${PORT} (mock=${MOCK_CIRCLE})`);
});

// Exported for the real (non-mock) CLI wrappers, kept here so a future
// direct-import test doesn't need to spin up the HTTP server.
export { searchServicesViaCli, inspectServiceViaCli };
