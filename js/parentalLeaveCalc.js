/*
  육아휴직급여 계산 (2026년 기준, 고용보험법 시행령 제95조)

  1~3개월차: 통상임금의 100%, 월 상한 250만원
  4~6개월차: 통상임금의 100%, 월 상한 200만원
  7개월차~ : 통상임금의 80%, 월 상한 160만원
  공통 하한액: 월 70만원 (단, 통상임금이 70만원 미만이면 통상임금 전액)

  2025년 개정으로 "사후지급금"(복직 6개월 후 25% 지급) 제도가 폐지되어
  매월 전액이 지급됩니다.

  ※ 부모가 함께/순차로 육아휴직을 쓸 때 첫 6개월간 추가로 더 받는
  "6+6 부모육아휴직제" 특례는 이 계산기에 포함되어 있지 않습니다 (별도 제도).
  이 계산기는 한쪽 부모가 단독으로 사용하는 일반적인 경우를 계산합니다.
*/

const PARENTAL_LEAVE_UPPER_LIMIT = 700000;

function monthlyTierFor(monthIndex) {
  // monthIndex: 1부터 시작
  if (monthIndex <= 3) return { rate: 1.0, cap: 2500000 };
  if (monthIndex <= 6) return { rate: 1.0, cap: 2000000 };
  return { rate: 0.8, cap: 1600000 };
}

/**
 * @param {number} monthlyWage 통상임금 (월, 원)
 * @param {number} months 육아휴직 사용 개월 수 (1~12)
 * @returns {object} 월별 지급액 배열과 총액
 */
function calculateParentalLeavePay(monthlyWage, months) {
  const clampedMonths = Math.max(1, Math.min(months, 12));
  const monthly = [];

  for (let m = 1; m <= clampedMonths; m++) {
    const tier = monthlyTierFor(m);
    const raw = monthlyWage * tier.rate;
    const capped = Math.min(raw, tier.cap);
    const floorAmount = Math.min(PARENTAL_LEAVE_UPPER_LIMIT, monthlyWage);
    const paid = Math.max(capped, floorAmount);
    monthly.push(Math.round(paid));
  }

  const total = monthly.reduce((sum, v) => sum + v, 0);

  return { monthly, total, months: clampedMonths };
}
