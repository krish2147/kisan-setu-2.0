const assert = require("node:assert/strict");
const test = require("node:test");

const {
  authorizeCallableBuyerConnection,
  resolveBuyerConnection
} = require("../server");

test("Press 1 authorization uses the highest-ranked callable buyer", () => {
  const callSid = "CA-callable-marketplace-match";
  const selected = authorizeCallableBuyerConnection(callSid, [
    { rank: 1, name: "True Recommendation", phone: null },
    { rank: 2, name: "Callable Demo Buyer", phone: "+12025550123" },
    { rank: 3, name: "Later Callable Buyer", phone: "+12025550124" }
  ], 1000);
  assert.equal(selected.rank, 2);
  assert.equal(resolveBuyerConnection(callSid, 2000), "+12025550123");
});
