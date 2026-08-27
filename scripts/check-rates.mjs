#!/usr/bin/env node
/*
  check-rates.mjs — 4대보험료율/세율표를 하루 3번 확인하고, 값이 바뀌면
  data/rates.json과 js/calc.js를 자동으로 갱신하는 스크립트.

  완전 자동 반영(PR 없이 바로 main에 커밋)을 전제로 만들어졌기 때문에, 아래
  안전장치를 여러 겹으로 둔다. 특히 종합소득세 세율표/근로소득공제/근로소득세액공제는
  숫자 하나만 잘못 읽어도 전체 이용자의 계산 결과가 틀어질 수 있어서 가장 엄격하게
  검증한다.

  1) 값 검증 (validate, validateBracketTable, 각 구간표의 "연속성" 검사)
     상식적인 범위를 벗어나거나, 구간표 내부적으로 앞뒤가 안 맞으면(연속되지
     않으면) 스크래핑 오류로 간주하고 절대 적용하지 않는다.

  2) 국민연금 보험료율은 스크래핑하지 않고 법정 스케줄을 날짜로 계산한다.
     (2025.3 국민연금법 개정: 2026년 9.5% → 매년 0.5%p 인상 → 2033년 13%)

  3) 세율표/공제표는 국가법령정보센터 원문을 그대로 옮겨 싣는 casenote.kr에서
     "조문 원문 그대로의 표현"(예: "1,400만원을 초과하는 금액의 15퍼센트")을
     정규식으로 파싱한다. 파싱한 결과가 내부적으로 앞뒤가 안 맞으면(연속되지
     않으면, 한도가 이상하면 등) 절대 적용하지 않는다.

  문제가 하나라도 있으면(스크래핑 실패, 검증 실패) 프로젝트 루트에
  Error_log_YYYY-MM-DD.txt 파일을 만들거나 이어 붙인다.

  로컬 실행: node scripts/check-rates.mjs
*/

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RATES_PATH = path.join(ROOT, "data", "rates.json");

const rates = JSON.parse(readFileSync(RATES_PATH, "utf-8"));

const CHANGES = [];
const FAILURES = [];

function reportChange(field, oldValue, newValue, source) {
  CHANGES.push({ field, oldValue, newValue, source });
}
function reportFailure(field, reason) {
  FAILURES.push({ field, reason });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GitHub Actions 서버(클라우드 데이터센터 IP)는 일부 정부/법령 사이트에서
// 일반 가정용/회사 IP보다 더 자주 차단·타임아웃될 수 있다. 그래서 실제
// 브라우저에 가까운 헤더를 보내고, 실패 시 한 번 더 재시도한다.
async function fetchOnce(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  } finally {
    clearTimeout(timeout);
  }
}

function describeFetchError(e) {
  const cause = e && e.cause;
  const causeCode = cause && (cause.code || cause.name);
  return causeCode ? `${e.message} (원인: ${causeCode})` : e.message;
}

async function fetchText(url) {
  try {
    return await fetchOnce(url);
  } catch (e) {
    await sleep(3000);
    try {
      return await fetchOnce(url);
    } catch (e2) {
      throw new Error(describeFetchError(e2));
    }
  }
}

// ---------- 공용 파서 ----------

// "1억5천만원", "1천 200만원", "71만5천원" 같은 한글 혼용 금액 표기를 숫자로 변환.
function parseSubManGroup(s) {
  let total = 0;
  let m;
  if ((m = s.match(/^([0-9]+)천/))) {
    total += Number(m[1]) * 1000;
    s = s.slice(m[0].length);
  }
  if ((m = s.match(/^([0-9]+)백/))) {
    total += Number(m[1]) * 100;
    s = s.slice(m[0].length);
  }
  if ((m = s.match(/^([0-9]+)/))) {
    total += Number(m[1]);
  }
  return total;
}

function koreanWonToNumber(raw) {
  let s = raw.replace(/[,\s]/g, "").replace(/원\s*$/, "");
  let total = 0;
  let m;
  if ((m = s.match(/^([0-9]+)억/))) {
    total += Number(m[1]) * 1e8;
    s = s.slice(m[0].length);
  }
  if ((m = s.match(/^(.*?)만/))) {
    total += parseSubManGroup(m[1]) * 1e4;
    s = s.slice(m[0].length);
  }
  total += parseSubManGroup(s);
  return total;
}

