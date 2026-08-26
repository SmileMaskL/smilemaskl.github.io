/*
  calc.js — 연봉 실수령액 계산 공식 모듈 (자동 생성 파일)

  ** 이 파일을 직접 수정하지 마세요. **
  이 파일은 scripts/generate-calc.mjs 가 data/rates.json 을 읽어서 자동으로 만듭니다.
  값을 고치려면 data/rates.json 을 수정한 뒤 "node scripts/generate-calc.mjs" 를 실행하세요.
  (하루 3번 실행되는 GitHub Actions가 data/rates.json 변경을 감지하면 이 파일도 함께
   갱신하여 main 브랜치에 바로 커밋합니다. scripts/check-rates.mjs,
   .github/workflows/check-rates.yml 참고)

  생성 시각: 2026-08-26T06:13:57.061Z
  기준 데이터 검증일: 2026-08-26
*/

const RATES = {
  // 4대보험 요율 (근로자 부담분 기준)
  pension: 0.0475,          // 국민연금 4.75%
  pensionMonthlyCap: 6590000, // 국민연금 기준소득월액 상한액 (2026-07-01 ~ 2027-06-30 (기준소득월액 상/하한액 기준, 보험료율 자체는 매년 1월 1일 변경))
  pensionMonthlyFloor: 410000, // 국민연금 기준소득월액 하한액
  health: 0.03595,         // 건강보험 3.595% (근로자 부담분, 2026년 기준)
  longTermCareRate: 0.131405, // 장기요양보험료율 (건강보험료의 13.14%, 소득대비 0.9448% 기준 역산)
  employment: 0.009,       // 고용보험 0.90%
};

// 주어진 값에 해당하는 구간을 찾아 "value * rate - deduction" 형태로 계산한다.
// (종합소득세, 근로소득공제 모두 같은 누진 구조라 계산 함수를 공유한다.)
function evalBracket(value, brackets) {
  const bracket = brackets.find((b) => value <= b.limit);
  return value * bracket.rate - bracket.deduction;
}

// 근로소득공제 (소득세법 제47조, 총급여 기준)
const EARNED_INCOME_DEDUCTION_BRACKETS = [
  { limit: 5000000, rate: 0.7, deduction: 0 },
  { limit: 15000000, rate: 0.4, deduction: -1500000 },
  { limit: 45000000, rate: 0.15, deduction: -5250000 },
  { limit: 100000000, rate: 0.05, deduction: -9750000 },
  { limit: Infinity, rate: 0.02, deduction: -12750000 },
];
const MAX_EARNED_INCOME_DEDUCTION = 20000000; // 공제액은 이 금액을 넘을 수 없음 (제47조 단서)

function earnedIncomeDeduction(gross) {
  return Math.min(evalBracket(gross, EARNED_INCOME_DEDUCTION_BRACKETS), MAX_EARNED_INCOME_DEDUCTION);
}

// 종합소득세 기본세율 (소득세법 제55조, 과세표준 구간별 누진공제 방식)
const TAX_BRACKETS = [
  { limit: 14000000, rate: 0.06, deduction: 0 },
  { limit: 50000000, rate: 0.15, deduction: 1260000 },
  { limit: 88000000, rate: 0.24, deduction: 5760000 },
  { limit: 150000000, rate: 0.35, deduction: 15440000 },
  { limit: 300000000, rate: 0.38, deduction: 19940000 },
  { limit: 500000000, rate: 0.4, deduction: 25940000 },
  { limit: 1000000000, rate: 0.42, deduction: 35940000 },
  { limit: Infinity, rate: 0.45, deduction: 65940000 },
];

function calcIncomeTax(taxBase) {
  if (taxBase <= 0) return 0;
  return evalBracket(taxBase, TAX_BRACKETS);
}

// 근로소득세액공제 (소득세법 제59조)
const CREDIT = {
  rateLow: 0.55,
  rateHigh: 0.3,
  bracketLimit: 1300000,
  baseAtBracketLimit: 715000,
};

