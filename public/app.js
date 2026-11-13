(() => {
  const form = document.getElementById("onramp-form");
  const startBtn = document.getElementById("start-btn");
  const errorBox = document.getElementById("error-box");
  const sessionStatus = document.getElementById("session-status");
  const onrampPanel = document.getElementById("onramp-panel");
  const onrampElement = document.getElementById("onramp-element");

  let stripeOnramp = null;
  let activeSession = null;

  function showError(message) {
    errorBox.hidden = false;
    errorBox.textContent = message;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function setStatus(text) {
    if (!text) {
      sessionStatus.hidden = true;
      sessionStatus.textContent = "";
      return;
    }
    sessionStatus.hidden = false;
    sessionStatus.textContent = text;
  }

  async function getPublishableKey() {
    const res = await fetch("/api/config");
    const data = await res.json();
    if (!data.publishableKey) {
      throw new Error(
        "Missing STRIPE_PUBLISHABLE_KEY. Add it to .env and restart the server."
      );
    }
    return data.publishableKey;
  }

  async function ensureStripeOnramp() {
    if (stripeOnramp) return stripeOnramp;

    if (typeof window.StripeOnramp !== "function") {
      throw new Error(
        "Stripe Onramp SDK failed to load. Check your network and refresh."
      );
    }

    const publishableKey = await getPublishableKey();
    stripeOnramp = window.StripeOnramp(publishableKey);
    return stripeOnramp;
  }

  function clearWidget() {
    if (activeSession && typeof activeSession.unmount === "function") {
      try {
        activeSession.unmount();
      } catch (_) {
        /* ignore */
      }
    }
    activeSession = null;
    onrampElement.innerHTML = "";
  }

  function mountWidget(clientSecret) {
    clearWidget();
    onrampPanel.hidden = false;

    const onramp = stripeOnramp.createSession({
      clientSecret,
      appearance: { theme: "light" },
    });

    if (typeof onramp.addEventListener === "function") {
      onramp.addEventListener("onramp_session_updated", (event) => {
        const session = event?.payload?.session;
        if (!session?.status) return;

        if (session.status === "fulfillment_complete") {
          setStatus("Payment complete — crypto delivery confirmed.");
        } else if (session.status === "fulfillment_processing") {
          setStatus("Payment received — fulfilling crypto…");
        } else if (session.status === "rejected") {
          showError("Checkout was rejected. Try again with a new session.");
        } else {
          setStatus(`Status: ${session.status}`);
        }
      });
    }

    onramp.mount(onrampElement);
    activeSession = onramp;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();
    startBtn.disabled = true;
    setStatus("Preparing secure checkout…");

    const body = {
      source_amount: document.getElementById("source_amount").value,
      email: document.getElementById("email").value.trim() || undefined,
    };

    try {
      await ensureStripeOnramp();

      const res = await fetch("/api/onramp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Could not start checkout");
      }

      if (!data.clientSecret) {
        throw new Error("Checkout session secret was not returned. Try again.");
      }

      setStatus("Checkout ready — complete payment in the widget.");
      mountWidget(data.clientSecret);
    } catch (err) {
      console.error(err);
      showError(err.message || "Something went wrong");
      setStatus("");
      onrampPanel.hidden = true;
      clearWidget();
    } finally {
      startBtn.disabled = false;
    }
  });
})();
