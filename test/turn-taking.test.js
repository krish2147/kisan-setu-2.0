const assert = require("node:assert/strict");
const test = require("node:test");

const { createTurnEndDebouncer, isDuplicateTurn, isStaleTurn, mergeTranscriptBuffer, transcriptRejectionReason } = require("../src/turn-taking");
const { TURN_END_GRACE_MS, accumulateTurnTranscript, createTurnBuffer, extractFarmerData } = require("../server");

test("cumulative STT updates replace rather than duplicate the current buffer", () => {
  const turn = createTurnBuffer({ intent: "SELL" });
  for (const text of ["मेरे पास", "मेरे पास पांच सौ", "मेरे पास पांच सौ किलो प्याज"]) {
    accumulateTurnTranscript(turn, text, "hi-IN", 0.9);
  }
  assert.equal(turn.transcriptBuffer, "मेरे पास पांच सौ किलो प्याज");
  assert.equal(turn.slots.commodity, "Onion");
  assert.equal(turn.slots.quantityKg, 500);
});

test("fragmented STT updates form one logical turn without losing slots", () => {
  const turn = createTurnBuffer({ intent: "SELL" });
  accumulateTurnTranscript(turn, "मेरे पास पांच सौ किलो", "hi-IN", 0.9);
  accumulateTurnTranscript(turn, "प्याज है वडोदरा में", "hi-IN", 0.9);
  assert.equal(turn.transcriptBuffer, "मेरे पास पांच सौ किलो प्याज है वडोदरा में");
  assert.deepEqual(turn.slots, { intent: "SELL", commodity: "Onion", quantityKg: 500, location: "Vadodara" });
});

test("short-pause restart cancels grace while genuine end finalizes exactly once", () => {
  let callback = null;
  let finalized = 0;
  const cleared = [];
  const debounce = createTurnEndDebouncer({
    graceMs: TURN_END_GRACE_MS,
    onFinalize: () => { finalized += 1; },
    setTimer(fn, ms) { assert.equal(ms, 800); callback = fn; return 7; },
    clearTimer(id) { cleared.push(id); callback = null; }
  });
  debounce.start();
  debounce.cancel();
  assert.deepEqual(cleared, [7]);
  assert.equal(finalized, 0);
  debounce.start();
  callback();
  assert.equal(finalized, 1);
  assert.equal(debounce.pending, false);
});

test("duplicate suppression is limited to the same stage and recent window", () => {
  const base = { transcript: "500 किलो प्याज", stageId: 3, lastTranscript: "500 किलो प्याज", lastStageId: 3, lastProcessedAt: 1000, windowMs: 1500 };
  assert.equal(isDuplicateTurn({ ...base, now: 2000 }), true);
  assert.equal(isDuplicateTurn({ ...base, stageId: 4, now: 2000 }), false);
  assert.equal(isDuplicateTurn({ ...base, now: 3000 }), false);
});

test("turns captured in an earlier stage are rejected as stale", () => {
  assert.equal(isStaleTurn({ stage: "WAITING_FOR_CROP", stageId: 2 }, { stage: "WAITING_FOR_LOCATION", currentStageId: 3 }), true);
  assert.equal(isStaleTurn({ stage: "WAITING_FOR_CROP", stageId: 2 }, { stage: "WAITING_FOR_CROP", currentStageId: 2 }), false);
});

test("bot speech, processing, DTMF-only states, and stale residue reject transcripts", () => {
  const open = { listeningOpen: true, botSpeaking: false, processingTurn: false, requiresFreshSpeechStart: false };
  assert.equal(transcriptRejectionReason(open), null);
  assert.equal(transcriptRejectionReason({ ...open, botSpeaking: true }), "bot_speaking");
  assert.equal(transcriptRejectionReason({ ...open, processingTurn: true }), "turn_processing");
  assert.equal(transcriptRejectionReason({ ...open, listeningOpen: false }), "listening_closed");
  assert.equal(transcriptRejectionReason({ ...open, requiresFreshSpeechStart: true }), "fresh_speech_required");
});

test("rapid full sentence retains crop quantity location and intent once", () => {
  const text = "मेरे पास पांच सौ किलो प्याज है वडोदरा में और मुझे इसे बेचना है";
  const turn = createTurnBuffer({ intent: "SELL" });
  assert.equal(accumulateTurnTranscript(turn, text, "hi-IN", 0.95), true);
  assert.equal(accumulateTurnTranscript(turn, text, "hi-IN", 0.95), false);
  assert.deepEqual(extractFarmerData(turn.transcriptBuffer), { intent: "SELL", commodity: "Onion", quantityKg: 500, location: "Vadodara" });
});

test("overlapping transcript fragments merge without repeated words", () => {
  assert.equal(mergeTranscriptBuffer("मेरे पास पांच सौ किलो", "पांच सौ किलो प्याज है"), "मेरे पास पांच सौ किलो प्याज है");
});

test("Kisan then Setu across a short pause remains one logical turn", () => {
  const turn = createTurnBuffer();
  accumulateTurnTranscript(turn, "Kisan", "en-IN", 0.9);
  accumulateTurnTranscript(turn, "Kisan Setu", "en-IN", 0.9);
  assert.equal(turn.transcriptBuffer, "Kisan Setu");
});

test("long Hindi utterance continues across a short pause without duplication", () => {
  const turn = createTurnBuffer({ intent: "SELL" });
  accumulateTurnTranscript(turn, "मेरे पास पांच सौ किलो", "hi-IN", 0.9);
  accumulateTurnTranscript(turn, "प्याज है अहमदाबाद में", "hi-IN", 0.9);
  assert.equal(turn.transcriptBuffer, "मेरे पास पांच सौ किलो प्याज है अहमदाबाद में");
  assert.deepEqual(turn.slots, { intent: "SELL", commodity: "Onion", quantityKg: 500, location: "Ahmedabad" });
});
