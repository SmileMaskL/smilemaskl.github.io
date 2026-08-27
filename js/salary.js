function formatWon(n) {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

function updateDonut(r) {
  const gross = r.grossMonthly || 1;
  const netPct = (r.netMonthly / gross) * 100;
  const insPct = (r.insuranceMonthlyTotal / gross) * 100;
  const taxPct = ((r.incomeTaxMonthly + r.localTaxMonthly) / gross) * 100;

  const segNet = document.getElementById("segNet");
  const segIns = document.getElementById("segInsurance");
  const segTax = document.getElementById("segTax");

  segNet.setAttribute("stroke-dasharray", `${netPct} ${100 - netPct}`);
  segNet.setAttribute("stroke-dashoffset", "25");

  segIns.setAttribute("stroke-dasharray", `${insPct} ${100 - insPct}`);
  segIns.setAttribute("stroke-dashoffset", String(25 - netPct));

  segTax.setAttribute("stroke-dasharray", `${taxPct} ${100 - taxPct}`);
  segTax.setAttribute("stroke-dashoffset", String(25 - netPct - insPct));

  document.getElementById("legNetPct").textContent = netPct.toFixed(1) + "%";
  document.getElementById("legInsPct").textContent = insPct.toFixed(1) + "%";
  document.getElementById("legTaxPct").textContent = taxPct.toFixed(1) + "%";
}

// "계산 근거" 신뢰 배지에 최근 자동 확인 날짜 표시 (data/rates.json에서 직접 읽어옴)
fetch("data/rates.json")
  .then((res) => res.json())
  .then((data) => {
    document.querySelectorAll(".js-last-verified").forEach((el) => {
      el.textContent = data.lastVerifiedAt || "확인 불가";
    });
  })
  .catch(() => {
    document.querySelectorAll(".js-last-verified").forEach((el) => {
      el.textContent = "확인 불가";
    });
  });

function runCalculation() {
  const salaryInput = document.getElementById("salary").value.replace(/,/g, "");
  const annualSalary = Number(salaryInput) * 10000; // 만원 단위 입력 -> 원
  const dependents = Number(document.getElementById("dependents").value) || 1;
  const nonTaxable = Number(document.getElementById("nonTaxable").value) * 10000 || 0;

  const resultBox = document.getElementById("result");

  if (!annualSalary || annualSalary <= 0) {
    resultBox.classList.remove("show");
    return;
  }

  saveLastInput("salary", {
    salary: document.getElementById("salary").value,
    dependents: document.getElementById("dependents").value,
    nonTaxable: document.getElementById("nonTaxable").value,
  });

  const r = calculateSalary(annualSalary, dependents, nonTaxable);

  document.getElementById("resNetMonthly").textContent = formatWon(r.netMonthly);
  document.getElementById("resNetAnnual").textContent = formatWon(r.netAnnual);
  document.getElementById("resGrossMonthly").textContent = formatWon(r.grossMonthly);
  document.getElementById("resPension").textContent = formatWon(r.pensionMonthly);
  document.getElementById("resHealth").textContent = formatWon(r.healthMonthly + r.longTermCareMonthly);
  document.getElementById("resEmployment").textContent = formatWon(r.employmentMonthly);
  document.getElementById("resIncomeTax").textContent = formatWon(r.incomeTaxMonthly);
  document.getElementById("resLocalTax").textContent = formatWon(r.localTaxMonthly);
  document.getElementById("resDeductionTotal").textContent = formatWon(r.deductionMonthlyTotal);

  updateDonut(r);

  resultBox.classList.add("show");
}

document.getElementById("calcForm").addEventListener("submit", function (e) {
  e.preventDefault();
  runCalculation();
});

// 입력값 천단위 콤마 자동 표시
document.getElementById("salary").addEventListener("input", function (e) {
  const raw = e.target.value.replace(/[^0-9]/g, "");
  e.target.value = raw ? Number(raw).toLocaleString("ko-KR") : "";
});

// 마지막 입력값 불러오기 (재방문 시 자동 채움)
(function restoreLastInput() {
  const last = loadLastInput("salary");
  if (!last) return;
  if (last.salary) document.getElementById("salary").value = last.salary;
  if (last.dependents) document.getElementById("dependents").value = last.dependents;
  if (last.nonTaxable) document.getElementById("nonTaxable").value = last.nonTaxable;
  document.getElementById("rememberedHint").classList.add("show");
})();
