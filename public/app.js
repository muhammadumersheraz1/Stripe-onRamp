(() => {
  const form = document.getElementById("onramp-form");
  const startBtn = document.getElementById("start-btn");
  const reopenBtn = document.getElementById("reopen-btn");
  const errorBox = document.getElementById("error-box");
  const sessionStatus = document.getElementById("session-status");
  const sessionResult = document.getElementById("session-result");
  const sessionDetails = document.getElementById("session-details");
  const merchantSummary = document.getElementById("merchant-summary");

  let lastRedirectUrl = null;

  function showError(message) {
    errorBox.hidden = false;
    errorBox.textContent = message;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function setStatus(text) {
    sessionStatus.textContent = text;
  }

  function openPaymentLink(url) {
    const tab = window.open(url, "_blank", "noopener,noreferrer");
    if (!tab) {
      showError(
        "Popup blocked. Allow popups for this site, then click Reopen payment link."
      );
    }
  }

  function showSession(data) {
    sessionResult.hidden = false;
    const rows = {
      session_id: data.sessionId,
      status: data.status,
      payment_link: data.redirectUrl,
      amount: data.transactionDetails?.source_amount
        ? `$${data.transactionDetails.source_amount}`
        : "—",
      locked_to: `${data.transactionDetails?.destination_currency || "—"} on ${
        data.transactionDetails?.destination_network || "—"
      }`,
    };

    sessionDetails.innerHTML = Object.entries(rows)
      .map(([k, v]) => {
        if (k === "payment_link" && v) {
          return `<dt>${k}</dt><dd><a href="${v}" target="_blank" rel="noreferrer">${v}</a></dd>`;
        }
        return `<dt>${k}</dt><dd>${v ?? "—"}</dd>`;
      })
      .join("");
  }

  async function loadMerchantConfig() {
    const res = await fetch("/api/onramp/merchant-config");
    const config = await res.json();
    if (!config.wallet_configured) {
      merchantSummary.textContent =
        "Set ONRAMP_WALLET_ADDRESS in .env (plus currency/network).";
      startBtn.disabled = true;
      return;
    }
    merchantSummary.textContent = `${String(
      config.destination_currency
    ).toUpperCase()} on ${config.destination_network} → your wallet (locked)`;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();
    startBtn.disabled = true;
    setStatus("Creating locked payment session…");

    const body = {
      source_amount: document.getElementById("source_amount").value,
      email: document.getElementById("email").value.trim() || undefined,
    };

    try {
      const res = await fetch("/api/onramp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create payment session");
      }

      if (!data.redirectUrl) {
        throw new Error("Stripe did not return redirect_url for this session.");
      }

      lastRedirectUrl = data.redirectUrl;
      showSession(data);
      setStatus(`opened · ${data.sessionId}`);
      openPaymentLink(lastRedirectUrl);
    } catch (err) {
      console.error(err);
      showError(err.message || "Something went wrong");
      setStatus("Error");
    } finally {
      startBtn.disabled = false;
    }
  });

  reopenBtn.addEventListener("click", () => {
    if (!lastRedirectUrl) {
      showError("No payment link yet. Create a session first.");
      return;
    }
    clearError();
    openPaymentLink(lastRedirectUrl);
  });

  loadMerchantConfig().catch((err) => {
    console.error(err);
    showError("Could not load merchant config from server.");
  });
})();
