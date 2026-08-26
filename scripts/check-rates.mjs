#!/usr/bin/env node
/*
  check-rates.mjs — 4대보험료율/기준소득월액을 하루 3번 확인하고, 값이 바뀌면
  data/rates.json과 js/calc.js를 자동으로 갱신하는 스크립트.

  이 버전은 "완전 자동 반영"을 위해 만들어졌다 (PR 없이 바로 main에 반영).
  대신 스크래핑 오류로 잘못된 숫자가 조용히 사이트에 올라가는 사고를 막기 위해,
  아래 두 가지 안전장치를 둔다.

  1) 값 검증 (validateXxx 함수들)
     보험료율/기준소득월액은 하루아침에 몇 배씩 뛰지 않는다. 정부 사이트 구조가
     바뀌어 엉뚱한 숫자를 긁어오면(예: 페이지의 다른 숫자를 %로 착각) 상식적인
     범위를 벗어나므로, 그런 값은 "검증 실패"로 버리고 절대 적용하지 않는다.
     (버리는 것도 실패로 기록되어 Error_log에 남는다.)

  2) 국민연금 보험료율은 스크래핑하지 않고 법정 스케줄을 날짜로 계산한다.
     2025.3 국민연금법 개정으로 "2026년 9.5% → 매년 0.5%p 인상 → 2033년 13%"가
     이미 법에 정해져 있어서, 페이지를 긁는 것보다 계산이 훨씬 정확하고 안전하다.

  문제가 하나라도 있으면(스크래핑 실패, 검증 실패) 프로젝트 루트에
  Error_log_YYYY-MM-DD.txt 파일을 만들거나 이어 붙인다. 이 파일이 있다는 것은
  "사람이 한 번 열어봐야 한다"는 신호다 — 대개는 정부 사이트 구조가 바뀌어서
  scripts/check-rates.mjs의 정규식을 손봐야 하는 경우다.

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
const NOTES = [];

function reportChange(field, oldValue, newValue, source) {
  CHANGES.push({ field, oldValue, newValue, source });
}
function reportFailure(field, reason) {
  FAILURES.push({ field, reason });
}
function reportNote(text) {
  NOTES.push(text);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  } finally {
    clearTimeout(timeout);
  }
}

function parseWon(str) {
  return Number(str.replace(/,/g, ""));
}

function extractPercent(text, keyword) {
  const re = new RegExp(`${keyword}[^%]{0,25}?([0-9]\\.[0-9]{1,4})\\s*%`);
  const m = text.match(re);
  return m ? Number(m[1]) / 100 : null;
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

// --- 국민연금 보험료율: 법정 인상 스케줄로 계산 (스크래핑 대신 날짜 계산) ---
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

// 상한액/하한액은 값이 커지는 방향으로만 바뀌므로, 페이지에서 찾은 값 중 최댓값을 채택한다.
async function checkPensionLimits() {
  const url = rates.pension.limitsSource;
  try {
    const text = await fetchText(url);
    const floorMatches = [...text.matchAll(/하한액[^0-9]{0,15}([0-9]{2,3}(?:,[0-9]{3})+)\s*원/g)].map(
      (m) => parseWon(m[1])
    );
    const capMatches = [...text.matchAll(/상한액[^0-9]{0,15}([0-9]{2,3}(?:,[0-9]{3})+)\s*원/g)].map(
      (m) => parseWon(m[1])
    );
    const cap = capMatches.length ? Math.max(...capMatches) : null;
    const floor = floorMatches.length ? Math.max(...floorMatches) : null;

    if (cap && cap !== rates.pension.monthlyCap) {
      if (validate("pension.monthlyCap", rates.pension.monthlyCap, cap, {
        min: 3000000,
        max: 15000000,
        maxDeltaRatio: 0.3,
      })) {
        reportChange("pension.monthlyCap", rates.pension.monthlyCap, cap, url);
        rates.pension.monthlyCap = cap;
      }
    }
    if (floor && floor !== rates.pension.monthlyFloor) {
      if (validate("pension.monthlyFloor", rates.pension.monthlyFloor, floor, {
        min: 100000,
        max: 1000000,
        maxDeltaRatio: 0.3,
      })) {
        reportChange("pension.monthlyFloor", rates.pension.monthlyFloor, floor, url);
        rates.pension.monthlyFloor = floor;
      }
    }
    if (!cap && !floor) reportFailure("pension.limits", "페이지에서 상한액/하한액 패턴을 찾지 못함");
  } catch (e) {
    reportFailure("pension.limits", `fetch 실패: ${e.message}`);
  }
}

async function checkHealth() {
  const url = rates.health.source;
  try {
    const text = await fetchText(url);
    const total = extractPercent(text, "건강보험료율");
    if (total && Math.abs(total - rates.health.totalRate) > 0.00001) {
      if (validate("health.totalRate", rates.health.totalRate, total, {
        min: 0.03,
        max: 0.15,
        maxDeltaRatio: 0.15,
      })) {
        reportChange("health.totalRate", rates.health.totalRate, total, url);
        rates.health.totalRate = total;
        rates.health.employeeRate = Math.round((total / 2) * 100000) / 100000;
      }
    }
    if (!total) reportFailure("health.totalRate", "페이지에서 건강보험료율(%) 패턴을 찾지 못함");
  } catch (e) {
    reportFailure("health.totalRate", `fetch 실패: ${e.message}`);
  }

  const ltcUrl = rates.health.longTermCareSource;
  try {
    const text = await fetchText(ltcUrl);
    const ltc = extractPercent(text, "장기요양보험료율");
    if (ltc && Math.abs(ltc - rates.health.longTermCareTotalIncomeRate) > 0.000001) {
      if (validate("health.longTermCareTotalIncomeRate", rates.health.longTermCareTotalIncomeRate, ltc, {
        min: 0.003,
        max: 0.02,
        maxDeltaRatio: 0.3,
      })) {
        reportChange(
          "health.longTermCareTotalIncomeRate",
          rates.health.longTermCareTotalIncomeRate,
          ltc,
          ltcUrl
        );
        rates.health.longTermCareTotalIncomeRate = ltc;
      }
    }
    if (!ltc) reportFailure("health.longTermCare", "페이지에서 장기요양보험료율(%) 패턴을 찾지 못함");
  } catch (e) {
    reportFailure("health.longTermCare", `fetch 실패: ${e.message}`);
  }
}

function checkEmploymentManualReminder() {
  if (rates.employment.autoCheck === false) {
    reportNote(
      `[수동 확인 필요] 고용보험료율(현재 ${(rates.employment.employeeRate * 100).toFixed(
        2
      )}%)은 자동확인 대상이 아닙니다. ${rates.employment.source} 에서 매년 1월 직접 확인하세요.`
    );
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
  lines.push(
    "  → 보통 정부 사이트의 문구/구조가 바뀌어서 생깁니다. scripts/check-rates.mjs의"
  );
  lines.push(
    "    정규식 패턴이나 data/rates.json의 source 링크를 확인해 손봐주세요. (수정가이드.txt 3번 참고)"
  );
  lines.push("");
  appendFileSync(logPath, lines.join("\n") + "\n", "utf-8");
}

async function main() {
  checkPensionRateBySchedule();
  await checkPensionLimits();
  await checkHealth();
  checkEmploymentManualReminder();

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
  if (NOTES.length) {
    lines.push("");
    lines.push("## 안내");
    for (const n of NOTES) lines.push(`- ${n}`);
  }
  const summary = lines.join("\n") + "\n";
  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

main();
