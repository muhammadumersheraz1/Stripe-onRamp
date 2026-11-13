const express = require("express");

const router = express.Router();

/**
 * Stripe's Onramp API is in public preview and is not fully wrapped by
 * stripe-node helpers in all versions, so we call the REST endpoint directly.
 * Docs: https://docs.stripe.com/crypto/onramp
 */
async function createOnrampSession(secretKey, body) {
  const params = new URLSearchParams();

  if (body.source_amount) params.set("source_amount", String(body.source_amount));
  if (body.source_currency) params.set("source_currency", body.source_currency);
  if (body.destination_amount) {
    params.set("destination_amount", String(body.destination_amount));
  }
  if (body.destination_currency) {
    params.set("destination_currency", body.destination_currency);
  }
  if (body.destination_network) {
    params.set("destination_network", body.destination_network);
  }
  if (body.lock_wallet_address) {
    params.set("lock_wallet_address", "true");
  }

  if (Array.isArray(body.destination_currencies)) {
    body.destination_currencies.forEach((c, i) => {
      params.set(`destination_currencies[${i}]`, c);
    });
  }

  if (Array.isArray(body.destination_networks)) {
    body.destination_networks.forEach((n, i) => {
      params.set(`destination_networks[${i}]`, n);
    });
  }

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

  // Hosted checkout link comes from this Stripe API:
  // POST https://api.stripe.com/v1/crypto/onramp_sessions
  // Response field: redirect_url (e.g. https://crypto.link.com?session_hash=...)
  const stripeApiUrl = "https://api.stripe.com/v1/crypto/onramp_sessions";
  const requestBody = params.toString();

  console.log("\n[stripe] Generating hosted onramp link");
  console.log(`[stripe] API: POST ${stripeApiUrl}`);
  console.log("[stripe] Docs: https://docs.stripe.com/api/crypto/onramp_sessions/create");
  console.log("[stripe] Request body:", requestBody);

  const response = await fetch(stripeApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: requestBody,
  });

  const data = await response.json();

  if (response.ok) {
    console.log(`[stripe] Session id: ${data.id}`);
    console.log(`[stripe] Status: ${data.status}`);
    console.log(`[stripe] Hosted link (redirect_url): ${data.redirect_url || "(none)"}`);
  } else {
    console.error(
      `[stripe] API error ${response.status}:`,
      data?.error?.message || data
    );
  }

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

  // Don't send loopback to Stripe — it fails supportability checks.
  if (!ip || ip === "::1" || ip === "127.0.0.1" || ip.startsWith(":ffff:127.")) {
    return undefined;
  }
  return ip;
}

router.post("/session", async (req, res) => {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({
        error: "Missing STRIPE_SECRET_KEY. Copy .env.example to .env and add your keys.",
      });
    }

    const {
      source_amount,
      source_currency = "usd",
      destination_currency = "usdc",
      destination_network = "ethereum",
      destination_amount,
      wallet_address,
      wallet_addresses,
      lock_wallet_address = true,
      customer_information,
    } = req.body || {};

    const addresses =
      wallet_addresses ||
      (wallet_address
        ? { [destination_network]: wallet_address }
        : undefined);

    const payload = {
      source_amount,
      source_currency,
      destination_currency,
      destination_network,
      destination_amount,
      wallet_addresses: addresses,
      lock_wallet_address,
      customer_information,
      customer_ip_address: getClientIp(req),
    };

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
      clientSecret: data.client_secret,
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
