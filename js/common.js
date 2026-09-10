/*
  common.js — 모든 페이지가 공유하는 기능
  다크모드, 결과 공유하기, 인쇄하기, "마지막 입력값 기억하기"
  전부 브라우저 안에서만 동작하며 서버/외부 서비스를 쓰지 않아 완전히 무료입니다.
*/

function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.getAttribute("data-theme") === "dark";
  if (isDark) {
    root.removeAttribute("data-theme");
    try { localStorage.setItem("theme", "light"); } catch (e) {}
  } else {
    root.setAttribute("data-theme", "dark");
    try { localStorage.setItem("theme", "dark"); } catch (e) {}
  }
  updateThemeToggleIcon();
}

function updateThemeToggleIcon() {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  btn.textContent = isDark ? "☀️" : "🌙";
}

document.addEventListener("DOMContentLoaded", updateThemeToggleIcon);

function shareCurrentPage(message) {
  const url = window.location.href;
  const shareData = { title: document.title, text: message || document.title, url };
  if (navigator.share) {
    navigator.share(shareData).catch(function () {});
    return;
  }
  if (navigator.clipboard) {
    navigator.clipboard
      .writeText(url)
      .then(function () {
        alert("링크가 복사되었습니다! 친구에게 공유해보세요.");
      })
      .catch(function () {
        prompt("아래 링크를 복사하세요:", url);
      });
  } else {
    prompt("아래 링크를 복사하세요:", url);
  }
}

function printPage() {
  window.print();
}

// 계산기별 마지막 입력값을 기억해뒀다가 다음 방문 때 자동으로 채워준다.
function saveLastInput(key, data) {
  try {
    localStorage.setItem("lastInput:" + key, JSON.stringify(data));
  } catch (e) {}
}

function loadLastInput(key) {
  try {
    const raw = localStorage.getItem("lastInput:" + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// ===== 쿠팡파트너스 자동 노출 위젯 =====
// 1) https://partners.coupang.com 로그인 → 배너 관리 → 위젯 만들기에서
//    캐러셀 위젯을 만들면 id(숫자)와 trackingCode(AF로 시작)를 받습니다.
// 2) 아래 세 값을 그 값으로 바꿔 저장하면, 다음 방문부터 모든 계산기
//    페이지 상단/하단에 실제 쿠팡 상품이 클릭 없이 자동으로 표시됩니다.
// 3) 비워두면 지금처럼 "쿠팡에서 추천 상품 확인하기" 링크 카드만 보입니다
//    (자리가 비지 않도록 하는 기본값이며, 값을 채우면 자동으로 이 위젯으로 교체됩니다).
const COUPANG_TRACKING_CODE = "AF8068770";
const COUPANG_WIDGET_TOP_ID = "1027960";
const COUPANG_WIDGET_BOTTOM_ID = "1027960";

function mountCoupangSlot(wrapperId, slotId, fallbackId, widgetId) {
  const wrapper = document.getElementById(wrapperId);
  const slot = document.getElementById(slotId);
  if (!wrapper || !slot || !widgetId) return;
  const fallback = fallbackId ? document.getElementById(fallbackId) : null;
  if (fallback) fallback.style.display = "none";
  wrapper.style.display = "";
  const s = document.createElement("script");
  s.text =
    "new PartnersCoupang.G({" +
    '"id":' + JSON.stringify(widgetId) + "," +
    '"template":"carousel",' +
    '"trackingCode":' + JSON.stringify(COUPANG_TRACKING_CODE) + "," +
    '"width":"680","height":"140"});';
  slot.appendChild(s);
}

function renderCoupangWidgets() {
  if (!COUPANG_TRACKING_CODE || (!COUPANG_WIDGET_TOP_ID && !COUPANG_WIDGET_BOTTOM_ID)) return;
  const loader = document.createElement("script");
  loader.src = "https://ads-partners.coupang.com/g.js";
  loader.onload = function () {
    mountCoupangSlot("coupang-top", "coupang-top-slot", null, COUPANG_WIDGET_TOP_ID);
    mountCoupangSlot("coupang-bottom", "coupang-bottom-slot", "coupang-bottom-fallback", COUPANG_WIDGET_BOTTOM_ID);
  };
  document.head.appendChild(loader);
}

document.addEventListener("DOMContentLoaded", renderCoupangWidgets);
