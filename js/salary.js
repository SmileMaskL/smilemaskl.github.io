function formatWon(n) {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

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
