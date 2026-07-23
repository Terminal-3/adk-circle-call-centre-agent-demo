// WHAT THIS FILE DOES: Exposes list_flagged_tickets (loop.ts) -- the tool
// the agent calls first to find out what it's supposed to be triaging today.
// Free/read-only, no Terminal 3 involvement.
//
// CUSTOMIZE: FLAGGED_TICKETS below is hardcoded demo data, not a real data
// source. If you're building your own scenario, replace this with a call
// into whatever your real ticket/task source is -- a CRM API, a ticketing
// system (Zendesk/Freshdesk/etc.), a database query, or similar.
//
// Free discovery tool, no money moves. Exists because the kickoff task
// ("keep an eye on flagged support tickets today...") deliberately doesn't
// say what those tickets are -- an operator giving that instruction wouldn't
// either, in reality. Same two tickets the dashboard's scripted replay
// narrates (dashboard/lib/replay-data.ts's #4821/#5390), so a live run and
// the deterministic demo replay tell the same story.
export interface FlaggedTicket {
  id: string;
  risk: "high" | "medium" | "low";
  summary: string;
}

const FLAGGED_TICKETS: FlaggedTicket[] = [
  {
    id: "#4821",
    risk: "high",
    summary: "Customer is requesting an urgent refund and an address change.",
  },
  {
    id: "#5390",
    risk: "high",
    summary: "A new account is requesting a large wire transfer to an unverified recipient.",
  },
];

export async function listFlaggedTickets(): Promise<FlaggedTicket[]> {
  return FLAGGED_TICKETS;
}
