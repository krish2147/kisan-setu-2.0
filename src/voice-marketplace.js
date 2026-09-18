const { normalizeIndianPhoneNumber } = require('./sms');

function createVoiceMarketplaceService({ calls, marketplace, resolveCallerNumber, publish = () => {} }) {
  return async function registerCall(callSid, { isActive = () => true } = {}) {
    const record = (type, payload) => {
      calls.addEvent(callSid, type, payload);
      publish({ eventType: type, callSid });
    };
    try {
      let call = calls.getCallBySid(callSid);
      if (!call || !['BUY', 'SELL'].includes(call.intent) || !call.commodity || !call.location || !(call.quantity_kg > 0)) {
        return { status: 'SKIPPED', reason: 'INCOMPLETE_REQUIREMENT' };
      }
      let phone = normalizeIndianPhoneNumber(call.caller_number);
      if (!phone) {
        try { phone = normalizeIndianPhoneNumber(await resolveCallerNumber(callSid)); } catch { phone = null; }
      }
      if (!isActive()) return { status: 'SKIPPED', reason: 'CALL_ENDED' };
      if (phone) calls.updateCall(callSid, { callerNumber: phone });
      const registration = marketplace.registerVoiceCall(callSid);
      if (registration.status !== 'EXISTING') {
        record(registration.status === 'SKIPPED' ? 'MARKETPLACE_LISTING_SKIPPED' : 'MARKETPLACE_LISTING_SAVED', registration);
      }
      return { ...registration, callerNumber: phone };
    } catch {
      // Marketplace persistence must never terminate the voice conversation.
      try { record('MARKETPLACE_LISTING_FAILED', { reason: 'PERSISTENCE_ERROR' }); } catch { /* preserve voice path */ }
      return { status: 'FAILED', reason: 'PERSISTENCE_ERROR' };
    }
  };
}
module.exports = { createVoiceMarketplaceService };
