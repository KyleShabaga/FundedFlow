// Synthetic fixture script: renders the funded-account rules client-side.
document.addEventListener("DOMContentLoaded", function () {
  var app = document.getElementById("app");
  app.innerHTML =
    "<h1>Funded account rules</h1>" +
    "<p>This text only exists after JavaScript runs. It describes fictitious simulated funded account rules " +
    "used to test the collector's browser fallback. Nothing here is a real firm's rule or offer.</p>" +
    "<h2>Scaling plan</h2>" +
    "<p>Contract limits increase after every two successful payout cycles, up to the plan maximum.</p>" +
    "<h2>Inactivity</h2>" +
    "<p>Accounts with no trades for thirty consecutive calendar days are closed. Closing an account does not " +
    "affect previously approved payouts in this synthetic example.</p>";
});
