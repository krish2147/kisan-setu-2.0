const elements = Object.fromEntries([
  "connectionStatus", "totalCalls", "sellRequests", "buyRequests", "buyerConnections", "activeCalls",
  "matchesGenerated", "averageMatches", "noMatchRequests",
  "refreshButton", "liveBadge", "noLiveCall", "liveContent", "liveCallId", "liveLanguage", "liveIntent",
  "liveCrop", "liveQuantity", "liveLocation", "liveBuyerConnect", "liveSmsRequested", "liveSmsStatus",
  "liveSmsRecipient", "liveSmsLanguage", "liveSmsType", "liveSmsRequestedAt", "liveSmsSentAt",
  "liveStage", "aiSteps", "liveMatches", "liveMatchCount",
  "recommendedMatch", "liveMatchesBody", "callsBody", "noCalls", "detailDialog", "detailTitle",
  "detailMeta", "detailTranscripts", "detailMandi", "detailMandiCount", "detailMatches", "detailEvents", "closeDialog"
].map(id => [id, document.getElementById(id)]));

const languageNames = {
  "hi-IN": "Hindi", "gu-IN": "Gujarati", "mr-IN": "Marathi", "pa-IN": "Punjabi",
  "bn-IN": "Bengali", "ta-IN": "Tamil", "te-IN": "Telugu", "kn-IN": "Kannada",
  "ml-IN": "Malayalam", "or-IN": "Odia"
};

let calls = [];
let adminToken = new URLSearchParams(location.search).get("token") || sessionStorage.getItem("kisansetuAdminToken") || "";
if (adminToken) sessionStorage.setItem("kisansetuAdminToken", adminToken);

function authHeaders() {
  return adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
}

