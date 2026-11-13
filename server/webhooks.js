const express = require("express");
const Stripe = require("stripe");

const router = express.Router();

/**
 * Handle crypto.onramp_session.updated (and related) events.
 * Register this endpoint in the Stripe Dashboard and select:
 *   crypto.onramp_session.updated
 *
 * Session statuses:
 *   initialized → rejected | requires_payment → fulfillment_processing → fulfillment_complete
 */
function handleOnrampSessionUpdated(session) {
  const status = session.status;
  const details = session.transaction_details || {};

  console.log("[webhook] onramp session updated", {
    id: session.id,
    status,
    destination_currency: details.destination_currency,
    destination_network: details.destination_network,
    destination_amount: details.destination_amount,
    source_amount: details.source_amount,
    transaction_id: details.transaction_id,
    wallet_address: details.wallet_address,
  });

  switch (status) {
    case "requires_payment":
      // Customer finished KYC / signed in and is on the payment step
      break;
    case "fulfillment_processing":
      // Payment succeeded; crypto delivery in progress
      break;
    case "fulfillment_complete":
      // Crypto delivered — credit the user in your product here
      // e.g. mark order paid, unlock content, notify wallet
      break;
    case "rejected":
      // KYC / sanctions / fraud rejection
      break;
    default:
      break;
  }
}

router.post(
  "/",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeKey) {
      return res.status(500).send("Missing STRIPE_SECRET_KEY");
    }

    const stripe = new Stripe(stripeKey);
    let event = req.body;

    if (webhookSecret) {
      const signature = req.headers["stripe-signature"];
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          signature,
          webhookSecret
        );
      } catch (err) {
        console.error("Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    } else {
      // Local testing without a signing secret — parse raw buffer
      try {
        event = JSON.parse(req.body.toString("utf8"));
        console.warn(
          "[webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature verification"
        );
      } catch {
        return res.status(400).send("Invalid JSON payload");
      }
    }

    switch (event.type) {
      case "crypto.onramp_session.updated":
        handleOnrampSessionUpdated(event.data.object);
        break;
      default:
        console.log(`[webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  }
);

module.exports = router;