// "100분의 40" 또는 "40퍼센트"/"40%" 형태를 0.4로 변환.
function parseRateToken(s) {
  let m = s.match(/100분의\s*([0-9]+(?:\.[0-9]+)?)/);
  if (m) return Number(m[1]) / 100;
  m = s.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:%|퍼센트)/);
  if (m) return Number(m[1]) / 100;
  return null;
}

const AMOUNT = "[0-9,억천백만\\s]+원";
const RATE_EXPR = "(?:100분의\\s*[0-9]+(?:\\.[0-9]+)?|[0-9]+(?:\\.[0-9]+)?\\s*(?:%|퍼센트))";
// "84만원 + (1,400만원을 초과하는 금액의 15퍼센트)" / "350만원＋(500만원을 초과하는 금액의 100분의 40)"
const clauseRe = new RegExp(
  `(${AMOUNT})\\s*[+＋]\\s*\\((${AMOUNT})을\\s*초과하는\\s*금액의\\s*(${RATE_EXPR})\\)`,
  "g"
);

// 조문 페이지는 <title>/브레드크럼에 조문 제목이 한 번 더 나오고(예: 페이지 맨 앞
// "소득세법 제55조(세율) - CaseNote"), 페이지 하단에 같은 조문이 통째로 반복
// 게재되기도 한다. 그래서 맨 앞부분(skipBefore 이내)의 매치는 무시하고, 실제
// 본문에 해당하는 첫 매치부터 그다음 매치(중복 시작점) 또는 maxLen 까지만 잘라
// 사용한다.
function extractWindow(text, anchor, maxLen, skipBefore = 50) {
  const indices = [];
  let idx = text.indexOf(anchor);
  while (idx !== -1) {
    indices.push(idx);
    idx = text.indexOf(anchor, idx + anchor.length);
  }
  const real = indices.filter((i) => i >= skipBefore);
  if (real.length === 0) return null;
  const start = real[0];
  let end = real.length > 1 ? real[1] : start + maxLen;
  if (end - start > maxLen) end = start + maxLen;
  return text.slice(start, end);
}

// 누진 구간표를 "value*rate - deduction" 형태로 역산해서 만든다.
// (법령 원문은 "기준액 + (기준을 초과한 금액의 N%)" 형태라 연속성을 이용해 변환)
function buildProgressiveBrackets(firstRate, clauses) {
  const sorted = [...clauses].sort((a, b) => a.threshold - b.threshold);
  const brackets = [{ limit: sorted[0].threshold, rate: firstRate, deduction: 0 }];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const deduction = Math.round(c.threshold * c.rate - c.base);
    const limit = i + 1 < sorted.length ? sorted[i + 1].threshold : Infinity;
    brackets.push({ limit, rate: c.rate, deduction });
  }
  return brackets;
}

// 구간표가 내부적으로 앞뒤가 맞는지 검사. 문제 있으면 이유 문자열, 없으면 null.
function validateBracketTable(brackets, direction) {
  if (!Array.isArray(brackets) || brackets.length < 3) return "구간 개수가 너무 적음";
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    if (typeof b.rate !== "number" || !(b.rate > 0) || !(b.rate < 1))
      return `구간 ${i} rate 비정상: ${b.rate}`;
    if (i < brackets.length - 1) {
      if (typeof b.limit !== "number" || !(b.limit > 0)) return `구간 ${i} limit 비정상`;
      if (i > 0 && b.limit <= brackets[i - 1].limit) return `구간 ${i} limit이 증가하지 않음`;
    } else if (b.limit !== Infinity) {
      return "마지막 구간의 limit은 Infinity여야 함";
    }
    if (i > 0) {
      const prevRate = brackets[i - 1].rate;
      if (direction === "increasing" && b.rate <= prevRate) return `구간 ${i} rate가 증가하지 않음`;
      if (direction === "decreasing" && b.rate >= prevRate) return `구간 ${i} rate가 감소하지 않음`;
    }
  }
  return null;
}

function bracketsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function toComparable(brackets) {
  return brackets.map((b) => ({
    limit: b.limit === null ? Infinity : b.limit,
    rate: b.rate,
    deduction: b.deduction,
  }));
}