let authentication;
function requestAuthentication() {
  if (authentication) return authentication;
  authentication = new Promise(resolve => {
    const dialog = document.getElementById("authDialog");
    dialog.showModal();
    dialog.oncancel = event => event.preventDefault();
    document.getElementById("authForm").onsubmit = async event => {
      event.preventDefault();
      const token = document.getElementById("accessToken").value.trim();
      const button = event.target.querySelector("button"); button.disabled = true;
      try {
        const response = await fetch('/api/admin/summary', { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(response.status === 401 ? "That token was not accepted." : "Unable to connect. Please retry.");
        adminToken = token;
        sessionStorage.setItem("kisansetuAdminToken", token);
        document.getElementById("accessToken").value = "";
        dialog.close(); authentication = null; resolve();
      } catch (error) { document.getElementById("authError").textContent = error.message; }
      finally { button.disabled = false; }
    };
  });
  return authentication;
}
if (new URLSearchParams(location.search).has("token")) history.replaceState(null, "", location.pathname + location.hash);
async function api(path, options = {}) {
  const send = () => fetch(path, { ...options, headers: { ...authHeaders(), ...options.headers }, signal: AbortSignal.timeout(30000) });
  let response = await send();
  if (response.status === 401) { await requestAuthentication(); response = await send(); }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return response.json();
}

function display(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatMandiPrice(value) {
  return value === null || value === undefined ? "—" : `₹${new Intl.NumberFormat("en-IN").format(value)}/qtl`;
}

function officialMandiStatus(item) {
  if (item.is_fallback) return "DEMO / FALLBACK";
  if (!item.observed_at) return "OFFICIAL / LATEST";
  const observed = new Date(`${item.observed_at}T00:00:00Z`);
  const today = new Date();
  const ageDays = Math.max(0, Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - observed.getTime()) / 86400000));
  return ageDays === 0 ? "LIVE / OFFICIAL" : `OFFICIAL / LATEST · ${ageDays}d old`;
}

function smsStatusLabel(status) {
  if (status === "SENT") return "Provider accepted";
  if (status === "FAILED") return "SMS Failed";
  if (status === "BLOCKED_CONFIGURATION") return "Blocked: Configuration";
  return status;
}

function setText(id, value) {
  elements[id].textContent = display(value);
}

function renderSummary(summary) {
  setText("totalCalls", summary.total_calls || 0);
  setText("sellRequests", summary.sell_requests || 0);
  setText("buyRequests", summary.buy_requests || 0);
  setText("buyerConnections", summary.buyer_connections || 0);
  setText("activeCalls", summary.active_calls || 0);
  setText("matchesGenerated", summary.matches_generated || 0);
  setText("averageMatches", summary.average_matches_per_request || 0);
  setText("noMatchRequests", summary.requests_with_no_match || 0);
}

function aiState(call) {
  const stages = new Set((call.events || []).map(event => event.event_type));
  return [
    ["Speech Detected", (call.transcripts || []).length > 0],
    ["Language Detected", stages.has("LANGUAGE_DETECTED")],
    ["Crop Extracted", Boolean(call.commodity)],
    ["Quantity Extracted", call.quantity_kg !== null],
    ["Location Extracted", Boolean(call.location)],
    ["Mandi Rates Retrieved", stages.has("MANDI_RESULTS_READY")],
    ["Marketplace Matches Generated", stages.has("MATCHES_GENERATED")],
    ["Buyer Connect Requested", Boolean(call.buyer_connection_requested)],
    ["Top-5 SMS Requested", Boolean(call.sms_requested)]
  ];
}

function matchDistance(match) {
  return match.distance_km === null ? "Unknown" : `${match.distance_km} km`;
}

function matchPrice(match) {
  return match.price_per_kg === null ? "Not provided" : `₹${match.price_per_kg}/kg`;
}

function matchQuantity(match) {
  return `${match.matched_quantity_kg} / ${match.quantity_kg} kg`;
}

function labelledValue(label, value) {
  const box = document.createElement("div");
  const name = document.createElement("span"); name.textContent = label;
  const content = document.createElement("strong"); content.textContent = display(value);
  box.append(name, content);
  return box;
}

function renderLiveMatches(call) {
  const matches = call.matches || [];
  const matchingFinished = (call.events || []).some(event => event.event_type === "MATCHES_GENERATED");
  elements.liveMatches.classList.toggle("hidden", !matchingFinished);
  if (!matchingFinished) return;
  elements.liveMatchCount.textContent = `Matches Found: ${matches.length}`;
  elements.recommendedMatch.classList.toggle("hidden", !matches.length);
  elements.liveMatchesBody.replaceChildren();
  if (!matches.length) return;

  const recommended = matches.find(match => match.is_recommended) || matches[0];
  const label = document.createElement("div"); label.className = "star-label"; label.textContent = "⭐ RECOMMENDED MATCH";
  const heading = document.createElement("h3"); heading.textContent = recommended.name || "Name not provided";
  const grid = document.createElement("div"); grid.className = "recommended-grid";
  grid.append(
    labelledValue("Type", recommended.participant_type),
    labelledValue("Location", recommended.location),
    labelledValue("Distance", matchDistance(recommended)),
    labelledValue("Matched Quantity", `${recommended.matched_quantity_kg} kg`),
    labelledValue("Price", matchPrice(recommended)),
    labelledValue("Verified", recommended.verified ? "Yes" : "No"),
    labelledValue("Score", `${recommended.score}%`)
  );
  const reason = document.createElement("p"); reason.className = "recommendation-reason"; reason.textContent = recommended.reason;
  elements.recommendedMatch.replaceChildren(label, heading, grid, reason);

  for (const match of matches) {
    const row = document.createElement("tr");
    cell(row, `${match.rank}${match.is_recommended ? " ⭐" : ""}`, match.is_recommended ? "match-star" : "");
    cell(row, match.name || "Name not provided");
    cell(row, match.participant_type);
    cell(row, match.location);
    cell(row, matchDistance(match));
    cell(row, matchQuantity(match));
    cell(row, matchPrice(match));
    cell(row, match.verified ? "Verified" : "Unverified");
    cell(row, `${match.score}%`);
    elements.liveMatchesBody.appendChild(row);
  }
}

function renderLive(call) {
  const hasCall = Boolean(call);
  elements.noLiveCall.classList.toggle("hidden", hasCall);
  elements.liveContent.classList.toggle("hidden", !hasCall);
  if (!hasCall) elements.liveMatches.classList.add("hidden");
  elements.liveBadge.textContent = hasCall ? "LIVE" : "IDLE";
  elements.liveBadge.className = `badge ${hasCall ? "live" : "idle"}`;
  if (!hasCall) return;
  setText("liveCallId", call.call_sid);
  setText("liveLanguage", languageNames[call.language] || call.language);
  setText("liveIntent", call.intent);
  setText("liveCrop", call.commodity);
  setText("liveQuantity", call.quantity_kg === null ? null : `${call.quantity_kg} kg`);
  setText("liveLocation", call.location);
  setText("liveBuyerConnect", call.buyer_connection_requested ? "Yes" : "No");
  setText("liveSmsRequested", call.sms_requested ? "Yes" : "No");
  setText("liveSmsStatus", smsStatusLabel(call.sms_status));
  setText("liveSmsRecipient", call.sms_delivery?.recipient_masked);
  setText("liveSmsLanguage", languageNames[call.sms_delivery?.language] || call.sms_delivery?.language);
  setText("liveSmsType", call.sms_delivery?.message_type === "TOP5_BUYERS" ? "Top 5 Buyers" :
    call.sms_delivery?.message_type === "TOP5_SELLERS" ? "Top 5 Sellers" : null);
  setText("liveSmsRequestedAt", formatTime(call.sms_delivery?.requested_at || call.sms_requested_at));
  setText("liveSmsSentAt", formatTime(call.sms_delivery?.sent_at));
  setText("liveStage", call.current_stage);
  elements.aiSteps.replaceChildren(...aiState(call).map(([label, done]) => {
    const step = document.createElement("div");
    step.className = `ai-step${done ? " done" : ""}`;
    step.textContent = label;
    return step;
  }));
  renderLiveMatches(call);
}

function cell(row, text, className = "") {
  const td = document.createElement("td");
  td.textContent = display(text);
  if (className) td.className = className;
  row.appendChild(td);
}

function renderCalls() {
  elements.callsBody.replaceChildren();
  elements.noCalls.classList.toggle("hidden", calls.length > 0);
  const query = document.getElementById("callSearch").value.trim().toLowerCase();
  const filter = document.getElementById("callFilter").value;
  const visibleCalls = calls.filter(call => (filter === "ALL" || call.intent === filter || call.status === filter)
    && [call.call_sid, call.commodity, call.location, languageNames[call.language], call.status].some(value => String(value || "").toLowerCase().includes(query)));
  document.getElementById("callCount").textContent = `${visibleCalls.length} of ${calls.length} recent calls`;
  elements.noCalls.classList.toggle("hidden", visibleCalls.length > 0);
  elements.noCalls.textContent = calls.length ? "No conversations match these filters." : "No conversations yet. Your first incoming call will appear here.";
  for (const call of visibleCalls) {
    const row = document.createElement("tr");
    row.addEventListener("click", () => openCall(call.id));
    row.tabIndex = 0; row.setAttribute("role", "button"); row.setAttribute("aria-label", `Inspect call ${call.call_sid}`);
    row.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); openCall(call.id); } });
    cell(row, formatTime(call.started_at));
    cell(row, call.call_sid, "mono");
    cell(row, languageNames[call.language] || call.language);
    cell(row, call.intent);
    cell(row, call.commodity);
    cell(row, call.quantity_kg === null ? null : `${call.quantity_kg} kg`);
    cell(row, call.location);
    const statusCell = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `status-pill${call.ended_at ? "" : " active"}`;
    pill.textContent = call.status;
    statusCell.appendChild(pill);
    row.appendChild(statusCell);
    cell(row, call.buyer_connection_requested ? "Requested" : "—", call.buyer_connection_requested ? "connect-yes" : "");
    cell(row, call.sms_requested ? "Yes" : "No", call.sms_requested ? "connect-yes" : "");
    cell(row, smsStatusLabel(call.sms_status));
    elements.callsBody.appendChild(row);
  }
}

