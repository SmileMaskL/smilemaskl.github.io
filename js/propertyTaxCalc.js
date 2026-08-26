/*
  재산세(주택분) 계산 - 2026년 기준 (지방세법 제111조, 지방세법 시행령)

  과세표준 = 공시가격 × 공정시장가액비율
    - 1세대1주택자: 공시가격 3억 이하 43%, 3억초과~6억이하 44%, 6억초과 45%
    - 그 외(다주택자 등): 60%
  세율: 1세대1주택자이면서 공시가격 9억원 이하면 특례세율, 그 외에는 표준세율
  지방교육세 = 산출세액 × 20%
  재산세 도시지역분 = 과세표준 × 0.14% (해당 지역에만 부과, 선택 항목)

  ※ 재산세 세부담 상한제(전년 대비 급증 방지)는 개별 이력이 필요해 이 계산기에는
  반영되지 않았습니다. 이 계산 항목은 근로소득세처럼 매년 자동으로 확인되는
  항목이 아니므로, 세율/특례 기준이 바뀌면 이 파일과 아래 표를 직접 수정해야
  합니다.
*/

const PROPERTY_STANDARD_BRACKETS = [
  { limit: 60000000, rate: 0.001, deduction: 0 },
  { limit: 150000000, rate: 0.0015, deduction: 30000 },
  { limit: 300000000, rate: 0.0025, deduction: 180000 },
  { limit: Infinity, rate: 0.004, deduction: 630000 },
];

const PROPERTY_SPECIAL_BRACKETS = [
  { limit: 60000000, rate: 0.0005, deduction: 0 },
  { limit: 150000000, rate: 0.001, deduction: 30000 },
  { limit: 300000000, rate: 0.002, deduction: 180000 },
  { limit: Infinity, rate: 0.0035, deduction: 630000 },
];

const SPECIAL_RATE_MAX_OFFICIAL_PRICE = 900000000; // 특례세율 적용 상한: 공시가격 9억원

function fairMarketRatioFor(officialPrice, isOneHousehold) {
  if (!isOneHousehold) return 0.6;
  if (officialPrice <= 300000000) return 0.43;
  if (officialPrice <= 600000000) return 0.44;
  return 0.45;
}

/**
 * @param {number} officialPrice 공시가격 (원)
 * @param {boolean} isOneHousehold 1세대 1주택 여부
 * @param {boolean} includeUrbanAreaTax 도시지역분 포함 여부
 */
function calculatePropertyTax(officialPrice, isOneHousehold, includeUrbanAreaTax) {
  const fairMarketRatio = fairMarketRatioFor(officialPrice, isOneHousehold);
  const taxBase = officialPrice * fairMarketRatio;

  const useSpecialRate = isOneHousehold && officialPrice <= SPECIAL_RATE_MAX_OFFICIAL_PRICE;
  const brackets = useSpecialRate ? PROPERTY_SPECIAL_BRACKETS : PROPERTY_STANDARD_BRACKETS;
  const bracket = brackets.find((b) => taxBase <= b.limit);
  const propertyTax = Math.max(taxBase * bracket.rate - bracket.deduction, 0);

  const localEducationTax = propertyTax * 0.2;
  const urbanAreaTax = includeUrbanAreaTax ? taxBase * 0.0014 : 0;
  const total = propertyTax + localEducationTax + urbanAreaTax;

  return {
    fairMarketRatio,
    taxBase: Math.round(taxBase),
    useSpecialRate,
    propertyTax: Math.round(propertyTax),
    localEducationTax: Math.round(localEducationTax),
    urbanAreaTax: Math.round(urbanAreaTax),
    total: Math.round(total),
  };
}
