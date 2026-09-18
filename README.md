# KisanSetu AI

An admin workspace for a voice-driven agricultural marketplace. Phone callers use
Exotel and Sarvam; administrators monitor calls and manage real buyer/seller listings.

## Run locally

Use Node.js 22.5 or newer, then:

```sh
npm install
npm start
```

Open **http://localhost:5000/admin** (or the port in `.env`). The root URL opens
the same admin dashboard. SQLite stores records in `data/kisansetu.sqlite`.
Keep this file and its backups; do not replace it to reset the UI.

## Admin workspace

- **Overview:** persisted call counts, transfer requests, historical match statistics,
  last seven days of calls (IST), detected languages, and live call monitoring.
- **Call activity:** search and filter the latest 500 calls; select a row to inspect
  saved transcripts, mandi results, ranked matches, SMS state and lifecycle events.
- **Marketplace:** add actual buyer requirements and seller supply, discover matches,
  and deactivate/reactivate listings. Listings persist in the same database used by
  phone-call matching. New participants are unverified. Phone is optional; callable
  participants need a valid international number.
- **Mandi prices:** retrieve official reported AGMARKNET prices, with source and date.
- **Connections:** configuration status. “Configured” does not mean a live provider
  request has been verified.

Sentence extraction uses the existing deterministic multilingual parser. Browser
microphone input depends on browser speech-recognition support and permission;
manual entry always remains available. It is separate from the Sarvam phone flow.

## Admin access

Set `ADMIN_TOKEN` in `.env` to protect the API, then restart. The dashboard prompts
for this token and keeps it only in browser session storage. Without a token,
admin APIs accept localhost access only. Set a token before accessing through a
tunnel or a remote host. Use HTTPS for remote access.

## Real data

Startup does **not** seed sample participants. Historical sample records remain
preserved, but are excluded from the marketplace and new phone-call matches.
Previous call statistics and stored match details retain their original history.
Complete buyer and seller phone requests now create marketplace listings automatically.
The actual caller number must be supplied by Exotel or resolved using its Call Details
API. Missing caller numbers or incomplete requests are recorded as skipped rather than
published under a made-up identity. Names and prices not collected remain blank.

Repeat calls for the same phone, trade side, crop and location update quantity rather
than adding duplicate listings. Administrator deactivation and known prices/names are
preserved. Listings captured by phone are marked in Marketplace and linked from call
details. A caller never matches with their own phone number.

To test without manual entry, call as a buyer from one phone, then call as a seller
from a different phone for the same commodity. Even if the first call finds no match,
its complete requirement is saved for the next caller. Existing historical calls are
not automatically backfilled.
Do not represent historical sample matches as completed trades.

`MANDI_ALLOW_DEMO_FALLBACK` defaults to false. Without an official API key or
available official records, the workspace reports unavailable prices. Keep fallback
disabled for real use. Existing fallback fixtures are retained only for explicit tests.

## Connected services

Set the relevant values from `.env.example` on the server:

| Service | Configuration | Verify |
| --- | --- | --- |
| Speech | `SARVAM_API_KEY` | An inbound call recognizes speech and returns audio |
| Telephony | `EXOTEL_ACCOUNT_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_SUBDOMAIN` | Exotel flow points to public `/voicebot` WebSocket |
| SMS | `FAST2SMS_API_KEY` | Provider acceptance and actual receipt on the caller's handset |
| Official prices | `DATA_GOV_IN_API_KEY`, optional `AGMARKNET_RESOURCE_ID` | Mandi lookup returns dated official records |

A transfer request is not a completed connection. An SMS marked “Provider accepted”
is not proof of handset delivery. No Anuvadini integration is implemented.

## Conversation languages

Speech capabilities come from `src/sarvam-capabilities.json`, a versioned snapshot
of Sarvam's model documentation (source URLs and verification date are included).
The default Saaras v3 entry accepts all 23 documented STT languages, including
three-letter codes. Bulbul v3 has a separate 11-language TTS entry. Existing
KisanSetu message bundles are preserved and checked independently of both.

`SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL`, and `SARVAM_TRANSLATION_MODEL` select model
entries from this manifest and the actual API requests use those same models.
To adopt a provider capability change, copy/update the manifest with verified
model entries and set `SARVAM_CAPABILITIES_FILE` to its path, then restart. There
is no live discovery or documentation scraping during calls, and no language
branches need adding. Unknown model capabilities fail validation at startup.
The configured TTS must support Hindi for the existing welcome/fallback.

STT codes are normalized against the selected model, independently of message
availability. Reliable speech establishes the session language once; later crop,
quantity, location, and acknowledgement fragments cannot change it. Short slot
values alone do not establish a language. Consistent STT fragments can supply
evidence together. Missing confidence is accepted for substantial speech with
valid metadata; low or malformed confidence is insufficient. Generic unique-script
recovery preserves the previous script fallback without guessing among languages
sharing a script or treating Latin transliteration as English.

When either the response bundle or TTS language is unavailable, the detected
language remains recorded and locked, responses use Hindi, and a one-time spoken
notice explains the fallback. The reason is stored separately in call metadata.

Native transcripts first use the existing crop/quantity/location parser. For
unresolved fields, `sarvam-translate:v1` can translate the utterance to English
using the same `SARVAM_API_KEY`; that result goes through the existing parser and
only fills missing fields. This request adds provider latency/cost (five-second
timeout) and requires translation access on the Sarvam account. It never changes
the conversation language or replaces already parsed values. Unavailable
translation, unknown crops/locations outside the parser's catalog, or failures
leave fields unresolved for the normal retry flow. Translation coverage is also
model capability data; STT support does not imply translation or response support.

Tests mock provider responses. Verify actual speech detection, translation quality,
audio output, and fallback notices with live Exotel/Sarvam calls before deployment.

## Buyer handoff

The existing caller-selected handoff authorizes a callable matched buyer for that
specific CallSid. Configure the Exotel Connect applet after Voicebot to fetch numbers
from the public `/exotel/connect-buyer` URL. If `EXOTEL_CONNECT_TOKEN` is set, pass the
same value as `?token=...`. Route the no-number path to Hangup. Never point the
handoff at a fixed sample number. `DEMO_BUYER_PHONE` is no longer used on startup.

The current final SELL menu maps `1` to authorized buyer handoff, `2` to mandi SMS,
and `3` to end. BUY menu behavior follows the existing translated call flow.

## Check before presenting

1. Open the admin dashboard and review Connections.
2. Call as a buyer to register demand, then call as a seller from a different phone.
3. Check View matches, then refresh to confirm persistence.
4. Place a real inbound call. Watch the live monitor and inspect its saved history.
5. Verify spoken responses, official prices when configured, handoff and SMS on the
   actual phones. Local automated checks cannot verify external account readiness.

## Tests

```sh
npm test
```

Tests cover parsing, language locking, call persistence, matching, CallSid handoff,
SMS idempotency, official-data behavior and admin listing validation/persistence.
Fixtures are kept separate from active marketplace records. To isolate runtime
storage, set `KISANSETU_DB_PATH` to a separate SQLite path.
