function formatWon(n) {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

document.getElementById("calcForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const officialPrice = Number(document.getElementById("officialPrice").value.replace(/,/g, "")) * 10000 || 0;
  const isOneHousehold = document.getElementById("isOneHousehold").value === "yes";
  const includeUrbanAreaTax = document.getElementById("includeUrbanAreaTax").checked;

  const resultBox = document.getElementById("result");
  if (!officialPrice) {
    resultBox.classList.remove("show");
    return;
  }

  saveLastInput("propertyTax", {
    officialPrice: document.getElementById("officialPrice").value,
    isOneHousehold: document.getElementById("isOneHousehold").value,
    includeUrbanAreaTax,
  });

  const r = calculatePropertyTax(officialPrice, isOneHousehold, includeUrbanAreaTax);

  document.getElementById("resTotal").textContent = formatWon(r.total);
  document.getElementById("resTaxBase").textContent = formatWon(r.taxBase);
  document.getElementById("resFairMarketRatio").textContent = (r.fairMarketRatio * 100).toFixed(0) + "%";
  document.getElementById("resRateType").textContent = r.useSpecialRate ? "1세대1주택 특례세율" : "표준세율";
  document.getElementById("resPropertyTax").textContent = formatWon(r.propertyTax);
  document.getElementById("resLocalEduTax").textContent = formatWon(r.localEducationTax);
  document.getElementById("resUrbanAreaTax").textContent = formatWon(r.urbanAreaTax);

  resultBox.classList.add("show");
});

document.getElementById("officialPrice").addEventListener("input", function (e) {
  const raw = e.target.value.replace(/[^0-9]/g, "");
  e.target.value = raw ? Number(raw).toLocaleString("ko-KR") : "";
});

(function restoreLastInput() {
  const last = loadLastInput("propertyTax");
  if (!last) return;
  if (last.officialPrice) document.getElementById("officialPrice").value = last.officialPrice;
  if (last.isOneHousehold) document.getElementById("isOneHousehold").value = last.isOneHousehold;
  if (typeof last.includeUrbanAreaTax === "boolean") {
    document.getElementById("includeUrbanAreaTax").checked = last.includeUrbanAreaTax;
  }
  document.getElementById("rememberedHint").classList.add("show");
})();