// 값이 상식적인 범위/변동폭 안에 있는지 검사한다. 벗어나면 스크래핑 오류로 간주하고 버린다.
function validate(field, oldValue, newValue, { min, max, maxDeltaRatio }) {
  if (newValue < min || newValue > max) {
    reportFailure(field, `검증 실패 - 값이 상식 범위(${min}~${max})를 벗어남: ${newValue}`);
    return false;
  }
  if (oldValue > 0) {
    const ratio = newValue / oldValue;
    if (ratio > 1 + maxDeltaRatio || ratio < 1 - maxDeltaRatio) {
      reportFailure(
        field,
        `검증 실패 - 기존값(${oldValue}) 대비 변동폭이 비정상적으로 큼 → ${newValue} (스크래핑 오류 의심)`
      );
      return false;
    }
  }
  return true;
}

// ---------- 1) 국민연금 보험료율: 법정 인상 스케줄로 계산 ----------
function checkPensionRateBySchedule() {
  const REFORM_START_YEAR = 2026;
  const REFORM_START_TOTAL_RATE = 0.095;
  const STEP_PER_YEAR = 0.005;
  const CAP_YEAR = 2033;
  const CAP_TOTAL_RATE = 0.13;
  const PRE_REFORM_TOTAL_RATE = 0.09;

  const year = new Date().getUTCFullYear();
  let expectedTotal;
  if (year < REFORM_START_YEAR) {
    expectedTotal = PRE_REFORM_TOTAL_RATE;
  } else if (year >= CAP_YEAR) {
    expectedTotal = CAP_TOTAL_RATE;
  } else {
    expectedTotal = REFORM_START_TOTAL_RATE + STEP_PER_YEAR * (year - REFORM_START_YEAR);
  }
  expectedTotal = Math.round(expectedTotal * 10000) / 10000;
  const expectedEmployee = Math.round((expectedTotal / 2) * 10000) / 10000;

  if (Math.abs(expectedTotal - rates.pension.totalRate) > 0.00001) {
    reportChange(
      "pension.totalRate / employeeRate",
      `${rates.pension.totalRate} / ${rates.pension.employeeRate}`,
      `${expectedTotal} / ${expectedEmployee}`,
      "국민연금법 개정 법정 인상 스케줄 (2025.3 개정, 매년 1/1 0.5%p 인상)"
    );
    rates.pension.totalRate = expectedTotal;
    rates.pension.employeeRate = expectedEmployee;
  }
}

// ---------- 2) 국민연금 기준소득월액 상/하한액 ----------
async function checkPensionLimits() {
  const url = rates.pension.limitsSource;
  try {
    const text = await fetchText(url);
    // 4insure.or.kr 문구 기준: "(최저) 41만원 / (최고) 659만원" 형태 (단위: 만원)
    const floorMatches = [...text.matchAll(/최저[^0-9]{0,10}([0-9]{1,4})\s*만원/g)].map(
      (m) => Number(m[1]) * 10000
    );
    const capMatches = [...text.matchAll(/최고[^0-9]{0,10}([0-9]{1,4})\s*만원/g)].map(
      (m) => Number(m[1]) * 10000
    );
    const cap = capMatches.length ? Math.max(...capMatches) : null;
    const floor = floorMatches.length ? Math.max(...floorMatches) : null;

    if (
      cap &&
      cap !== rates.pension.monthlyCap &&
      validate("pension.monthlyCap", rates.pension.monthlyCap, cap, { min: 3000000, max: 15000000, maxDeltaRatio: 0.3 })
    ) {
      reportChange("pension.monthlyCap", rates.pension.monthlyCap, cap, url);
      rates.pension.monthlyCap = cap;
    }
    if (
      floor &&
      floor !== rates.pension.monthlyFloor &&
      validate("pension.monthlyFloor", rates.pension.monthlyFloor, floor, { min: 100000, max: 1000000, maxDeltaRatio: 0.3 })
    ) {
      reportChange("pension.monthlyFloor", rates.pension.monthlyFloor, floor, url);
      rates.pension.monthlyFloor = floor;
    }
    if (!cap && !floor) reportFailure("pension.limits", "페이지에서 최저/최고 금액 패턴을 찾지 못함");
  } catch (e) {
    reportFailure("pension.limits", `fetch 실패: ${e.message}`);
  }
}

