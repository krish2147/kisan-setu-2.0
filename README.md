# KisanSetu AI — SIH 2026 Working Demo

## Live buyer transfer (Exotel Voicebot)

The final DTMF option `1` transfers the existing caller to the callable demo
buyer configured through `DEMO_BUYER_PHONE`. In the Exotel flow builder:

1. Put a **Connect** applet immediately after the **Voicebot** applet (or route
   Voicebot to a small transfer flow containing Connect).
2. In Connect, choose **Dial phone number(s) returned by URL**.
3. Set its Primary URL to your existing public ngrok base URL followed by
   `https://YOUR-NGROK-DOMAIN/exotel/connect-buyer`.
4. Route Connect's **We didn't dial anyone** path to a **Hangup** applet. This
   safely ends calls where the caller pressed `2` or no transfer was authorized.

For an optional endpoint token, set `EXOTEL_CONNECT_TOKEN` in `.env` and add the
same value as `?token=VALUE` to the Connect applet URL.

## Top-5 SMS delivery

The caller number is normalized from the Exotel WebSocket `start.from` or
`start.caller_number` field. If neither is present, KisanSetu uses the official
Call Details endpoint with the CallSid and reads `Call.From`. It never falls back
to a marketplace participant or `DEMO_BUYER_PHONE`.

Configure the server-only Exotel SMS variables listed in `.env.example`. Indian
traffic also needs an approved DLT Principal Entity ID, sender/header, and a
content-template ID whose registered text matches the generated message. Hindi,
Gujarati, Malayalam, and Kannada have native compact formatters; other detected
languages safely use the Hindi formatter and Hindi template.

Exotel's SMS endpoint returns `queued` when a request is accepted. The dashboard
records this as `SENT` (accepted by Exotel), not as proof of handset delivery.
Delivery confirmation would require an Exotel StatusCallback or a later SMS
Details lookup.

## Demo fallback mandi data

`data/mandi-fallback.json` contains fictional, deterministic SIH demonstration
prices. Every record is explicitly labelled `source: "Demo fallback"` and
`isFallback: true`; none of these values are live AGMARKNET or eNAM data.

All voicebot market access goes through `src/market-data.js`. It returns at most
three relevant results for voice output and may fill missing local results with
nearby demo mandis while preserving each mandi's actual district. A future
authorized live or cached provider can replace this source without changing the
Exotel/Sarvam conversation flow. The deterministic JSON can be rebuilt with:

```bash
node scripts/generate-mandi-fallback.js
```

## Fastest run
1. Install Node.js 22.5+ (the dashboard uses Node's built-in SQLite API).
2. Open Terminal in this folder.
3. Run:
   npm install
   npm start
4. Open:
   http://localhost:5000
5. Use Google Chrome and allow microphone access.

## Demo flow
### Farmer
Choose "Farmer / Seller" and say:
"Mere paas 500 kilo pyaaz hai, Vadodara mein 22 rupaye kilo bechna hai."

Click **Process with AI Layer**, verify the extracted fields, then click **Confirm & Create Listing**.

### Buyer
Choose "Buyer" and say:
"Mujhe Vadodara mein 300 kilo pyaaz chahiye."

Click **Process with AI Layer**, then **Confirm & Find Farmers**.
The matching engine ranks compatible farmer listings.

## What works without any API key
- Browser microphone speech recognition in Chrome
- Hindi/Hinglish natural-language demo flow
- Structured extraction of commodity, quantity, location and price
- Confirmation/edit step
- Persistent local JSON database
- Farmer listing creation
- Buyer requirement creation
- Buyer-to-farmer matching and scoring
- Judge-facing dashboard

## Google Cloud Speech-to-Text
The backend includes `/api/google-stt` using `@google-cloud/speech`.
To activate it, create a Google Cloud service account with Speech-to-Text access and set:

GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json

The zero-setup browser microphone mode is deliberately kept as a fallback so the Saturday demo does not fail because of credentials/network/API issues.

## Internal admin dashboard

Phase 1 stores genuine Exotel call activity in `data/kisansetu.sqlite` and serves
the internal monitoring dashboard at `http://localhost:5000/admin`.

For lightweight local protection, set `ADMIN_TOKEN` in `.env`. The dashboard
will prompt for it on first load. The value is kept in browser session storage
and is never embedded in the dashboard JavaScript.

## Demo marketplace matching

The fictional records in `data/demo-marketplace.json` seed ten BUY listings and
ten SELL listings for Tomato and Onion across Vadodara, Ahmedabad, Anand, and
Surat. They are demonstration data, not real companies or live offers.

Set the only callable demo buyer number in `.env` using E.164 format:

```text
DEMO_BUYER_PHONE=+91XXXXXXXXXX
```

SELL calls rank eligible buyers and BUY calls rank eligible sellers. The Top 5
are stored with the call. The deterministic score is price 40%, distance 30%,
quantity compatibility 20%, and verification 10%. Distance uses fixed demo-city
coordinates and Haversine calculation; no external map or mandi API is called.

At the final match menu, SELL callers may press `1` to use the existing buyer
handoff, `2` to end, or `3` to request the stored Top 5 by SMS. BUY callers may
press `2` to end or `3` to request their stored seller matches. Digit `3` creates
an idempotent `PENDING` request that references the exact persisted match rows;
it does not send an SMS. Provider delivery and status updates remain Phase 3.

## Important
Do not claim the current natural-language parser is a trained AI model. In this demo it is deterministic parsing, which is reliable for the prepared demo. The production architecture can replace that layer with an LLM/intent model while keeping the same API and database flow.