function emptyMessage(text) {
  const item = document.createElement("div");
  item.className = "timeline-item";
  item.textContent = text;
  return item;
}

async function openCall(id) {
  try {
    const call = await api(`/api/admin/calls/${id}`);
    elements.detailTitle.textContent = call.call_sid;
    const meta = [
      ["Marketplace listing", call.marketplace_listing ? `#${call.marketplace_listing.id} · ${call.marketplace_listing.active ? "Active" : "Inactive"}` : "Not registered"],
      ["Status", call.status], ["Intent", call.intent], ["Language", languageNames[call.language] || call.language],
      ["Duration", call.duration_seconds === null ? null : `${call.duration_seconds}s`], ["Crop", call.commodity],
      ["Quantity", call.quantity_kg === null ? null : `${call.quantity_kg} kg`], ["Location", call.location],
      ["Buyer Connect", call.buyer_connection_requested ? "Yes" : "No"],
      ["Top-5 SMS Requested", call.sms_requested ? "Yes" : "No"],
      ["SMS Recipient", call.sms_delivery?.recipient_masked],
      ["SMS Language", languageNames[call.sms_delivery?.language] || call.sms_delivery?.language],
      ["SMS Type", call.sms_delivery?.message_type === "TOP5_BUYERS" ? "Top 5 Buyers" :
        call.sms_delivery?.message_type === "TOP5_SELLERS" ? "Top 5 Sellers" : null],
      ["SMS Status", smsStatusLabel(call.sms_status)],
      ["SMS Requested At", formatTime(call.sms_delivery?.requested_at || call.sms_requested_at)],
      ["SMS Sent At", formatTime(call.sms_delivery?.sent_at)],
      ["SMS Failure", call.sms_delivery?.error_message], ["Stage", call.current_stage]
    ];
    elements.detailMeta.replaceChildren(...meta.map(([label, value]) => {
      const box = document.createElement("div");
      const name = document.createElement("span"); name.textContent = label;
      const content = document.createElement("strong"); content.textContent = display(value);
      box.append(name, content); return box;
    }));
    elements.detailTranscripts.replaceChildren(...(call.transcripts.length ? call.transcripts.map(item => {
      const node = document.createElement("div"); node.className = "timeline-item";
      const text = document.createElement("div"); text.textContent = item.text;
      const time = document.createElement("time"); time.textContent = `${languageNames[item.language] || display(item.language)} · ${formatTime(item.timestamp)}`;
      node.append(text, time); return node;
    }) : [emptyMessage("No finalized transcript turns were stored.")]));
    elements.detailMandiCount.textContent = `${call.mandi_results.length} market${call.mandi_results.length === 1 ? "" : "s"} found`;
    if (call.mandi_results.length) {
      elements.detailMandi.replaceChildren(...call.mandi_results.map(item => {
        const row = document.createElement("tr");
        cell(row, item.commodity);
        cell(row, item.mandi);
        cell(row, item.district || item.location);
        cell(row, formatMandiPrice(item.min_price));
        cell(row, formatMandiPrice(item.modal_price), "modal-price");
        cell(row, formatMandiPrice(item.max_price));
        cell(row, item.observed_at);
        cell(row, item.source);
        const status = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = item.is_fallback ? "fallback-badge" : "source-badge";
        badge.textContent = officialMandiStatus(item);
        status.appendChild(badge);
        row.appendChild(status);
        return row;
      }));
    } else {
      const row = document.createElement("tr");
      const message = document.createElement("td");
      message.colSpan = 9;
      message.className = "table-empty";
      message.textContent = "No mandi results stored for this call.";
      row.appendChild(message);
      elements.detailMandi.replaceChildren(row);
    }
    elements.detailMatches.replaceChildren(...(call.matches.length ? call.matches.map(match => {
      const node = document.createElement("article");
      node.className = `detail-match${match.is_recommended ? " recommended" : ""}`;
      const head = document.createElement("div"); head.className = "detail-match-head";
      const name = document.createElement("strong"); name.textContent = `${match.rank}. ${match.is_recommended ? "⭐ " : ""}${match.name || "Name not provided"}`;
      const total = document.createElement("span"); total.textContent = `${match.score}/100`;
      head.append(name, total);
      const breakdown = document.createElement("div"); breakdown.className = "score-breakdown";
      breakdown.append(
        labelledValue("Price", `${match.price_score}/40`),
        labelledValue("Distance", `${match.distance_score}/30`),
        labelledValue("Quantity", `${match.quantity_score}/20`),
        labelledValue("Verification", `${match.verification_score}/10`),
        labelledValue("Total", `${match.score}/100`)
      );
      const reason = document.createElement("div"); reason.className = "detail-reason"; reason.textContent = match.reason;
      node.append(head, breakdown, reason);
      return node;
    }) : [emptyMessage("No marketplace matches were stored for this call.")]));
    elements.detailEvents.replaceChildren(...(call.events.length ? call.events.map(item => {
      const node = document.createElement("div"); node.className = "timeline-item";
      const name = document.createElement("div"); name.className = "event-name"; name.textContent = item.event_type;
      const time = document.createElement("time"); time.textContent = formatTime(item.created_at);
      node.append(name, time); return node;
    }) : [emptyMessage("No lifecycle events stored.")]));
    elements.detailDialog.showModal();
  } catch (error) {
    setConnection(false, error.message);
  }
}