// ---------- 3) 건강보험료율 / 장기요양보험료율 ----------
async function checkHealth() {
  const url = rates.health.source;
  try {
    const text = await fetchText(url);
    const m = text.match(new RegExp(`건강보험료율[^%]{0,25}?([0-9]\\.[0-9]{1,4})\\s*%`));
    if (m) {
      const total = Number(m[1]) / 100;
      if (
        Math.abs(total - rates.health.totalRate) > 0.00001 &&
        validate("health.totalRate", rates.health.totalRate, total, { min: 0.03, max: 0.15, maxDeltaRatio: 0.15 })
      ) {
        reportChange("health.totalRate", rates.health.totalRate, total, url);
        rates.health.totalRate = total;
        rates.health.employeeRate = Math.round((total / 2) * 100000) / 100000;
      }
    } else {
      reportFailure("health.totalRate", "페이지에서 건강보험료율(%) 패턴을 찾지 못함");
    }
  } catch (e) {
    reportFailure("health.totalRate", `fetch 실패: ${e.message}`);
  }

  const ltcUrl = rates.health.longTermCareSource;
  try {
    const text = await fetchText(ltcUrl);
    const m = text.match(new RegExp(`장기요양보험료율[^%]{0,25}?([0-9]\\.[0-9]{1,4})\\s*%`));
    if (m) {
      const ltc = Number(m[1]) / 100;
      if (
        Math.abs(ltc - rates.health.longTermCareTotalIncomeRate) > 0.000001 &&
        validate("health.longTermCareTotalIncomeRate", rates.health.longTermCareTotalIncomeRate, ltc, {
          min: 0.003,
          max: 0.02,
          maxDeltaRatio: 0.3,
        })
      ) {
        reportChange("health.longTermCareTotalIncomeRate", rates.health.longTermCareTotalIncomeRate, ltc, ltcUrl);
        rates.health.longTermCareTotalIncomeRate = ltc;
      }
    } else {
      reportFailure("health.longTermCare", "페이지에서 장기요양보험료율(%) 패턴을 찾지 못함");
    }
  } catch (e) {
    reportFailure("health.longTermCare", `fetch 실패: ${e.message}`);
  }
}

// ---------- 4) 고용보험료율 (4대사회보험 정보연계센터) ----------
async function checkEmploymentRate() {
  const url = rates.employment.source;
  try {
    const text = await fetchText(url);
    const m = text.match(/실업급여\s*\([^)]*\)\s*([0-9]+(?:\.[0-9]+)?)\s*%/);
    if (!m) {
      reportFailure("employment.employeeRate", "페이지에서 실업급여 요율 패턴을 찾지 못함");
      return;
    }
    const rate = Number(m[1]) / 100;
    if (
      Math.abs(rate - rates.employment.employeeRate) > 0.00001 &&
      validate("employment.employeeRate", rates.employment.employeeRate, rate, { min: 0.001, max: 0.05, maxDeltaRatio: 0.5 })
    ) {
      reportChange("employment.employeeRate", rates.employment.employeeRate, rate, url);
      rates.employment.employeeRate = rate;
    }
  } catch (e) {
    reportFailure("employment.employeeRate", `fetch 실패: ${e.message}`);
  }
}

// ---------- 5) 종합소득세 세율표 (소득세법 제55조) ----------
async function checkTaxBrackets() {
  const url = rates.taxBracketsSource;
  try {
    const text = await fetchText(url);
    const win = extractWindow(text, "제55조(세율)", 2500);
    if (!win) {
      reportFailure("taxBrackets", "제55조 본문을 찾지 못함");
      return;
    }
    const firstMatch = win.match(new RegExp(`과세표준의\\s*(${RATE_EXPR})`));
    const clauseMatches = [...win.matchAll(clauseRe)];
    if (!firstMatch || clauseMatches.length < 3) {
      reportFailure(
        "taxBrackets",
        `구조 파싱 실패 (첫 구간 매치=${!!firstMatch}, 나머지 구간 수=${clauseMatches.length})`
      );
      return;
    }
    const firstRate = parseRateToken(firstMatch[1]);
    const clauses = clauseMatches.map((m) => ({
      base: koreanWonToNumber(m[1]),
      threshold: koreanWonToNumber(m[2]),
      rate: parseRateToken(m[3]),
    }));
    const brackets = buildProgressiveBrackets(firstRate, clauses);
    const err = validateBracketTable(brackets, "increasing");
    if (err) {
      reportFailure("taxBrackets", `검증 실패: ${err}`);
      return;
    }
    const current = toComparable(rates.taxBrackets);
    if (!bracketsEqual(brackets, current)) {
      reportChange("taxBrackets", "(기존 세율표)", "(새 세율표 - data/rates.json 참고)", url);
      rates.taxBrackets = brackets.map((b) => ({
        limit: b.limit === Infinity ? null : b.limit,
        rate: b.rate,
        deduction: b.deduction,
      }));
    }
  } catch (e) {
    reportFailure("taxBrackets", `fetch/파싱 실패: ${e.message}`);
  }
}

