function formatWon(n) {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

document.getElementById("calcForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const monthlyWage = Number(document.getElementById("monthlyWage").value.replace(/,/g, "")) * 10000 || 0;
  const months = Number(document.getElementById("months").value) || 1;

  const resultBox = document.getElementById("result");
  if (!monthlyWage) {
    resultBox.classList.remove("show");
    return;
  }

  const r = calculateParentalLeavePay(monthlyWage, months);

  document.getElementById("resTotal").textContent = formatWon(r.total);
  document.getElementById("resMonths").textContent = r.months + "개월";

  const tbody = document.getElementById("monthlyBody");
  tbody.innerHTML = "";
  r.monthly.forEach((amount, idx) => {
    const tr = document.createElement("tr");
    const tdMonth = document.createElement("td");
    tdMonth.textContent = idx + 1 + "개월차";
    const tdAmount = document.createElement("td");
    tdAmount.textContent = formatWon(amount);
    tr.appendChild(tdMonth);
    tr.appendChild(tdAmount);
    tbody.appendChild(tr);
  });

  resultBox.classList.add("show");
});

document.getElementById("monthlyWage").addEventListener("input", function (e) {
  const raw = e.target.value.replace(/[^0-9]/g, "");
  e.target.value = raw ? Number(raw).toLocaleString("ko-KR") : "";
});
