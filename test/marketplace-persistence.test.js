const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");

const { createAdminEvents } = require("../src/admin-events");
const { mountAdminApi } = require("../src/admin-api");
const { createCallRepository } = require("../src/call-repository");
const { openDatabase } = require("../src/db");
const { createMarketplaceRepository } = require("../src/marketplace-repository");
const { rankMatches, selectCallableMatch } = require("../src/matching");

function fixture(phone = "+12025550123") {
  const db = openDatabase(":memory:");
  const calls = createCallRepository(db);
  const marketplace = createMarketplaceRepository(db);
  marketplace.seedDemoMarketplace({ demoBuyerPhone: phone });
  return { db, calls, marketplace };
}

test("demo seed supports SELL Tomato Vadodara and BUY Onion Vadodara Top-5 scenarios", t => {
  const { db, marketplace } = fixture();
  t.after(() => db.close());
  const buyers = marketplace.getEligibleListings("BUY", "Tomato");
  const sellMatches = rankMatches({ intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" }, buyers);
  assert.equal(sellMatches.length, 5);
  assert.equal(sellMatches[0].name, "Demo Tomato Buyer A");
  assert.equal(selectCallableMatch(sellMatches).name, "Demo Tomato Buyer A");

  const sellers = marketplace.getEligibleListings("SELL", "Onion");
  const buyMatches = rankMatches({ intent: "BUY", commodity: "Onion", quantityKg: 500, location: "Vadodara" }, sellers);
  assert.equal(buyMatches.length, 5);
  assert.ok(buyMatches.every(match => match.participantType === "SELLER"));
});

test("Top-5 match persistence preserves ranks, recommendation, breakdown, and reason", t => {
  const { db, calls, marketplace } = fixture();
  t.after(() => db.close());
  const call = calls.createCall({ callSid: "CA-marketplace-persist" });
  const matches = rankMatches(
    { intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" },
    marketplace.getEligibleListings("BUY", "Tomato")
  );
  calls.replaceCallMatches("CA-marketplace-persist", matches);
  calls.addEvent("CA-marketplace-persist", "MATCHES_GENERATED", { count: matches.length });
  const detail = calls.getCallDetail(call.id);
  assert.equal(detail.matches.length, 5);
  assert.equal(detail.matches[0].rank, 1);
  assert.equal(detail.matches[0].is_recommended, 1);
  assert.ok(detail.matches[0].price_score <= 40);
  assert.ok(detail.matches[0].distance_score <= 30);
  assert.ok(detail.matches[0].quantity_score <= 20);
  assert.ok(detail.matches[0].reason.startsWith("Best overall match:"));
});

test("admin call detail endpoint returns stored matches instead of recalculating", t => {
  const { db, calls, marketplace } = fixture();
  t.after(() => db.close());
  const call = calls.createCall({ callSid: "CA-admin-matches" });
  const matches = rankMatches(
    { intent: "BUY", commodity: "Onion", quantityKg: 500, location: "Vadodara" },
    marketplace.getEligibleListings("SELL", "Onion")
  );
  calls.replaceCallMatches("CA-admin-matches", matches);
  const app = express();
  mountAdminApi(app, calls, createAdminEvents());
  const route = app._router.stack.find(layer => layer.route?.path === "/api/admin/calls/:id");
  let responseBody;
  route.route.stack[0].handle({ params: { id: String(call.id) } }, {
    json(value) { responseBody = value; },
    status() { return this; }
  });
  assert.equal(responseBody.matches.length, 5);
  assert.equal(responseBody.matches[0].participant_type, "SELLER");
});

test("match analytics count persisted results and genuine no-match attempts", t => {
  const { db, calls, marketplace } = fixture();
  t.after(() => db.close());
  calls.createCall({ callSid: "CA-analytics-matched" });
  const matches = rankMatches(
    { intent: "SELL", commodity: "Tomato", quantityKg: 500, location: "Vadodara" },
    marketplace.getEligibleListings("BUY", "Tomato")
  );
  calls.replaceCallMatches("CA-analytics-matched", matches);
  calls.addEvent("CA-analytics-matched", "MATCHES_GENERATED", { count: matches.length });
  calls.createCall({ callSid: "CA-analytics-empty" });
  calls.replaceCallMatches("CA-analytics-empty", []);
  calls.addEvent("CA-analytics-empty", "MATCHES_GENERATED", { count: 0 });
  const summary = calls.getSummary();
  assert.equal(summary.matches_generated, 5);
  assert.equal(summary.average_matches_per_request, 2.5);
  assert.equal(summary.requests_with_no_match, 1);
});