// ---------- 6) 근로소득공제 구간 (소득세법 제47조) ----------
async function checkEarnedIncomeDeduction() {
  const url = rates.earnedIncomeDeduction.source;
  try {
    const text = await fetchText(url);
    const win = extractWindow(text, "제47조(근로소득공제)", 1800);
    if (!win) {
      reportFailure("earnedIncomeDeduction", "제47조 본문을 찾지 못함");
      return;
    }
    const firstMatch = win.match(new RegExp(`총\\s*급여액의\\s*(${RATE_EXPR})`));
    const clauseMatches = [...win.matchAll(clauseRe)];
    const capMatch = win.match(new RegExp(`공제액이\\s*(${AMOUNT})을\\s*초과하는\\s*경우에는\\s*(${AMOUNT})`));

    if (!firstMatch || clauseMatches.length < 2) {
      reportFailure(
        "earnedIncomeDeduction",
        `구조 파싱 실패 (첫 구간 매치=${!!firstMatch}, 나머지 구간 수=${clauseMatches.length})`
      );
      return;
    }
    const firstRate = parseRateToken(firstMatch[1]);
    const clauses = clauseMatches.map((m) => ({
      base: koreanWonToNumber(m[1]),
      threshold: koreanWonToNumber(m[2]),
      rate: parseRateToken(m[3]),
    }));
    const brackets = buildProgressiveBrackets(firstRate, clauses);
    const err = validateBracketTable(brackets, "decreasing");
    if (err) {
      reportFailure("earnedIncomeDeduction", `검증 실패: ${err}`);
      return;
    }
    const current = toComparable(rates.earnedIncomeDeduction.brackets);
    if (!bracketsEqual(brackets, current)) {
      reportChange("earnedIncomeDeduction.brackets", "(기존 표)", "(새 표 - data/rates.json 참고)", url);
      rates.earnedIncomeDeduction.brackets = brackets.map((b) => ({
        limit: b.limit === Infinity ? null : b.limit,
        rate: b.rate,
        deduction: b.deduction,
      }));
    }

    if (capMatch) {
      const maxDeduction = koreanWonToNumber(capMatch[2]);
      if (
        maxDeduction !== rates.earnedIncomeDeduction.maxDeduction &&
        validate("earnedIncomeDeduction.maxDeduction", rates.earnedIncomeDeduction.maxDeduction, maxDeduction, {
          min: 5000000,
          max: 50000000,
          maxDeltaRatio: 0.5,
        })
      ) {
        reportChange("earnedIncomeDeduction.maxDeduction", rates.earnedIncomeDeduction.maxDeduction, maxDeduction, url);
        rates.earnedIncomeDeduction.maxDeduction = maxDeduction;
      }
    } else {
      reportFailure("earnedIncomeDeduction.maxDeduction", "공제 한도(2천만원) 문구를 찾지 못함");
    }
  } catch (e) {
    reportFailure("earnedIncomeDeduction", `fetch/파싱 실패: ${e.message}`);
  }
}

