// WHAT: A one-line pointer/launcher -- tells you the actual command to start
// the payment relay in mock mode for local dev.
// WHEN: Whenever you want to run the full setup -> grant -> invoke -> revoke
// loop locally without a real Circle CLI session.
// RUN: npm run mock-relay --workspace scripts
// (this just prints the real command below and exits -- mock mode itself
// lives in services/payment-relay, not in this script)
//
// Convenience launcher: starts services/payment-relay in mock mode for local
// dev, so the full setup -> grant -> invoke -> revoke loop is testable without
// a real Circle CLI session anywhere. Equivalent to:
//   MOCK_CIRCLE=1 npm run start --workspace services/payment-relay
console.log("Use: MOCK_CIRCLE=1 npm run start --workspace services/payment-relay");
console.log("(mock mode lives in the relay itself, not a separate script -- see services/payment-relay/src/server.ts)");