function setConnection(online, label = online ? "Live updates on" : "Disconnected") {
  elements.connectionStatus.className = `connection ${online ? "online" : "offline"}`;
  elements.connectionStatus.querySelector("span").textContent = label;
}

let refreshPending = false;
async function refresh() {
  if (refreshPending) return;
  refreshPending = true; elements.refreshButton.disabled = true;
  try {
    const [summary, response] = await Promise.all([api("/api/admin/summary"), api("/api/admin/calls?limit=500")]);
    calls = response.calls || [];
    renderSummary(summary); renderCalls();
    const active = calls.find(call => !call.ended_at);
    renderLive(active ? await api(`/api/admin/calls/${active.id}`) : null);
    if (window.refreshWorkspace) await window.refreshWorkspace();
    document.getElementById("updatedAt").textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    document.getElementById("errorBanner").classList.add("hidden");
  } catch (error) {
    setConnection(false, "Update failed");
    const banner = document.getElementById("errorBanner");
    banner.textContent = `Unable to refresh: ${error.message} Previously loaded data may be out of date. Use Refresh to retry.`;
    banner.classList.remove("hidden");
  } finally { refreshPending = false; elements.refreshButton.disabled = false; }
}
let liveSource;
function connectLive() {
  liveSource?.close();
  const query = adminToken ? `?token=${encodeURIComponent(adminToken)}` : "";
  liveSource = new EventSource(`/api/admin/live${query}`);
  liveSource.addEventListener("ready", () => { setConnection(true); refresh(); });
  liveSource.addEventListener("call-update", () => refresh());
  liveSource.onerror = () => setConnection(false, "Reconnecting…");
}
elements.refreshButton.addEventListener("click", () => { refresh(); connectLive(); });
document.getElementById("callSearch").addEventListener("input", renderCalls);
document.getElementById("callFilter").addEventListener("change", renderCalls);
elements.closeDialog.addEventListener("click", () => elements.detailDialog.close());
elements.detailDialog.addEventListener("click", event => {
  const bounds = elements.detailDialog.getBoundingClientRect();
  if (event.target === elements.detailDialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) elements.detailDialog.close();
});
window.addEventListener("pagehide", () => liveSource?.close());
window.addEventListener("pageshow", event => { if (event.persisted) { refresh(); connectLive(); } });
setInterval(() => { if (!document.hidden) refresh(); }, 30000);
refresh().then(connectLive);
