/*
  퇴직금 계산 (근로기준법 시행령 제2조 - 평균임금 산정 방식)
  이 계산식 자체는 세율표처럼 매년 바뀌는 값이 아니라 근로기준법에 고정된
  계산 방식이므로, 4대보험/세율표와 달리 자동 확인 대상이 아닙니다.

  1일 평균임금 = 퇴직일 이전 3개월간 지급된 임금총액 ÷ 그 3개월간의 총 일수
  퇴직금 = 1일 평균임금 × 30일 × (재직일수 ÷ 365)
*/

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function daysBetween(start, end) {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

/**
 * @param {string} startDateStr 입사일 (YYYY-MM-DD)
 * @param {string} endDateStr 퇴사일 (YYYY-MM-DD)
 * @param {number} last3MonthsWageTotal 퇴직 전 3개월간 지급된 임금 총액 (원)
 * @param {number} annualBonusTotal 최근 1년간 받은 상여금 총액 (원)
 * @param {number} annualLeaveAllowance 미사용 연차수당 (원)
 */
function calculateRetirementPay(
  startDateStr,
  endDateStr,
  last3MonthsWageTotal,
  annualBonusTotal = 0,
  annualLeaveAllowance = 0
) {
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  const serviceDays = daysBetween(startDate, endDate);
  const threeMonthsBefore = addMonths(endDate, -3);
  const periodDays = daysBetween(threeMonthsBefore, endDate);

  const bonusPortion = annualBonusTotal * (3 / 12);
  const leavePortion = annualLeaveAllowance * (3 / 12);
  const totalWageForPeriod = last3MonthsWageTotal + bonusPortion + leavePortion;

  const averageDailyWage = periodDays > 0 ? totalWageForPeriod / periodDays : 0;
  const retirementPay = averageDailyWage * 30 * (serviceDays / 365);

  return {
    serviceDays,
    periodDays,
    averageDailyWage: Math.round(averageDailyWage),
    retirementPay: Math.round(retirementPay),
    eligible: serviceDays >= 365,
  };
}