// ---------- 7) 근로소득세액공제 (소득세법 제59조) ----------
async function checkEarnedIncomeTaxCredit() {
  const url = rates.earnedIncomeTaxCredit.source;
  try {
    const text = await fetchText(url);
    const win = extractWindow(text, "제59조(근로소득세액공제)", 2200);
    if (!win) {
      reportFailure("earnedIncomeTaxCredit", "제59조 본문을 찾지 못함");
      return;
    }

    // 7-1) 산출세액 구간 (55%/30% 등)
    const firstMatch = win.match(new RegExp(`산출세액의\\s*(${RATE_EXPR})`));
    const clauseMatches = [...win.matchAll(clauseRe)];
    if (firstMatch && clauseMatches.length >= 1) {
      const rateLow = parseRateToken(firstMatch[1]);
      const c = clauseMatches[0];
      const bracketLimit = koreanWonToNumber(c[2]);
      const baseAtBracketLimit = koreanWonToNumber(c[1]);
      const rateHigh = parseRateToken(c[3]);
      const partValid =
        rateLow > 0 && rateLow < 1 && rateHigh > 0 && rateHigh < 1 && bracketLimit > 0 && baseAtBracketLimit > 0;
      if (!partValid) {
        reportFailure("earnedIncomeTaxCredit.rate", "산출세액 구간 값 검증 실패");
      } else if (
        rateLow !== rates.earnedIncomeTaxCredit.rateLow ||
        rateHigh !== rates.earnedIncomeTaxCredit.rateHigh ||
        bracketLimit !== rates.earnedIncomeTaxCredit.bracketLimit ||
        baseAtBracketLimit !== rates.earnedIncomeTaxCredit.baseAtBracketLimit
      ) {
        reportChange(
          "earnedIncomeTaxCredit.{rateLow,rateHigh,bracketLimit,baseAtBracketLimit}",
          JSON.stringify({
            rateLow: rates.earnedIncomeTaxCredit.rateLow,
            rateHigh: rates.earnedIncomeTaxCredit.rateHigh,
            bracketLimit: rates.earnedIncomeTaxCredit.bracketLimit,
            baseAtBracketLimit: rates.earnedIncomeTaxCredit.baseAtBracketLimit,
          }),
          JSON.stringify({ rateLow, rateHigh, bracketLimit, baseAtBracketLimit }),
          url
        );
        Object.assign(rates.earnedIncomeTaxCredit, { rateLow, rateHigh, bracketLimit, baseAtBracketLimit });
      }
    } else {
      reportFailure("earnedIncomeTaxCredit.rate", "산출세액 구간(55%/30% 등) 파싱 실패");
    }

    // 7-2) 총급여 구간별 공제 한도 (4단계)
    const tier1Re = new RegExp(`총급여액이\\s*(${AMOUNT})\\s*이하인\\s*경우:\\s*(${AMOUNT})`);
    const tier23Re = new RegExp(
      `총급여액이\\s*(${AMOUNT})\\s*초과\\s*(${AMOUNT})\\s*이하인\\s*경우:\\s*(${AMOUNT})\\s*-\\s*\\[\\(총급여액\\s*-\\s*(${AMOUNT})\\)\\s*[×xX]\\s*([0-9]+)\\s*/\\s*([0-9]+)\\]\\.?\\s*다만,?\\s*위\\s*금액이\\s*(${AMOUNT})보다\\s*적은\\s*경우에는\\s*(${AMOUNT})으로\\s*한다`,
      "g"
    );
    const tier4Re = new RegExp(
      `총급여액이\\s*(${AMOUNT})을\\s*초과하는\\s*경우:\\s*(${AMOUNT})\\s*-\\s*\\[\\(총급여액\\s*-\\s*(${AMOUNT})\\)\\s*[×xX]\\s*([0-9]+)\\s*/\\s*([0-9]+)\\]\\.?\\s*다만,?\\s*위\\s*금액이\\s*(${AMOUNT})보다\\s*적은\\s*경우에는\\s*(${AMOUNT})으로\\s*한다`
    );

    const t1 = win.match(tier1Re);
    const t23 = [...win.matchAll(tier23Re)];
    const t4 = win.match(tier4Re);

    if (!t1 || t23.length !== 2 || !t4) {
      reportFailure(
        "earnedIncomeTaxCredit.limitTiers",
        `4단계 한도표 파싱 실패 (1단계=${!!t1}, 2/3단계 개수=${t23.length}, 4단계=${!!t4})`
      );
      return;
    }

    const maxGross1 = koreanWonToNumber(t1[1]);
    const amount1 = koreanWonToNumber(t1[2]);

    function buildMidTier(m) {
      return {
        maxGross: koreanWonToNumber(m[2]),
        threshold: koreanWonToNumber(m[1]),
        base: koreanWonToNumber(m[3]),
        rate: Number(m[5]) / Number(m[6]),
        floor: koreanWonToNumber(m[8]),
      };
    }
    const tier2 = buildMidTier(t23[0]);
    const tier3 = buildMidTier(t23[1]);
    const tier4 = {
      maxGross: null,
      threshold: koreanWonToNumber(t4[1]),
      base: koreanWonToNumber(t4[2]),
      rate: Number(t4[4]) / Number(t4[5]),
      floor: koreanWonToNumber(t4[6]),
    };

    const continuityOk =
      maxGross1 === tier2.threshold &&
      tier2.maxGross === tier3.threshold &&
      tier3.maxGross === tier4.threshold &&
      amount1 === tier2.base &&
      tier2.floor === tier3.base &&
      tier3.floor === tier4.base &&
      tier2.rate > 0 &&
      tier2.rate < 1 &&
      tier3.rate > 0 &&
      tier3.rate < 1 &&
      tier4.rate > 0 &&
      tier4.rate < 1 &&
      maxGross1 < tier2.maxGross &&
      tier2.maxGross < tier3.maxGross;

    if (!continuityOk) {
      reportFailure("earnedIncomeTaxCredit.limitTiers", "4단계 한도표 값들의 연속성 검증 실패 (스크래핑 오류 의심)");
      return;
    }

    const newTiers = [{ maxGross: maxGross1, amount: amount1 }, tier2, tier3, tier4];
    if (JSON.stringify(newTiers) !== JSON.stringify(rates.earnedIncomeTaxCredit.limitTiers)) {
      reportChange("earnedIncomeTaxCredit.limitTiers", "(기존 4단계 표)", "(새 4단계 표 - data/rates.json 참고)", url);
      rates.earnedIncomeTaxCredit.limitTiers = newTiers;
    }
  } catch (e) {
    reportFailure("earnedIncomeTaxCredit", `fetch/파싱 실패: ${e.message}`);
  }
}

