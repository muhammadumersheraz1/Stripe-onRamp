const express = require("express");

const router = express.Router();

/**
 * Merchant-fixed destination settings (customer never chooses these).
 * Locked into the Stripe session so hosted checkout only needs card / KYC.
 */
function getMerchantDestination() {
  const destination_currency = (
    process.env.ONRAMP_DESTINATION_CURRENCY || "usdc"
  ).toLowerCase();
  const destination_network = (
    process.env.ONRAMP_DESTINATION_NETWORK || "ethereum"
  ).toLowerCase();
  const wallet_address = (process.env.ONRAMP_WALLET_ADDRESS || "").trim();

  return { destination_currency, destination_network, wallet_address };
}

/**
 * Stripe Onramp hosted link:
 * POST https://api.stripe.com/v1/crypto/onramp_sessions
 * → redirect_url (https://crypto.link.com?session_hash=...)
 *
 * Docs: https://docs.stripe.com/api/crypto/onramp_sessions/create
 */
async function createOnrampSession(secretKey, body) {
  const params = new URLSearchParams();

  if (body.source_amount) params.set("source_amount", String(body.source_amount));
  if (body.source_currency) params.set("source_currency", body.source_currency);

  // Lock asset + network to a single choice so customer can't change them
  if (body.destination_currency) {
    params.set("destination_currency", body.destination_currency);
    params.set("destination_currencies[0]", body.destination_currency);
  }
  if (body.destination_network) {
    params.set("destination_network", body.destination_network);
    params.set("destination_networks[0]", body.destination_network);
  }

  // Always lock wallet — customer should only pay with card
  params.set("lock_wallet_address", "true");

  if (body.wallet_addresses && typeof body.wallet_addresses === "object") {
    for (const [network, address] of Object.entries(body.wallet_addresses)) {
      if (address) params.set(`wallet_addresses[${network}]`, address);
    }
  }

  if (body.customer_information) {
    const info = body.customer_information;
    if (info.email) params.set("customer_information[email]", info.email);
    if (info.first_name) {
      params.set("customer_information[first_name]", info.first_name);
    }
    if (info.last_name) {
      params.set("customer_information[last_name]", info.last_name);
    }
  }

  if (body.customer_ip_address) {
    params.set("customer_ip_address", body.customer_ip_address);
  }

  const stripeApiUrl = "https://api.stripe.com/v1/crypto/onramp_sessions";
  const requestBody = params.toString();

  // Readable object of every field we send to Stripe
  const payloadForLogs = Object.fromEntries(params.entries());

  console.log("\n========== STRIPE ONRAMP REQUEST ==========");
  console.log("[stripe] API: POST", stripeApiUrl);
  console.log(
    "[stripe] Docs: https://docs.stripe.com/api/crypto/onramp_sessions/create"
  );
  console.log("[stripe] Payload (JSON):");
  console.log(JSON.stringify(payloadForLogs, null, 2));
  console.log("[stripe] Payload (x-www-form-urlencoded):");
  console.log(requestBody);
  console.log("===========================================\n");

  const response = await fetch(stripeApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: requestBody,
  });

  const data = await response.json();

  console.log("========== STRIPE ONRAMP RESPONSE =========");
  console.log("[stripe] HTTP status:", response.status);
  if (response.ok) {
    console.log("[stripe] Session id:", data.id);
    console.log("[stripe] Status:", data.status);
    console.log("[stripe] Hosted link (redirect_url):", data.redirect_url || "(none)");
    console.log(
      "[stripe] Full response:",
      JSON.stringify(
        {
          id: data.id,
          status: data.status,
          redirect_url: data.redirect_url,
          transaction_details: data.transaction_details,
        },
        null,
        2
      )
    );
  } else {
    console.error("[stripe] Error payload:", JSON.stringify(data, null, 2));
  }
  console.log("===========================================\n");

  return { status: response.status, data };
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  let ip;
  if (typeof forwarded === "string" && forwarded.length > 0) {
    ip = forwarded.split(",")[0].trim();
  } else {
    ip = req.socket.remoteAddress || undefined;
  }

  if (!ip || ip === "::1" || ip === "127.0.0.1" || ip.startsWith(":ffff:127.")) {
    return undefined;
  }
  return ip;
}

router.get("/merchant-config", (_req, res) => {
  const config = getMerchantDestination();
  res.json({
    destination_currency: config.destination_currency,
    destination_network: config.destination_network,
    wallet_configured: Boolean(config.wallet_address),
  });
});

router.post("/session", async (req, res) => {
  try {
    console.log("\n---------- /api/onramp/session ----------");
    console.log("[api] Incoming client body:");
    console.log(JSON.stringify(req.body || {}, null, 2));

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({
        error:
          "Missing STRIPE_SECRET_KEY. Copy .env.example to .env and add your keys.",
      });
    }

    const merchant = getMerchantDestination();
    if (!merchant.wallet_address) {
      return res.status(500).json({
        error:
          "Missing ONRAMP_WALLET_ADDRESS in .env. Set your settlement wallet before creating payment links.",
      });
    }

    const {
      source_amount,
      source_currency = "usd",
      email,
      first_name,
      last_name,
    } = req.body || {};

    if (!source_amount) {
      return res.status(400).json({ error: "source_amount is required" });
    }

    const customer_information = {};
    if (email) customer_information.email = String(email).trim();
    if (first_name) customer_information.first_name = String(first_name).trim();
    if (last_name) customer_information.last_name = String(last_name).trim();

    const payload = {
      source_amount: String(source_amount),
      source_currency,
      destination_currency: merchant.destination_currency,
      destination_network: merchant.destination_network,
      // Single-network wallet map — locked so customer never picks crypto details
      wallet_addresses: {
        [merchant.destination_network]: merchant.wallet_address,
      },
      customer_information:
        Object.keys(customer_information).length > 0
          ? customer_information
          : undefined,
      customer_ip_address: getClientIp(req),
    };

    console.log("[api] Built Stripe payload (before encode):");
    console.log(JSON.stringify(payload, null, 2));

    const { status, data } = await createOnrampSession(secretKey, payload);

    if (status >= 400) {
      return res.status(status).json({
        error: data?.error?.message || "Failed to create onramp session",
        code: data?.error?.code,
        type: data?.error?.type,
        details: data?.error,
      });
    }

    return res.json({
      sessionId: data.id,
      status: data.status,
      redirectUrl: data.redirect_url || null,
      transactionDetails: data.transaction_details,
    });
  } catch (err) {
    console.error("Create onramp session failed:", err);
    return res.status(500).json({
      error: err.message || "Unexpected server error",
    });
  }
});

router.get("/session/:id", async (req, res) => {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    }

    const response = await fetch(
      `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(req.params.id)}`,
      {
        headers: { Authorization: `Bearer ${secretKey}` },
      }
    );
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Failed to retrieve session",
      });
    }
    return res.json(data);
  } catch (err) {
    console.error("Retrieve onramp session failed:", err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
