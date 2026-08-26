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
