function normalizeForMerge(text) {
  return String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function mergeTranscriptBuffer(currentText, incomingText) {
  const current = String(currentText || "").trim().replace(/\s+/g, " ");
  const incoming = String(incomingText || "").trim().replace(/\s+/g, " ");
  if (!current) return incoming;
  if (!incoming) return current;

  const currentNormalized = normalizeForMerge(current);
  const incomingNormalized = normalizeForMerge(incoming);
  if (currentNormalized === incomingNormalized || currentNormalized.startsWith(incomingNormalized)) return current;
  if (incomingNormalized.startsWith(currentNormalized)) return incoming;

  const currentWords = current.split(" ");
  const incomingWords = incoming.split(" ");
  const maximumOverlap = Math.min(currentWords.length, incomingWords.length);
  for (let overlap = maximumOverlap; overlap > 0; overlap -= 1) {
    const suffix = normalizeForMerge(currentWords.slice(-overlap).join(" "));
    const prefix = normalizeForMerge(incomingWords.slice(0, overlap).join(" "));
    if (suffix === prefix) return [...currentWords, ...incomingWords.slice(overlap)].join(" ");
  }
  return `${current} ${incoming}`;
}

function isDuplicateTurn({ transcript, stageId, lastTranscript, lastStageId, lastProcessedAt, now = Date.now(), windowMs }) {
  return Boolean(transcript) && transcript === lastTranscript && stageId === lastStageId &&
    now - lastProcessedAt < windowMs;
}

function isStaleTurn(turn, session) {
  return turn.stage !== session.stage || turn.stageId !== session.currentStageId;
}

function transcriptRejectionReason({ listeningOpen, botSpeaking, processingTurn, requiresFreshSpeechStart }) {
  if (!listeningOpen) return "listening_closed";
  if (botSpeaking) return "bot_speaking";
  if (processingTurn) return "turn_processing";
  if (requiresFreshSpeechStart) return "fresh_speech_required";
  return null;
}

function createTurnEndDebouncer({ graceMs, onFinalize, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  return {
    start() {
      if (timer) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        onFinalize();
      }, graceMs);
    },
    cancel() {
      if (timer) clearTimer(timer);
      timer = null;
    },
    get pending() { return timer !== null; }
  };
}

module.exports = {
  createTurnEndDebouncer,
  isDuplicateTurn,
  isStaleTurn,
  mergeTranscriptBuffer,
  transcriptRejectionReason
};