// 총급여 구간별 공제 한도 (제59조 제2항 - 총 4단계, 마지막 구간이 예전에 누락돼 있었음)
const CREDIT_LIMIT_TIERS = [
  { maxGross: 33000000, amount: 740000 },
  { maxGross: 70000000, threshold: 33000000, base: 740000, rate: 0.008, floor: 660000 },
  { maxGross: 120000000, threshold: 70000000, base: 660000, rate: 0.5, floor: 500000 },
  { maxGross: Infinity, threshold: 120000000, base: 500000, rate: 0.5, floor: 200000 },
];

function earnedIncomeTaxCreditLimit(gross) {
  const tier = CREDIT_LIMIT_TIERS.find((t) => gross <= t.maxGross);
  if (tier.amount !== undefined) return tier.amount;
  return Math.max(tier.base - (gross - tier.threshold) * tier.rate, tier.floor);
}

function earnedIncomeTaxCredit(calculatedTax, gross) {
  const credit =
    calculatedTax <= CREDIT.bracketLimit
      ? calculatedTax * CREDIT.rateLow
      : CREDIT.baseAtBracketLimit + (calculatedTax - CREDIT.bracketLimit) * CREDIT.rateHigh;
  return Math.min(credit, earnedIncomeTaxCreditLimit(gross));
}

/**
 * 연봉 실수령액 계산 (간이 추정치)
 * @param {number} annualSalary 연봉 (세전, 원)
 * @param {number} dependents 부양가족 수 (본인 포함, 최소 1)
 * @param {number} nonTaxableMonthly 비과세액 (월, 원) - 식대 등
 * @returns {object} 계산 결과 상세
 */
function calculateSalary(annualSalary, dependents = 1, nonTaxableMonthly = 200000) {
  const nonTaxableAnnual = nonTaxableMonthly * 12;
  const taxableAnnual = Math.max(annualSalary - nonTaxableAnnual, 0);

  // 4대보험은 비과세 제외한 월 과세대상 급여 기준
  const monthlyTaxable = taxableAnnual / 12;

  const pensionBase = Math.min(
    Math.max(monthlyTaxable, RATES.pensionMonthlyFloor),
    RATES.pensionMonthlyCap
  );
  const pensionMonthly = Math.round(pensionBase * RATES.pension);
  const healthMonthly = Math.round(monthlyTaxable * RATES.health);
  const longTermCareMonthly = Math.round(healthMonthly * RATES.longTermCareRate);
  const employmentMonthly = Math.round(monthlyTaxable * RATES.employment);

  const insuranceMonthlyTotal =
    pensionMonthly + healthMonthly + longTermCareMonthly + employmentMonthly;
  const insuranceAnnualTotal = insuranceMonthlyTotal * 12;

  // 근로소득공제 및 인적공제 적용한 과세표준 산출
  const deduction = earnedIncomeDeduction(taxableAnnual);
  const personalDeduction = 1500000 * Math.max(dependents, 1);
  const taxBase = Math.max(
    taxableAnnual - deduction - personalDeduction - insuranceAnnualTotal,
    0
  );

  const calculatedTax = calcIncomeTax(taxBase);
  const credit = earnedIncomeTaxCredit(calculatedTax, taxableAnnual);
  const incomeTaxAnnual = Math.max(Math.round(calculatedTax - credit), 0);
  const localTaxAnnual = Math.round(incomeTaxAnnual * 0.1);

  const incomeTaxMonthly = Math.round(incomeTaxAnnual / 12);
  const localTaxMonthly = Math.round(localTaxAnnual / 12);

  const deductionMonthlyTotal =
    insuranceMonthlyTotal + incomeTaxMonthly + localTaxMonthly;
  const netMonthly = Math.round(annualSalary / 12) - deductionMonthlyTotal;
  const netAnnual = netMonthly * 12;

  return {
    grossMonthly: Math.round(annualSalary / 12),
    pensionMonthly,
    healthMonthly,
    longTermCareMonthly,
    employmentMonthly,
    insuranceMonthlyTotal,
    incomeTaxMonthly,
    localTaxMonthly,
    deductionMonthlyTotal,
    netMonthly,
    netAnnual,
  };
}
