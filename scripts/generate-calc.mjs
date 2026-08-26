#!/usr/bin/env node
// data/rates.json 값을 읽어서 js/calc.js 를 생성한다.
// 실행: node scripts/generate-calc.mjs
// (rates.json이 바뀔 때마다 반드시 이 스크립트를 다시 실행해서 js/calc.js를 갱신해야 한다.)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const rates = JSON.parse(readFileSync(path.join(ROOT, "data", "rates.json"), "utf-8"));

// 장기요양보험료율은 "건강보험료 대비 비율"로 계산에 사용한다.
// (건강보험공단이 발표하는 두 개의 소득 대비 총 요율로부터 역산)
const longTermCareRatioOfHealth =
  Math.round((rates.health.longTermCareTotalIncomeRate / rates.health.totalRate) * 1e6) / 1e6;

function bracketsToJs(brackets) {
  return brackets
    .map((b) => {
      const limit = b.limit === null ? "Infinity" : b.limit;
      return `  { limit: ${limit}, rate: ${b.rate}, deduction: ${b.deduction} },`;
    })
    .join("\n");
}

const output = `/*
  calc.js — 연봉 실수령액 계산 공식 모듈 (자동 생성 파일)

  ** 이 파일을 직접 수정하지 마세요. **
  이 파일은 scripts/generate-calc.mjs 가 data/rates.json 을 읽어서 자동으로 만듭니다.
  값을 고치려면 data/rates.json 을 수정한 뒤 "node scripts/generate-calc.mjs" 를 실행하세요.
  (매일 실행되는 GitHub Actions가 data/rates.json 변경을 감지하면 이 파일도 함께 갱신하여
   Pull Request를 만듭니다. scripts/check-rates.mjs, .github/workflows/check-rates.yml 참고)

  생성 시각: ${new Date().toISOString()}
  기준 데이터 검증일: ${rates.lastVerifiedAt}
*/

const RATES = {
  // 4대보험 요율 (근로자 부담분 기준)
  pension: ${rates.pension.employeeRate},          // 국민연금 ${(rates.pension.employeeRate * 100).toFixed(2)}%
  pensionMonthlyCap: ${rates.pension.monthlyCap}, // 국민연금 기준소득월액 상한액 (${rates.pension.appliedPeriod})
  pensionMonthlyFloor: ${rates.pension.monthlyFloor}, // 국민연금 기준소득월액 하한액
  health: ${rates.health.employeeRate},         // 건강보험 ${(rates.health.employeeRate * 100).toFixed(3)}% (근로자 부담분, ${rates.health.appliedYear}년 기준)
  longTermCareRate: ${longTermCareRatioOfHealth}, // 장기요양보험료율 (건강보험료의 ${(longTermCareRatioOfHealth * 100).toFixed(2)}%, 소득대비 ${(rates.health.longTermCareTotalIncomeRate * 100).toFixed(4)}% 기준 역산)
  employment: ${rates.employment.employeeRate},       // 고용보험 ${(rates.employment.employeeRate * 100).toFixed(2)}%

  // 근로소득세액공제 한도 구간 기준액
  taxCreditThreshold1: ${rates.earnedIncomeTaxCredit.threshold1},
  taxCreditThreshold2: ${rates.earnedIncomeTaxCredit.threshold2},
};

// 근로소득공제 (총급여 기준, 소득세법 제47조)
function earnedIncomeDeduction(gross) {
  if (gross <= 5000000) return gross * 0.7;
  if (gross <= 15000000) return 3500000 + (gross - 5000000) * 0.4;
  if (gross <= 45000000) return 7500000 + (gross - 15000000) * 0.15;
  if (gross <= 100000000) return 12000000 + (gross - 45000000) * 0.05;
  return 14750000 + (gross - 100000000) * 0.02;
}

// 종합소득세 기본세율 (소득세법 제55조, 과세표준 구간별 누진공제 방식)
const TAX_BRACKETS = [
${bracketsToJs(rates.taxBrackets)}
];

function calcIncomeTax(taxBase) {
  if (taxBase <= 0) return 0;
  const bracket = TAX_BRACKETS.find((b) => taxBase <= b.limit);
  return taxBase * bracket.rate - bracket.deduction;
}

// 근로소득세액공제 (산출세액 및 총급여 기준)
function earnedIncomeTaxCredit(calculatedTax, gross) {
  let credit;
  if (calculatedTax <= 1300000) {
    credit = calculatedTax * 0.55;
  } else {
    credit = 715000 + (calculatedTax - 1300000) * 0.3;
  }

  let limit;
  if (gross <= RATES.taxCreditThreshold1) {
    limit = 740000;
  } else if (gross <= RATES.taxCreditThreshold2) {
    limit = Math.max(740000 - (gross - RATES.taxCreditThreshold1) * 0.008, 660000);
  } else {
    limit = Math.max(660000 - (gross - RATES.taxCreditThreshold2) * 0.5, 500000);
  }
  return Math.min(credit, limit);
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
`;

writeFileSync(path.join(ROOT, "js", "calc.js"), output, "utf-8");
console.log("js/calc.js generated from data/rates.json");
