# Stripe Crypto Onramp — sample app

Sample integration for [Stripe’s fiat-to-crypto Onramp](https://docs.stripe.com/crypto/onramp): merchant locks wallet / asset / network in `.env`, creates a session, opens hosted `redirect_url` in a new tab so the customer mainly pays with a card.

```
Browser                    Your server                 Stripe
───────                    ───────────                 ──────
form submit ──POST /api/onramp/session──►
                              │
                              ├── POST /v1/crypto/onramp_sessions
                              │◄── redirect_url
◄── redirect_url ─────────────┘
open redirect_url in new tab ──────────────────────────►
customer KYC + pay on crypto.link.com ─────────────────►
                              ◄── webhook: crypto.onramp_session.updated
```

## Prerequisites

1. A Stripe account with **Onramp access** (required even for sandbox). [Submit an application](https://docs.stripe.com/crypto/onramp#submit-your-application).
2. Node.js 18+
3. Publishable + secret API keys from the Stripe Dashboard

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:4242](http://localhost:4242).

### `.env`

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Server-side session creation |
| `STRIPE_PUBLISHABLE_KEY` | Optional (not required for hosted redirect) |
| `STRIPE_WEBHOOK_SECRET` | Verify `crypto.onramp_session.updated` |
| `ONRAMP_WALLET_ADDRESS` | Your settlement wallet (locked) |
| `ONRAMP_DESTINATION_CURRENCY` | e.g. `usdc` (locked) |
| `ONRAMP_DESTINATION_NETWORK` | e.g. `ethereum` (locked) |
| `PORT` | Default `4242` |

## What this sample shows

| Piece | Path |
| --- | --- |
| Create session | `POST /api/onramp/session` → `server/onramp.js` |
| Retrieve session | `GET /api/onramp/session/:id` |
| Open hosted checkout | `public/app.js` opens `redirect_url` in a new tab |
| Webhooks | `POST /api/webhooks/stripe` → `server/webhooks.js` |

### Session body (frontend → your API)

```json
{
  "source_amount": "50",
  "source_currency": "usd",
  "destination_currency": "usdc",
  "destination_network": "ethereum",
  "wallet_address": "0x…",
  "lock_wallet_address": true
}
```

Your server maps this to Stripe’s `POST /v1/crypto/onramp_sessions` and returns `redirectUrl` (plus `sessionId` / `status`). The browser opens that URL in a new tab — no iframe / embedded SDK.

```js
const { redirectUrl } = await createSession(...);
window.open(redirectUrl, "_blank", "noopener,noreferrer");
```

## Webhooks

1. In Stripe Dashboard → Developers → Webhooks, add  
   `https://<your-host>/api/webhooks/stripe`
2. Subscribe to **`crypto.onramp_session.updated`**
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`

Local forwarding with the Stripe CLI:

```bash
stripe listen --forward-to localhost:4242/api/webhooks/stripe
```

### Session statuses

| Status | Meaning |
| --- | --- |
| `initialized` | Session minted, customer hasn’t finished onboarding |
| `requires_payment` | Ready / retrying payment |
| `fulfillment_processing` | Paid; crypto delivery in progress |
| `fulfillment_complete` | Crypto delivered (use this to fulfill in your product) |
| `rejected` | KYC / sanctions / fraud rejection |

## Integration options

This sample uses the **Stripe-hosted** onramp (`redirect_url` → `crypto.link.com`). Stripe also offers embedded web and mobile SDK options.

## Notes

- Official Stripe Node helpers may not cover every Onramp preview endpoint; this sample calls the REST API with `fetch`.
- Never expose `STRIPE_SECRET_KEY` to the browser.
- Mint **one session per customer attempt**.
- After `fulfillment_complete`, use webhook data (`transaction_id`, wallet, amounts) to update your own ledger.