function writeErrorLogIfNeeded(today, nowLabel) {
  if (FAILURES.length === 0) return;
  const logPath = path.join(ROOT, `Error_log_${today}.txt`);
  const lines = [];
  lines.push(`[${nowLabel}] 요율 자동 확인 중 문제 발견`);
  for (const f of FAILURES) {
    lines.push(`  - ${f.field}: ${f.reason}`);
  }
  lines.push("  → 보통 정부/법령 사이트의 문구·구조가 바뀌어서 생깁니다.");
  lines.push("    scripts/check-rates.mjs의 정규식이나 data/rates.json의 source 링크를 확인해 손봐주세요.");
  lines.push("    (수정가이드.txt 참고)");
  lines.push("");
  appendFileSync(logPath, lines.join("\n") + "\n", "utf-8");
}

async function main() {
  checkPensionRateBySchedule();
  await checkPensionLimits();
  await checkHealth();
  await checkEmploymentRate();
  await checkTaxBrackets();
  await checkEarnedIncomeDeduction();
  await checkEarnedIncomeTaxCredit();

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nowLabel = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const changed = CHANGES.length > 0;

  if (changed) {
    rates.lastVerifiedAt = today;
    rates.lastVerifiedBy = "scripts/check-rates.mjs (완전 자동 반영)";
    writeFileSync(RATES_PATH, JSON.stringify(rates, null, 2) + "\n", "utf-8");
    execSync("node scripts/generate-calc.mjs", { cwd: ROOT, stdio: "inherit" });
  }

  writeErrorLogIfNeeded(today, nowLabel);

  const lines = [];
  lines.push(`# 요율 확인 결과 (${nowLabel})`);
  lines.push("");
  if (changed) {
    lines.push("## 값이 바뀌어 자동으로 반영함");
    for (const c of CHANGES) {
      lines.push(`- **${c.field}**: ${c.oldValue} → ${c.newValue}  (근거: ${c.source})`);
    }
  } else {
    lines.push("변경 사항 없음.");
  }
  if (FAILURES.length) {
    lines.push("");
    lines.push(`## 문제 발생 (Error_log_${today}.txt 에 기록됨)`);
    for (const f of FAILURES) lines.push(`- ${f.field}: ${f.reason}`);
  }
  const summary = lines.join("\n") + "\n";
  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

main();
