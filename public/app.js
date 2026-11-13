(() => {
  const form = document.getElementById("onramp-form");
  const startBtn = document.getElementById("start-btn");
  const reopenBtn = document.getElementById("reopen-btn");
  const errorBox = document.getElementById("error-box");
  const sessionStatus = document.getElementById("session-status");
  const sessionResult = document.getElementById("session-result");
  const sessionDetails = document.getElementById("session-details");

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
      destination: `${data.transactionDetails?.destination_currency || "—"} / ${
        data.transactionDetails?.destination_network || "—"
      }`,
      source_amount: data.transactionDetails?.source_amount
        ? `$${data.transactionDetails.source_amount}`
        : "—",
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

  function syncNetworkOptions() {
    const currency = document.getElementById("destination_currency").value;
    const networkSelect = document.getElementById("destination_network");
    const map = {
      usdc: ["ethereum", "solana", "polygon"],
      eth: ["ethereum"],
      sol: ["solana"],
      btc: ["bitcoin"],
    };
    const networks = map[currency] || ["ethereum"];
    const current = networkSelect.value;
    networkSelect.innerHTML = networks
      .map(
        (n) =>
          `<option value="${n}">${n.charAt(0).toUpperCase()}${n.slice(1)}</option>`
      )
      .join("");
    if (networks.includes(current)) networkSelect.value = current;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();
    startBtn.disabled = true;
    setStatus("Creating session…");

    const body = {
      source_amount: document.getElementById("source_amount").value,
      source_currency: "usd",
      destination_currency: document.getElementById("destination_currency")
        .value,
      destination_network: document.getElementById("destination_network").value,
      wallet_address: document.getElementById("wallet_address").value.trim(),
      lock_wallet_address: document.getElementById("lock_wallet_address")
        .checked,
    };

    try {
      const res = await fetch("/api/onramp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create onramp session");
      }

      if (!data.redirectUrl) {
        throw new Error(
          "Stripe did not return redirect_url for this session."
        );
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

  document
    .getElementById("destination_currency")
    .addEventListener("change", syncNetworkOptions);

  syncNetworkOptions();
})();
