require("dotenv").config();

const path = require("path");
const express = require("express");
const onrampRouter = require("./onramp");
const webhooksRouter = require("./webhooks");

const app = express();
const PORT = process.env.PORT || 4242;

// Webhooks need the raw body for signature verification — mount first
app.use("/api/webhooks/stripe", webhooksRouter);

app.use(express.json());

// Allow the Privy sample (localhost:3000) to call this API cross-origin
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    origin === "http://localhost:3000" ||
    origin === "http://127.0.0.1:3000"
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/config", (_req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
  });
});

app.use("/api/onramp", onrampRouter);

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  Stripe Crypto Onramp sample`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(
    `  Session API: POST https://api.stripe.com/v1/crypto/onramp_sessions`
  );
  console.log(`  Uses client_secret → embedded Onramp widget\n`);

  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn("  Warning: STRIPE_SECRET_KEY is missing. Set it in .env.\n");
  }
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    console.warn(
      "  Warning: STRIPE_PUBLISHABLE_KEY is missing. Required for the embedded widget.\n"
    );
  }
});

