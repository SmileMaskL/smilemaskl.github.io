function formatWon(n) {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

document.getElementById("calcForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const wage3m = Number(document.getElementById("wage3m").value.replace(/,/g, "")) * 10000 || 0;
  const bonus = Number(document.getElementById("bonus").value.replace(/,/g, "")) * 10000 || 0;
  const leaveAllowance = Number(document.getElementById("leaveAllowance").value.replace(/,/g, "")) * 10000 || 0;

  const resultBox = document.getElementById("result");
  const warningBox = document.getElementById("warning");

  if (!startDate || !endDate || !wage3m) {
    resultBox.classList.remove("show");
    return;
  }
  if (new Date(endDate) <= new Date(startDate)) {
    alert("퇴사일은 입사일보다 뒤여야 합니다.");
    return;
  }

  const r = calculateRetirementPay(startDate, endDate, wage3m, bonus, leaveAllowance);

  document.getElementById("resRetirementPay").textContent = formatWon(r.retirementPay);
  document.getElementById("resServiceDays").textContent = r.serviceDays.toLocaleString("ko-KR") + "일";
  document.getElementById("resAvgDaily").textContent = formatWon(r.averageDailyWage);
  document.getElementById("resPeriodDays").textContent = r.periodDays.toLocaleString("ko-KR") + "일";

  if (!r.eligible) {
    warningBox.textContent = "⚠ 재직일수가 1년(365일) 미만이면 근로기준법상 퇴직금 지급 의무가 없습니다. 아래 금액은 참고용 계산값입니다.";
    warningBox.style.display = "block";
  } else {
    warningBox.style.display = "none";
  }

  resultBox.classList.add("show");
});

["wage3m", "bonus", "leaveAllowance"].forEach((id) => {
  document.getElementById(id).addEventListener("input", function (e) {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    e.target.value = raw ? Number(raw).toLocaleString("ko-KR") : "";
  });
});
