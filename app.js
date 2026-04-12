/************************************************************
 * 0. 定数・グローバル状態
 ************************************************************/
// const ...
// let ...
// window.xxx = ...

let _scrolling = false;

let rowNumber = 2;

// グローバルにキャッチバック内訳を保持するオブジェクト
let catchbackDetails = {};

let _raf = 0;

window.totalStoreCovered = 0;

window._bulkGridSyncTimer = null;
window._isApplyingBulkGridSync = false;
window._suppressSyncObservers = false;

/************************************************************
 * 1. 共通ユーティリティ
 ************************************************************/

// ---- 固定ヘッダ(タブ+可視サブナビ)込みで目的地へスクロール ----
function scrollToFixed(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;

  const tabsH = document.querySelector('.tabs')?.offsetHeight || 0;
  const visibleSub = Array.from(document.querySelectorAll('nav.subnav'))
    .find(n => getComputedStyle(n).display !== 'none');
  const subH = visibleSub?.offsetHeight || 0;

  // 念のためサブナビの top も加味（CSSでtop:80px）
  const subTop = visibleSub ? parseInt(getComputedStyle(visibleSub).top || '0', 10) : 0;

  const offset = tabsH + subH + subTop + 20;     // 余白+20
  const y = target.getBoundingClientRect().top + window.pageYOffset - offset;
  window.scrollTo({ top: y, behavior: 'smooth' });

  // 入力欄があるならフォーカス（任意）
  const focusable = target.matches('input,select,textarea,button')
      ? target
      : target.querySelector('input,select,textarea,button');
  focusable?.focus();
}

// 共通スクロール関数（ID文字列 / 要素の両対応）
function scrollWithOffset(target) {
  let el = null;

  if (typeof target === 'string') {
    el = document.getElementById(target);
  } else if (target instanceof HTMLElement) {
    el = target;
  }

  if (!el) return;

  const navHeight =
    (typeof getNavOffsetPx === 'function')
      ? getNavOffsetPx()
      : 140; // フォールバック

  const y = el.getBoundingClientRect().top + window.pageYOffset - navHeight;

  window.scrollTo({
    top: y,
    behavior: 'smooth'
  });
}

window.navScrollTo = function(targetId, behavior='smooth'){
  const el = document.getElementById(targetId);
  if (!el) return;

  const top = window.pageYOffset + el.getBoundingClientRect().top - _scrollOffset();
  const finalTop = Math.max(0, Math.floor(top));

  if (_scrolling) return;
  _scrolling = true;

  window.scrollTo({ top: finalTop, behavior: _behavior(behavior) });

  setTimeout(() => { _scrolling = false; }, 600);
};

// 履歴スクロールも navScrollTo に統一
document.getElementById('side-scroll-history')?.addEventListener('click', (e) => {
  e.preventDefault();
  navScrollTo('app2-historySection', 'smooth');
});

function saveForm() {
  const formData = [];
  document.querySelectorAll(".row").forEach((row, index) => {
    const rowNumber = parseInt(row.querySelector(".rowNumber")?.textContent) || index + 1;

    const rowData = {
      rowNumber: rowNumber,
      honshi: row.querySelector(".honshi")?.value || "",
      category: row.querySelector(".c")?.value || "",
      amount: row.querySelector(".amount")?.value || "",
      num: row.querySelector(".num")?.value || "",
      detail: row.querySelector(".detail")?.value || "",
      card: row.querySelector(".card")?.value || "",
      total: row.querySelector(".total")?.value || "",
      checkboxes: {}
    };

    const checkboxes = row.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      rowData.checkboxes[checkbox.parentElement.textContent.trim()] = checkbox.checked;
    });

    formData.push(rowData);
  });

  localStorage.setItem("formData", JSON.stringify(formData));
}

function restoreForm() {
  const savedData = localStorage.getItem("formData");
  if (savedData) {
    const formData = JSON.parse(savedData);
    const table = document.getElementById("formRows");

    // 最初の行以外を削除
    while (table.rows.length > 1) {
      table.deleteRow(1);
    }

    formData.forEach((data, index) => {
      let row;
      if (index === 0) {
        row = table.rows[0];
      } else {
        row = table.rows[0].cloneNode(true);
        table.appendChild(row);
      }

      // セルの復元
      row.querySelector(".rowNumber").textContent = data.rowNumber || index + 1;
      row.querySelector(".honshi").value = data.honshi || "";
      row.querySelector(".c").value = data.category || "";
      row.querySelector(".amount").value = data.amount || "";
      row.querySelector(".num").value = data.num || "";
      row.querySelector(".detail").value = data.detail || "";
      row.querySelector(".card").value = data.card || "";
      row.querySelector(".total").value = data.total || "";

      updateRowColor(row.querySelector(".c"));

      // 削除ボタンが存在しない場合は追加
      if (!row.querySelector(".delete-btn")) {
        const deleteCell = document.createElement("td");
        const deleteButton = document.createElement("button");
        deleteButton.textContent = "削除";
        deleteButton.className = "delete-btn";
        deleteButton.onclick = function () {
          deleteRow(this);
        };
        deleteCell.appendChild(deleteButton);
        row.appendChild(deleteCell);
      }
    });

    // 最大行番号を更新
    const maxRowNum = formData.reduce((max, data) => {
      const num = parseInt(data.rowNumber, 10);
      return (!isNaN(num) && num > max) ? num : max;
    }, 0);
    rowNumber = maxRowNum + 1;

    updateTotals();
  } else {
    rowNumber = 2; // データなしなら初期値に戻す
  }
}

// CSS変数からタブ/サブナビ高さ(px)を取得
function _pxVar(name, fallback = 0){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.endsWith('px') ? parseFloat(v) : (parseFloat(v) || fallback);
}

function _currentSubnavH(){
  const nav = Array.from(document.querySelectorAll('nav.subnav'))
    .find(el => {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    });

  return nav ? nav.offsetHeight : _pxVar('--subnav-h', 50);
}

function _scrollOffset(){
  return Math.round(_pxVar('--tabs-h', 56) + _currentSubnavH() + 70);
}

function _behavior(want='smooth'){
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : want;
}

// クリック時のハンドラ（サブナビ・サイドナビ）
['#app1-nav', '#app2-nav', '#app3-nav', '#app2-sideNav'].forEach(sel => {
  const nav = document.querySelector(sel);
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-target]');
    if (!btn) return;
    e.preventDefault();
    navScrollTo(btn.getAttribute('data-target'), 'smooth');
  }, { passive:false });
});

// アンカー直飛び防止
(() => {
  const style = document.createElement('style');
  style.textContent = `html { scroll-behavior: auto !important; }`;
  document.head.appendChild(style);
})();

function addComma(numStr) {
  if (!numStr) return '';
  // 数字とマイナス以外は除去
  let val = numStr.replace(/[^\d\-]/g, '');
  val = val.replace(/(?!^)-/g, '');
  if (val === '' || val === '-') return val;
  return parseInt(val, 10).toLocaleString('ja-JP');
}

// APP1 / APP2 / APP3 共通 iPad自作テンキー
function installBulkCustomKeypad() {
  const keypad = document.getElementById('bulkCustomKeypad');
  const keypadTitle = document.getElementById('bulkCustomKeypadTitle');

  // ===== 端末判定 =====
  // PCでは無効
  // タッチ主体端末（iPhone / iPad / Android / Surfaceタブレット系）でのみ有効
  function isCustomKeypadDevice() {
    const ua = navigator.userAgent || '';
    const isIOS =
      /iPhone|iPad|iPod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const isAndroid = /Android/i.test(ua);

    const hasTouch =
      ('ontouchstart' in window) ||
      (navigator.maxTouchPoints > 0);

    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const desktopWidth = window.matchMedia('(min-width: 1024px)').matches;

    // 「PC幅かつマウス主体」は無効
    if (desktopWidth && !coarsePointer) return false;

    return isIOS || isAndroid || (hasTouch && coarsePointer);
  }

  const isMobileLike = isCustomKeypadDevice();


  // PC時はテンキー完全無効化
  if (!isMobileLike || !keypad) {
    document.querySelectorAll('input.bulk-custom-keypad-target').forEach(input => {
      input.readOnly = false;
      input.removeAttribute('inputmode');
      input.classList.remove('bulk-custom-keypad-active');
    });

    if (keypad) {
      keypad.hidden = true;
    }

    return;
  }

  let activeInput = null;
  window.isCustomKeypadInput = false;

function isTarget(el) {
  return el instanceof HTMLInputElement
    && el.classList.contains('bulk-custom-keypad-target')
    && !el.disabled
    && !el.hidden
    && el.type !== 'hidden'
    && el.offsetParent !== null;
}

  function stripCommas(v) {
    return String(v ?? '').replace(/,/g, '');
  }

  function normalizeNumericString(v) {
    return stripCommas(v).replace(/[^\d-]/g, '');
  }

  function dispatchInput(input) {
   input.dispatchEvent(new Event('input', { bubbles: true }));
  }

function applyReadonlyToCustomKeypadTargets() {
  const inputs = document.querySelectorAll('input.bulk-custom-keypad-target');

  inputs.forEach(input => {
    if (input.disabled) return;
    if (input.type === 'hidden') return;

    input.readOnly = true;
    input.setAttribute('inputmode', 'none');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
  });
}
  function getLabel(input) {
    return input.getAttribute('placeholder')
      || input.dataset.k
      || input.id
      || input.className
      || '数値入力';
  }

  function clearActiveState() {
    document
      .querySelectorAll('input.bulk-custom-keypad-active')
      .forEach(el => el.classList.remove('bulk-custom-keypad-active'));
  }

    function getKeypadSafeTop() {
    const tabsH = _pxVar('--tabs-h', 56);
    const subH = _currentSubnavH();
    return Math.round(tabsH + subH + 12);
  }

  function getKeypadSafeBottom() {
    const keypadRect = keypad && !keypad.hidden
      ? keypad.getBoundingClientRect()
      : { height: 0 };

    const bottomGap = 12;
    const safeBottom = window.innerHeight - (keypadRect.height || 0) - bottomGap;

    // 念のため、上端より極端に狭くならないようにする
    return Math.max(getKeypadSafeTop() + 80, Math.round(safeBottom));
  }

  function scrollBulkGridWrapToInput(input) {
    const wrap = input?.closest('.bulk-grid-wrap');
    if (!wrap) return;

    const inputRect = input.getBoundingClientRect();
    const wrapRect  = wrap.getBoundingClientRect();

    const safeTop = Math.max(wrapRect.top, getKeypadSafeTop());
    const safeBottom = Math.min(wrapRect.bottom, getKeypadSafeBottom());

    const margin = 10;

    if (inputRect.bottom > safeBottom - margin) {
      wrap.scrollTop += (inputRect.bottom - (safeBottom - margin));
    } else if (inputRect.top < safeTop + margin) {
      wrap.scrollTop -= ((safeTop + margin) - inputRect.top);
    }
  }

  function scrollWindowToInput(input) {
    const rect = input.getBoundingClientRect();
    const safeTop = getKeypadSafeTop();
    const safeBottom = getKeypadSafeBottom();
    const margin = 10;

    if (rect.bottom > safeBottom - margin) {
      window.scrollBy({
        top: rect.bottom - (safeBottom - margin),
        behavior: 'smooth'
      });
      return;
    }

    if (rect.top < safeTop + margin) {
      window.scrollBy({
        top: rect.top - (safeTop + margin),
        behavior: 'smooth'
      });
    }
  }

  function ensureCustomKeypadTargetVisible(input) {
    if (!input) return;

    // まずグリッド内スクロールを合わせる
    if (input.closest('#bulkGrid')) {
      scrollBulkGridWrapToInput(input);
    }

    // その後にページ全体のスクロールも補正
    requestAnimationFrame(() => {
      scrollWindowToInput(input);
    });
  }

  function showKeypad(input) {
    if (!input) return;

    clearActiveState();

    activeInput = input;
    activeInput.classList.add('bulk-custom-keypad-active');

    if (keypadTitle) {
      keypadTitle.textContent = `入力中: ${getLabel(input)}`;
    }

    keypad.hidden = false;

    // テンキー表示後に、対象入力欄が
    // 固定ヘッダと固定テンキーに隠れない位置まで追従スクロール
    requestAnimationFrame(() => {
      ensureCustomKeypadTargetVisible(activeInput);
    });
  }

  function hideKeypad() {
  clearActiveState();
  activeInput = null;
  keypad.hidden = true;
  window.isCustomKeypadInput = false;
  }

  function setRawValue(input, raw) {
    input.value = raw;
    dispatchInput(input);
  }

  function appendText(input, text) {
  if (!input) return;

  window.isCustomKeypadInput = true;

  let raw = normalizeNumericString(input.value);

  if (text === '00' || text === '000') {
    if (raw === '' || raw === '-') {
      raw = raw === '-' ? '-0' : '0';
    }
    raw += text;
    setRawValue(input, raw);
    return;
  }

  raw += text;

  if (!/^-?\d*$/.test(raw)) return;

  setRawValue(input, raw);
  }

  function backspace(input) {
   if (!input) return;
  window.isCustomKeypadInput = true;
  const raw = normalizeNumericString(input.value).slice(0, -1);
   setRawValue(input, raw);
  }

  function clearValue(input) {
   if (!input) return;
  window.isCustomKeypadInput = true;
   setRawValue(input, '');
  }

  function toggleMinus(input) {
    if (!input) return;

  window.isCustomKeypadInput = true;

  let raw = normalizeNumericString(input.value);

  if (raw.startsWith('-')) {
    raw = raw.slice(1);
  } else {
    raw = '-' + raw;
  }

  setRawValue(input, raw);
  }

  function getTargetScope(input) {
    if (!input) return document.body;

    if (input.closest('#bulkGrid')) {
      return document.getElementById('bulkGrid') || document.body;
    }

    if (input.closest('#app1')) {
      return document.getElementById('app1') || document.body;
    }

    if (input.closest('#app3')) {
      return document.getElementById('app3') || document.body;
    }

    return document.body;
  }

  function getScopedTargets(input) {
    const scope = getTargetScope(input);

    return Array.from(scope.querySelectorAll('input.bulk-custom-keypad-target'))
      .filter(el => !el.disabled && el.type !== 'hidden' && el.offsetParent !== null);
  }

function focusTargetInput(next) {
  if (!next) return;

  try {
    next.focus({ preventScroll: true });
  } catch (_) {
    try {
      next.focus();
    } catch (_) {}
  }

  showKeypad(next);

  requestAnimationFrame(() => {
    ensureCustomKeypadTargetVisible(next);
  });

  try {
    next.blur();
  } catch (_) {}
}

  function focusNextTarget(current) {
    const all = getScopedTargets(current);
    const idx = all.indexOf(current);
    if (idx === -1) return;

    const next = all[idx + 1];
    if (next) {
      focusTargetInput(next);
    } else {
      hideKeypad();
    }
  }

  function moveHorizontal(current, direction) {
    const all = getScopedTargets(current);
    const idx = all.indexOf(current);
    if (idx === -1) return;

    const currentRow = current.closest('tr');
    if (currentRow) {
      if (direction === 'left') {
        for (let i = idx - 1; i >= 0; i--) {
          const el = all[i];
          if (el.closest('tr') === currentRow) {
            focusTargetInput(el);
            return;
          }
        }
        return;
      }

      if (direction === 'right') {
        for (let i = idx + 1; i < all.length; i++) {
          const el = all[i];
          if (el.closest('tr') === currentRow) {
            focusTargetInput(el);
            return;
          }
        }
        return;
      }
    }

    const currentGroup =
      current.closest('.app3-row') ||
      current.closest('.app3-line') ||
      current.closest('.row') ||
      current.parentElement;

    if (!currentGroup) return;

    const rowInputs = Array.from(
      currentGroup.querySelectorAll('input.bulk-custom-keypad-target')
    ).filter(el => !el.disabled && el.type !== 'hidden' && el.offsetParent !== null);

    const localIdx = rowInputs.indexOf(current);
    if (localIdx === -1) return;

    if (direction === 'left' && rowInputs[localIdx - 1]) {
      focusTargetInput(rowInputs[localIdx - 1]);
      return;
    }

    if (direction === 'right' && rowInputs[localIdx + 1]) {
      focusTargetInput(rowInputs[localIdx + 1]);
    }
  }

  function moveVerticalInBulkGrid(current, direction) {
    const currentRow = current.closest('tr.bulk-mainrow');
    const currentCell = current.closest('td');
    if (!currentRow || !currentCell) return false;

    const rowList = Array.from(
      document.querySelectorAll('#bulkGrid tbody tr.bulk-mainrow')
    );

    const rowIndex = rowList.indexOf(currentRow);
    if (rowIndex === -1) return false;

    const cellIndex = Array.from(currentRow.children).indexOf(currentCell);

    let targetRow = null;

    if (direction === 'up') {
      for (let i = rowIndex - 1; i >= 0; i--) {
        const row = rowList[i];
        if (row) {
          targetRow = row;
          break;
        }
      }
    }

    if (direction === 'down') {
      for (let i = rowIndex + 1; i < rowList.length; i++) {
        const row = rowList[i];
        if (row) {
          targetRow = row;
          break;
        }
      }
    }

    if (!targetRow) return true;

    const cells = targetRow.children;
    const targetCell = cells[cellIndex];
    if (!targetCell) return true;

    const next = targetCell.querySelector('input.bulk-custom-keypad-target');
    if (next && !next.disabled) {
      focusTargetInput(next);
    }

    return true;
  }

  function moveVerticalInApp1(current, direction) {
    const currentRow = current.closest('#formRows tr.row');
    const currentCell = current.closest('td');
    if (!currentRow || !currentCell) return false;

    const rowList = Array.from(document.querySelectorAll('#formRows tr.row'));
    const rowIndex = rowList.indexOf(currentRow);
    if (rowIndex === -1) return false;

    const cellIndex = Array.from(currentRow.children).indexOf(currentCell);

    let targetRow = null;

    if (direction === 'up') {
      for (let i = rowIndex - 1; i >= 0; i--) {
        const row = rowList[i];
        if (row) {
          targetRow = row;
          break;
        }
      }
    }

    if (direction === 'down') {
      for (let i = rowIndex + 1; i < rowList.length; i++) {
        const row = rowList[i];
        if (row) {
          targetRow = row;
          break;
        }
      }
    }

    if (!targetRow) return true;

    const cells = targetRow.children;
    const targetCell = cells[cellIndex];
    if (!targetCell) return true;

    const next = targetCell.querySelector('input.bulk-custom-keypad-target');
    if (next && !next.disabled) {
      focusTargetInput(next);
    }

    return true;
  }

  function moveVerticalFallback(current, direction) {
    const all = getScopedTargets(current);
    const idx = all.indexOf(current);
    if (idx === -1) return;

    if (direction === 'up' && all[idx - 1]) {
      focusTargetInput(all[idx - 1]);
      return;
    }

    if (direction === 'down' && all[idx + 1]) {
      focusTargetInput(all[idx + 1]);
    }
  }

  function moveVertical(current, direction) {
    if (!current) return;

    if (moveVerticalInBulkGrid(current, direction)) return;
    if (moveVerticalInApp1(current, direction)) return;

    moveVerticalFallback(current, direction);
  }

  applyReadonlyToCustomKeypadTargets();

  document.addEventListener('touchstart', (e) => {
  const target = e.target;

  if (isTarget(target)) {
    e.preventDefault();
    showKeypad(target);
    return;
  }

  if (keypad.contains(target)) {
    return;
  }

  hideKeypad();
  }, {
  capture: true,
  passive: false
  });

  document.addEventListener('focusin', (e) => {
    const target = e.target;

    if (!isTarget(target)) return;


    target.readOnly = true;
    showKeypad(target);

    try {
      target.blur();
    } catch (_) {}
  });

  keypad.addEventListener('touchstart', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !activeInput) return;

    const key = btn.dataset.key;
    const action = btn.dataset.action;


    if (key != null) {
      appendText(activeInput, key);
      return;
    }

    if (action === 'backspace') {
      backspace(activeInput);
      return;
    }

    if (action === 'clear') {
      clearValue(activeInput);
      return;
    }

    if (action === 'minus') {
      toggleMinus(activeInput);
      return;
    }

    if (action === 'moveUp') {
      moveVertical(activeInput, 'up');
      return;
    }

    if (action === 'moveDown') {
      moveVertical(activeInput, 'down');
      return;
    }

    if (action === 'moveLeft') {
      moveHorizontal(activeInput, 'left');
      return;
    }

    if (action === 'moveRight') {
      moveHorizontal(activeInput, 'right');
      return;
    }

    if (action === 'done') {
  window.isCustomKeypadInput = false;
  focusNextTarget(activeInput);
  }
  });

  document.addEventListener('keydown', (e) => {
    if (!activeInput) return;
    if (!isTarget(activeInput)) return;
    if (e.key !== 'Enter') return;

    e.preventDefault();
    focusNextTarget(activeInput);
  });

  /* =========================
     iPadダブルタップ拡大防止（テンキー限定）
     ========================= */

  let lastTouchEnd = 0;

  keypad.addEventListener('touchend', function (e) {
    const now = Date.now();

    if (now - lastTouchEnd <= 300) {
      e.preventDefault();
    }

    lastTouchEnd = now;
  }, { passive: false });

  keypad.addEventListener('dblclick', function (e) {
    e.preventDefault();
  });

  keypad.addEventListener('gesturestart', function (e) {
    e.preventDefault();
  });

  keypad.addEventListener('gesturechange', function (e) {
    e.preventDefault();
  });

  keypad.addEventListener('gestureend', function (e) {
    e.preventDefault();
  });

  window.applyReadonlyToCustomKeypadTargets = applyReadonlyToCustomKeypadTargets;
}


/************************************************************
 * 2. 共通DOM制御・共通イベント
 ************************************************************/

function updateAdviserFeeFromTotalCount() {
 const countEl = document.getElementById('totalCountValue');
 const adviserFeeInput = document.getElementById('adviserFee');

 if (!countEl || !adviserFeeInput) return;

 const count = parseInt(countEl.textContent.replace(/,/g, ''), 10) || 0;
 const fee = count * 1000;
 adviserFeeInput.value = fee;

 updateCalculations(); // 必要に応じて再計算
}

function observeTotalCountForAdviserFee() {
 const target = document.getElementById('totalCountValue');
 if (!target) return;

 const observer = new MutationObserver(() => {
    updateAdviserFeeFromTotalCount();
 });

 observer.observe(target, {
  childList: true,
  characterData: true,
  subtree: true,
 });
}

// app1/app3内だけカンマ付与
function attachCommaFormatApp1and3() {
  // app1対象
  document.querySelectorAll(
    '#app1 input.amount, #app1 input.num, #app1 input.card, #app1 input.total, #app1 input.honshi, #app1 input.table-number'
  ).forEach(input => {
    if (input._commaFormatApplied) return;
    input._commaFormatApplied = true;

    input.addEventListener('input', function () {
      let val = this.value.replace(/,/g, '');
      if (val === '' || !/^-?\d*$/.test(val)) {
        this.value = '';
        return;
      }
      this.value = addComma(val);
    });
    input.addEventListener('focus', function () {
      this.value = this.value.replace(/,/g, '');
    });
    input.addEventListener('blur', function () {
      this.value = addComma(this.value);
    });
    // 初期値にも即時カンマ
    if (input.value) input.value = addComma(input.value);
  });

  // app3対象（#app3直下でinput[type="text"]の全部/disabled除外）
  document.querySelectorAll('#app3 input[type="text"]:not([disabled])')
    .forEach(input => {
      if (input._commaFormatApplied) return;
      input._commaFormatApplied = true;

      input.addEventListener('input', function () {
        let val = this.value.replace(/,/g, '');
        if (val === '' || !/^-?\d*$/.test(val)) {
          this.value = '';
          return;
        }
        this.value = addComma(val);
      });
      input.addEventListener('focus', function () {
        this.value = this.value.replace(/,/g, '');
      });
      input.addEventListener('blur', function () {
        this.value = addComma(this.value);
      });
      if (input.value) input.value = addComma(input.value);
    });
}

/* ========= タブ切替 + 各APPのスクロール記憶 =============================================================================== */
(function () {
  const tabsRoot = document.querySelector('.tabs');
  if (!tabsRoot) return;

  const pagesById = new Map(['app1','app2','app3'].map(id => [id, document.getElementById(id)]));

  const SCROLL_KEY = 'appScrollMap';
  const loadMap = () => { try { return JSON.parse(localStorage.getItem(SCROLL_KEY)) || {}; } catch(_) { return {}; } };
  const saveMap = (m) => { try { localStorage.setItem(SCROLL_KEY, JSON.stringify(m)); } catch(_) {} };
  let scrollMap = loadMap();

  const getY = () => window.pageYOffset || document.documentElement.scrollTop || 0;
  const restoreY = (id) => {
    const y = Number(scrollMap[id] ?? 0);
    // レイアウト確定後に復帰
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }));
  };

  // スクロールのたびに「現在のAPP」の位置を保存（rAFスロットル）
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const id = document.body.getAttribute('data-active-app');
      if (!id) return;
      scrollMap[id] = getY();
      saveMap(scrollMap);
    });
  }, { passive: true });

function apply(targetId) {
  // 切替前に現在の位置を保存
  const prevId = document.body.getAttribute('data-active-app');
  if (prevId) {
    scrollMap[prevId] = getY();
    saveMap(scrollMap);
  }

  // ページ表示/非表示
  pagesById.forEach((el, id) => {
    const on = id === targetId;
    if (!el) return;
    el.style.display = on ? '' : 'none';
    el.classList.toggle('active', on);
    el.toggleAttribute('hidden', !on);
  });

  // タブの見た目/ARIA
  tabsRoot.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.target === targetId;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', on ? '0' : '-1');
    t.setAttribute('role', 'tab');
  });

  // サブナビをJSで強制切替
  const navMap = {
    app1: document.getElementById('app1-nav'),
    app2: document.getElementById('app2-nav'),
    app3: document.getElementById('app3-nav')
  };

  Object.entries(navMap).forEach(([id, nav]) => {
    if (!nav) return;

    if (id === targetId) {
      nav.style.setProperty('display', 'flex', 'important');
      nav.hidden = false;
      nav.setAttribute('aria-hidden', 'false');
    } else {
      nav.style.setProperty('display', 'none', 'important');
      nav.hidden = true;
      nav.setAttribute('aria-hidden', 'true');
    }
  });

  document.body.setAttribute('data-active-app', targetId);
  try {
    localStorage.setItem('selectedTab', targetId);
  } catch (e) {}

  // そのAPPの以前の位置へ復帰
  restoreY(targetId);
}

  // 外からも呼べるように
  window.showApp = apply;

  // スクロール記憶を完全クリア（ローカル/メモリ両方）
window.clearTabScrollMemory = () => {
  scrollMap = {};
  saveMap(scrollMap);
};

  // クリック＆Enter/Spaceでタブ切替
  tabsRoot.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab || !tabsRoot.contains(tab)) return;
    const id = tab.dataset.target;
    if (id) apply(id);
  });

  tabsRoot.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tab = e.target.closest('.tab');
    if (!tab) return;
    e.preventDefault();
    const id = tab.dataset.target;
    if (id) apply(id);
  });

  // 初期表示（保存 > 既存active > 先頭 > app1）
  const saved = localStorage.getItem('selectedTab');
  const fallbackTab = tabsRoot.querySelector('.tab.active') || tabsRoot.querySelector('.tab');
  const fallback = fallbackTab?.dataset.target || 'app1';
  apply(saved || fallback);

  // ページ離脱時の保険
  window.addEventListener('beforeunload', () => {
    const id = document.body.getAttribute('data-active-app');
    if (!id) return;
    scrollMap[id] = getY();
    saveMap(scrollMap);
  });
})();

// APPの日付読み取り（既存処理）
function readWorkDate(){
  const el =
    document.getElementById('workDate') ||
    document.querySelector('input[name="workDate"]') ||
    document.querySelector('#dateGroup input[type="date"]');
  if (!el) return '';

  if ('valueAsDate' in el && el.valueAsDate instanceof Date && !isNaN(el.valueAsDate)) {
    const d = el.valueAsDate;
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }

  let v = (el.value || el.getAttribute('value') || el.textContent || '').trim();
  if (!v) return '';
  v = v.replace(/\./g,'/').replace(/-/g,'/');
  const m = v.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (!m) return '';
  const y = m[1];
  const mm = String(parseInt(m[2],10)).padStart(2,'0');
  const dd = String(parseInt(m[3],10)).padStart(2,'0');
  return `${y}-${mm}-${dd}`;
}

/* 合計ユーティリティ（存在しなければ定義） */
if (typeof window.subtotal !== 'function') {
  window.subtotal = function(values){
    let s = 0; for (const v of (values||[])) s += (Number(v)||0); return s;
  };
}

// === 入力フォームを選択した瞬間に中の文字を全選択する ===
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;

  if (el.classList?.contains('use-custom-keypad')) {
    return;
  }

  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    el.select?.();
  }
});

// 退行などで data-readonly="1" の <select> はキー操作でも値を変えさせない
document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.tagName !== 'SELECT') return;
  if (el.dataset.readonly !== '1') return;

  // 値が変わり得るキーをブロック（上下/左右/確定など）
  const k = e.key;
  const block = [
    'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
    'PageUp','PageDown','Home','End','Enter',' '
  ];
  if (block.includes(k)) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

//Enterキー移動
function handleEnterNavigation(e) {
  if (e.key !== 'Enter') return;

  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  // --------------------------------------------------
  // 1) rowNumber 専用
  // --------------------------------------------------
  if (target.classList.contains('rowNumber')) {
    e.preventDefault();

    // contenteditable で混入した不要な <br> を除去
    target.innerHTML = target.textContent.trim();

    // 同じ行の次入力へ
    const tr = target.closest('tr');
    const nextInput = tr?.querySelector('input, select, textarea');
    if (nextInput) {
      nextInput.focus();
      if (typeof nextInput.select === 'function') {
        nextInput.select();
      }
    }

    // 必要なら保存
    if (typeof saveForm === 'function') {
      saveForm();
    }
    return;
  }

  // --------------------------------------------------
  // 2) 通常フォーム専用
  // --------------------------------------------------
  if (!target.matches('input, select, textarea')) return;

  e.preventDefault();

  // 現在アクティブな APP を基準にスコープ決定
  const activeAppId = document.body.getAttribute('data-active-app') || '';
  const scope =
    target.closest('.content') ||
    document.getElementById(activeAppId) ||
    document.body;

  // 表示中かつ有効なフォーム要素のみ対象
  const formElements = Array.from(
    scope.querySelectorAll(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])'
    )
  ).filter(el => el.offsetParent !== null);

  const index = formElements.indexOf(target);
  const next = formElements[index + 1];

  if (next) {
    next.focus();
    if (typeof next.select === 'function') {
      next.select();
    }
  }
}

document.addEventListener('keydown', handleEnterNavigation);

document.addEventListener('gesturestart', function (e) {
  e.preventDefault();
});

let startY = 0;

document.addEventListener('touchstart', function (e) {
  startY = e.touches[0].clientY;
}, { passive: false });

document.addEventListener('touchmove', function (e) {
  const currentY = e.touches[0].clientY;

  // 上方向へスクロールしようとしていて、ページが一番上にいるとき
  if (currentY > startY && window.scrollY === 0) {
    e.preventDefault(); // iOS Safari でPull-to-Refreshを防止
  }
}, { passive: false });

// ============================================================
// APP1/APP2 の入力・選択操作でも APP3 更新を予約（保険）
// ============================================================
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t) return;

  if (window.isCustomKeypadInput) return;

  if (t.closest('#app1') || t.closest('#app2') || t.closest('#app3')) {
    scheduleApp3Update('input(app1/app2/app3)');
  }
}, true);

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t) return;

  if (window.isCustomKeypadInput) return;

  if (t.closest('#app1') || t.closest('#app2')) {
    scheduleApp3Update('change(app1/app2)');
  }
}, true);



/************************************************************
 * 3. APP1
 ************************************************************/

/* app1（伝票）：行とカテゴリチェックを保存 */
function collectApp1State() {
  const tbody = document.getElementById('formRows');
  if (!tbody) return { rows: [], catChecks: {} };

  // 伝票行をすべて拾う（rowNumber も含める）
  const rows = [...tbody.querySelectorAll('tr.row')].map(tr => ({
    no:      (tr.querySelector('.rowNumber')?.textContent ?? "").trim(), // ← ここで番号を保存
    table:   tr.querySelector('.table-number')?.value ?? "",
    honshi:  tr.querySelector('.honshi')?.value ?? "",
    c:       tr.querySelector('.c')?.value ?? "",
    amount:  tr.querySelector('.amount')?.value ?? "",
    num:     tr.querySelector('.num')?.value ?? "",
    detail:  tr.querySelector('.detail')?.value ?? "",
    card:    tr.querySelector('.card')?.value ?? "",
    total:   tr.querySelector('.total')?.value ?? ""
  }));

  // ★ 既存ロジック：CB表のチェック状態も保存
  const catChecks = {};
  document.querySelectorAll('#categorySection tbody tr').forEach(tr => {
    const cb = tr.querySelector('input[type="checkbox"]');
    if (!cb) return;

    const key =
      (tr.querySelector('span[id$="total"]')?.id || '')
        .replace(/total$/, '') ||
      (tr.textContent || '').trim().split(/\s+/)[0];

    if (key) catChecks[key] = !!cb.checked;
  });

  return { rows, catChecks };
}

function shouldSkipDirectSync() {
  if (typeof window.canSyncNow === 'function') {
    return !window.canSyncNow();
  }

  return !!window._isApplyingBulkGridSync;
}

function requestImmediateFirebaseSync(reason = '') {
  if (shouldSkipDirectSync()) return;

  if (typeof window.saveAllApps === 'function') {
    Promise.resolve(window.saveAllApps()).catch(err => {
      console.error(`[direct sync] ${reason}`, err);
    });
  }
}

function applyApp1State(state) {
  if (!state || !Array.isArray(state.rows)) return;

  const tbody = document.getElementById('formRows');
  if (!tbody) return;

  // いったん全部消す
  tbody.innerHTML = "";

  // 行を追加して値を流し込む
  state.rows.forEach((r, idx) => {
    // 復元時は addRow を使わず、静かに行を生成する
    let tr = null;

    if (typeof createEmptyRow === 'function') {
      tr = createEmptyRow(idx + 1);
    } else {
      // フォールバック：素の tr を生成
      tr = document.createElement('tr');
      tr.className = 'row';
      tr.innerHTML = `
        <td><button class="delete-btn" onclick="deleteRow(this)">×</button></td>
        <td class="rowNumber" contenteditable="true">${idx + 1}</td>

        <td>
          <input
            class="table-number bulk-custom-keypad-target"
            type="text"
            inputmode="numeric"
            pattern="\\d*"
            placeholder="卓番"
            oninput="updateTotals()"
          />
        </td>

        <td>
          <input
            class="honshi bulk-custom-keypad-target"
            type="text"
            inputmode="numeric"
            pattern="\\d*"
            placeholder="本指"
            oninput="updateTotals()"
          />
        </td>

        <td>
          <select class="c" oninput="updateRowColor(this); updateTotals()">
            <option value="">-</option>
            <option value="UK">UK</option>
            <option value="K">K</option>
            <option value="AB">AB</option>
            <option value="LA">LA</option>
            <option value="PA">PA</option>
            <option value="BB">BB</option>
            <option value="MS">MS</option>
            <option value="GM">GM</option>
            <option value="B">B</option>
            <option value="JOE">JOE</option>
            <option value="KOSE">KOSE</option>
            <option value="HE">HE</option>
            <option value="PB">PB</option>
            <option value="X">X</option>
            <option value="Z">Z</option>
          </select>
        </td>

        <td>
          <input
            class="amount bulk-custom-keypad-target"
            type="text"
            inputmode="numeric"
            pattern="\\d*"
            placeholder="金額"
            oninput="updateTotals()"
          />
        </td>

        <td>
          <input
            class="num bulk-custom-keypad-target"
            type="text"
            inputmode="numeric"
            pattern="\\d*"
            placeholder="人数"
            oninput="updateTotals()"
          />
        </td>

        <td>
          <input
            class="detail"
            type="text"
            placeholder="詳細"
          />
        </td>

        <td>
          <input
            class="card bulk-custom-keypad-target"
            type="text"
            inputmode="numeric"
            pattern="\\d*"
            placeholder="カード"
            oninput="updateTotals()"
          />
        </td>

        <td>
          <input
            class="total bulk-custom-keypad-target"
            type="text"
            inputmode="numeric"
            pattern="\\d*"
            placeholder="総合計"
            oninput="updateTotals()"
          />
        </td>
      `;
    }

    tbody.appendChild(tr);

    // --- rowNumber を復元 ---
    const noCell = tr.querySelector('.rowNumber');
    const storedNo =
      (r && r.no != null && String(r.no).trim() !== "")
        ? String(r.no).trim()
        : String(idx + 1);

    if (noCell) noCell.textContent = storedNo;

    // 値を流し込む
    const setVal = (sel, val) => {
      const el = tr.querySelector(sel);
      if (el) el.value = (val ?? "");
    };

    setVal('.table-number', r.table);
    setVal('.honshi',       r.honshi);
    setVal('.c',            r.c);
    setVal('.amount',       r.amount);
    setVal('.num',          r.num);
    setVal('.detail',       r.detail);
    setVal('.card',         r.card);
    setVal('.total',        r.total);

    // 色反映
    const cSel = tr.querySelector('.c');
    if (cSel && typeof updateRowColor === 'function') {
      updateRowColor(cSel);
    }
  });

  // rowNumber の次番号を更新
  if (typeof renumberRows === 'function') {
    renumberRows();
  }

  // カンマ整形再適用
  if (typeof attachCommaFormatApp1and3 === 'function') {
    attachCommaFormatApp1and3();
  }

  // 自作テンキー用 readonly 再適用
  if (typeof window.applyReadonlyToCustomKeypadTargets === 'function') {
    window.applyReadonlyToCustomKeypadTargets();
  }

  // ★ 既存：カテゴリチェック復元
  if (state.catChecks) {
    Object.entries(state.catChecks).forEach(([key, checked]) => {
      const span = document.querySelector(`#categorySection #${CSS.escape(key)}total`);
      const tr   = span?.closest('tr');
      const cb   = tr?.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = !!checked;
    });
  }

  // 合計再計算
  if (typeof window.updateTotals === "function") {
    window.updateTotals();
  }
}

function createEmptyRow(number) {
  const tr = document.createElement('tr');
  tr.className = "row";
  tr.innerHTML = `
    <td><button class="delete-btn" onclick="deleteRow(this)">×</button></td>
    <td class="rowNumber" contenteditable="true">${number}</td>

    <td>
      <input
        class="table-number bulk-custom-keypad-target"
        type="text"
        inputmode="numeric"
        pattern="\\d*"
        placeholder="卓番"
        oninput="updateTotals()"
      />
    </td>

    <td>
      <input
        class="honshi bulk-custom-keypad-target"
        type="text"
        inputmode="numeric"
        pattern="\\d*"
        placeholder="本指"
        oninput="updateTotals()"
      />
    </td>

    <td>
      <select class="c" oninput="updateRowColor(this); updateTotals()">
        <option value="">-</option>
        <option value="UK">UK</option>
        <option value="K">K</option>
        <option value="AB">AB</option>
        <option value="LA">LA</option>
        <option value="PA">PA</option>
        <option value="BB">BB</option>
        <option value="MS">MS</option>
        <option value="GM">GM</option>
        <option value="B">B</option>
        <option value="JOE">JOE</option>
        <option value="KOSE">KOSE</option>
        <option value="HE">HE</option>
        <option value="PB">PB</option>
        <option value="X">X</option>
        <option value="Z">Z</option>
      </select>
    </td>

    <td>
      <input
        class="amount bulk-custom-keypad-target"
        type="text"
        inputmode="numeric"
        pattern="\\d*"
        placeholder="金額"
        oninput="updateTotals()"
      />
    </td>

    <td>
      <input
        class="num bulk-custom-keypad-target"
        type="text"
        inputmode="numeric"
        pattern="\\d*"
        placeholder="人数"
        oninput="updateTotals()"
      />
    </td>

    <td>
      <input
        class="detail"
        type="text"
        placeholder="詳細"
      />
    </td>

    <td>
      <input
        class="card bulk-custom-keypad-target"
        type="text"
        inputmode="numeric"
        pattern="\\d*"
        placeholder="カード"
        oninput="updateTotals()"
      />
    </td>

    <td>
      <input
        class="total bulk-custom-keypad-target"
        type="text"
        inputmode="numeric"
        pattern="\\d*"
        placeholder="総合計"
        oninput="updateTotals()"
      />
    </td>
  `;
  return tr;
}

// APP1：伝票テーブル内 十字キー移動
function enableArrowNavigationApp1(){
  const table = document.querySelector('#app1 #formRows');
  if (!table) return;

  const selector = 'input, select, textarea';
  const getInputs = () => Array.from(table.querySelectorAll(selector));

  table.addEventListener('keydown', (e)=>{
    const key = e.key;
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)) return;

    const inputs = getInputs();
    const current = e.target;
    if (!inputs.includes(current)) return;

    e.preventDefault();

    // 現在位置を特定
    const index = inputs.indexOf(current);
    const td = current.closest('td');
    const tr = current.closest('tr');
    if (!td || !tr) return;

    const rowIndex = Array.from(table.querySelectorAll('tr.row')).indexOf(tr);
    const cellIndex = Array.from(tr.children).indexOf(td);

    let next;
    switch(key){
      case 'ArrowLeft':
        // 左：同じ行内で前のinput
        for(let i=index-1;i>=0;i--){
          const el = inputs[i];
          if (el.closest('tr')===tr) { next=el; break; }
        }
        break;

      case 'ArrowRight':
        // 右：同じ行内で次のinput
        for(let i=index+1;i<inputs.length;i++){
          const el = inputs[i];
          if (el.closest('tr')===tr) { next=el; break; }
        }
        break;

      case 'ArrowUp':
        {
          // 上：同じ列の上の行
          const rows = Array.from(table.querySelectorAll('tr.row'));
          if (rowIndex>0){
            const prevRow = rows[rowIndex-1];
            const cells = prevRow.querySelectorAll('td');
            if (cells[cellIndex]){
              next = cells[cellIndex].querySelector(selector);
            }
          }
        }
        break;

      case 'ArrowDown':
        {
          // 下：同じ列の下の行
          const rows = Array.from(table.querySelectorAll('tr.row'));
          if (rowIndex<rows.length-1){
            const nextRow = rows[rowIndex+1];
            const cells = nextRow.querySelectorAll('td');
            if (cells[cellIndex]){
              next = cells[cellIndex].querySelector(selector);
            }
          }
        }
        break;
    }

    if (next){
      next.focus();
      // 数値フィールドは選択状態に
      if (next.select) next.select();
    }
  });
}

function searchByAmount() {
  const input = document.getElementById('searchAmount').value.replace(/,/g, '').trim();
  const rows = document.querySelectorAll('#formRows tr');
  let foundRow = null;

  rows.forEach(row => {
    const totalValue = row.querySelector('.total')?.value.replace(/,/g, '') || '';
    const shouldShow = (input === '' || totalValue.includes(input));

    if (shouldShow && row.style.display === 'none') {
      row.style.display = '';
      row.classList.remove('slide-out-left');
      row.classList.add('slide-in-right');
      row.addEventListener('animationend', function onAnimEnd() {
        row.classList.remove('slide-in-right');
        row.removeEventListener('animationend', onAnimEnd);
      });
    } else if (!shouldShow && row.style.display !== 'none') {
      row.classList.remove('slide-in-right');
      row.classList.add('slide-out-left');
      row.addEventListener('animationend', function onAnimEnd() {
        row.style.display = 'none';
        row.classList.remove('slide-out-left');
        row.removeEventListener('animationend', onAnimEnd);
      });
    }

    // スクロール用: 最初に見つかった行だけ記憶
    if (shouldShow && !foundRow) {
      foundRow = row;
    }
  });

  // 検索値が空欄でなければ、ヒット時はスクロール、なければダイアログ
  if (input !== '') {
    if (foundRow) {
      // スクロール（スムーズ・中央寄せ）
      foundRow.scrollIntoView({ behavior: "smooth", block: "center" });
      // ハイライトしたい場合は下記も追加OK
      // foundRow.classList.add('highlight');
    } else {
      window.alert("該当する伝票がありません。");
    }
  }
}

function resetSearch() {
  document.getElementById('searchAmount').value = '';
  const rows = document.querySelectorAll('#formRows tr');
  rows.forEach(row => {
    if (row.style.display === 'none') {
      row.style.display = '';
      row.classList.add('slide-in-right');
      row.addEventListener('animationend', function onAnimEnd() {
        row.classList.remove('slide-in-right');
        row.removeEventListener('animationend', onAnimEnd);
      });
    }
  });
}

function addRow() {
  const table = document.getElementById("formRows");
  if (!table) return;

  // ① 現在の伝票番号の最大値を取得
  const cells = table.querySelectorAll('.rowNumber');
  let maxNo = 0;

  cells.forEach(cell => {
    const raw = (cell.textContent || '').trim();
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v) && v > maxNo) maxNo = v;
  });

  const nextNo = maxNo + 1;

  // ② 最大値+1 で行を生成
  const newRow = createEmptyRow(nextNo);
  table.appendChild(newRow);

  // ③ 見た目・スクロール
  requestAnimationFrame(() => newRow.classList.add('slide-in'));
  newRow.addEventListener('animationend', () => {
    newRow.classList.remove('slide-in');
  }, { once: true });

  const rect = newRow.getBoundingClientRect();
  const offset = 155;
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

  window.scrollTo({
    top: rect.top + scrollTop - offset,
    behavior: 'smooth'
  });

  // ④ 既存処理
  attachCommaFormatApp1and3();
  renumberRows();
  saveForm();

  if (typeof updateTotals === 'function') {
    updateTotals();
  }

  // 追加行にも自作テンキー用 readonly / inputmode=none を反映
  if (typeof window.applyReadonlyToCustomKeypadTargets === 'function') {
    window.applyReadonlyToCustomKeypadTargets();
  }

  // ⑤ Firebase 同期
  requestImmediateFirebaseSync('APP1 addRow sync');
}

function deleteRow(button) {
  const row = button.closest('tr');
  const formRows = document.getElementById('formRows');

  if (!row || !formRows) return;

  if (formRows.rows.length <= 1) {
    alert("これ以上削除できません");
    return;
  }

  if (confirm("この伝票を削除しますか？")) {
    // まずアニメーション用クラスを付ける
    row.classList.add('slide-out-left');

    // アニメーション終了後にDOMから削除
    row.addEventListener('animationend', function onAnimEnd() {
      row.removeEventListener('animationend', onAnimEnd);

      if (row.parentNode === formRows) {
        formRows.removeChild(row);
      }

      renumberRows();

      if (typeof updateTotals === 'function') {
        updateTotals();
      }

      saveForm();

      // Firebase 同期
      requestImmediateFirebaseSync('APP1 deleteRow sync');
    }, { once: true });
  }
}

function sortRowsByNumber() {
  const tbody = document.getElementById("formRows");
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll("tr"));

  // 並び替え基準取得（数字として比較）
  rows.sort((a, b) => {
    const aVal = parseInt(a.querySelector(".rowNumber")?.textContent.trim() || "", 10);
    const bVal = parseInt(b.querySelector(".rowNumber")?.textContent.trim() || "", 10);

    const isNaA = Number.isNaN(aVal);
    const isNaB = Number.isNaN(bVal);

    if (isNaA && isNaB) return 0;
    if (isNaA) return 1;
    if (isNaB) return -1;

    return aVal - bVal;
  });

  // tbodyへ再配置
  rows.forEach(row => tbody.appendChild(row));

  renumberRows();
  saveForm();

  if (typeof updateTotals === 'function') {
    updateTotals();
  }

  flashSorted();

  // Firebase 同期
  requestImmediateFirebaseSync('APP1 sortRowsByNumber sync');
}

function renumberRows() {
  const table = document.getElementById("formRows");
  const cells = table.querySelectorAll(".rowNumber");

  let maxNo = 0;
  cells.forEach(cell => {
    const raw = (cell.textContent || '').trim();
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v) && v > maxNo) maxNo = v;
  });

  // 次回用の rowNumber を更新するだけ
  rowNumber = maxNo + 1;
}

function updateTotals() {
  let totalCustomers = 0;
  let cardTotal = 0;
  let totalAmount = 0;

  const catchbackTotals = {};
  const categories = ["UK", "K", "AB", "LA", "PA", "BB", "MS", "GM", "B", "JOE", "KOSE", "HE", "PB", "X", "Z"];

  categories.forEach(cat => {
    catchbackTotals[cat] = { amount: 0, count: 0 };
    catchbackDetails[cat] = [];
  });

  document.querySelectorAll(".row").forEach(row => {
    const num    = parseInt((row.querySelector(".num")?.value || '').replace(/,/g, ''), 10) || 0;
    const honshi = parseInt((row.querySelector(".honshi")?.value || '').replace(/,/g, ''), 10) || 0;
    const amount = parseInt((row.querySelector(".amount")?.value || '').replace(/,/g, ''), 10) || 0;
    const card   = parseInt((row.querySelector(".card")?.value || '').replace(/,/g, ''), 10) || 0;
    const total  = parseInt((row.querySelector(".total")?.value || '').replace(/,/g, ''), 10) || 0;
    const category = row.querySelector(".c")?.value || "";

    totalCustomers += num + honshi;
    cardTotal += card;
    totalAmount += total;

    if (category && catchbackTotals[category]) {
      const backAmount = (amount <= 5999) ? amount * num * 0.2 : amount * num * 0.3;

      if (category !== "Z") {
        catchbackTotals[category].amount += backAmount;
        catchbackTotals[category].count += num;

        if (num > 0) {
          catchbackDetails[category].push({
            unit: amount,
            count: num
          });
        }
      }
    }
  });

  let totalCount = 0;
  let totalBackAmount = 0;

  categories.forEach(cat => {
    if (cat !== "X") {
      totalCount += catchbackTotals[cat].count;
      totalBackAmount += catchbackTotals[cat].amount;
    } else {
      totalBackAmount += catchbackTotals[cat].amount;
    }

    const countEl = document.getElementById(`${cat}count`);
    const totalEl = document.getElementById(`${cat}total`);

    if (countEl) countEl.textContent = catchbackTotals[cat].count.toLocaleString();
    if (totalEl) totalEl.textContent = Math.floor(catchbackTotals[cat].amount).toLocaleString();
  });

  const totalCustomersEl   = document.getElementById("totalCustomers");
  const cardTotalEl        = document.getElementById("cardTotal");
  const cashTotalEl        = document.getElementById("cashTotal");
  const totalAmountEl      = document.getElementById("totalAmount");
  const totalCountValueEl  = document.getElementById("totalCountValue");
  const totalBackAmountEl  = document.getElementById("totalBackAmount");

  if (totalCustomersEl)  totalCustomersEl.textContent = totalCustomers.toLocaleString();
  if (cardTotalEl)       cardTotalEl.textContent = cardTotal.toLocaleString();
  if (cashTotalEl)       cashTotalEl.textContent = (totalAmount - cardTotal).toLocaleString();
  if (totalAmountEl)     totalAmountEl.textContent = totalAmount.toLocaleString();
  if (totalCountValueEl) totalCountValueEl.textContent = totalCount.toLocaleString();
  if (totalBackAmountEl) totalBackAmountEl.textContent = Math.floor(totalBackAmount).toLocaleString();

  // APP3入力欄へ直接反映
  const customersCountInput = document.getElementById("customersCount");
  const cashSalesInput      = document.getElementById("cashSales");
  const cardSalesInput      = document.getElementById("cardSales");
  const totalSalesInput     = document.getElementById("totalSales");

  if (customersCountInput) customersCountInput.value = totalCustomers;
  if (cashSalesInput)      cashSalesInput.value = formatNumber(totalAmount - cardTotal);
  if (cardSalesInput)      cardSalesInput.value = formatNumber(cardTotal);
  if (totalSalesInput)     totalSalesInput.value = formatNumber(totalAmount);

  if (!window.catchbackDetails) window.catchbackDetails = {};
  window.catchbackDetails = {};

  document.querySelectorAll('#formRows tr').forEach(row => {
    const c = row.querySelector('.c')?.value || '';
    if (!c) return;

    const num    = parseInt((row.querySelector('.num')?.value || '0').replace(/,/g, ''), 10) || 0;
    const unit   = parseInt((row.querySelector('.amount')?.value || '0').replace(/,/g, ''), 10) || 0;
    const detail = row.querySelector('.detail')?.value || '';
    const amount = unit * num;

    (window.catchbackDetails[c] ||= []).push({
      unit,
      count: num,
      amount,
      detail
    });
  });

  updateRowGrayOut();

  if (typeof window.updateAttendanceMiniForm === 'function') {
    window.updateAttendanceMiniForm();
  }

  if (typeof window.scheduleApp3Update === 'function') {
    window.scheduleApp3Update('updateTotals');
  }

  saveForm();
}

function saveCheckboxStates() {
  const checkboxes = document.querySelectorAll("table input[type='checkbox']");
  const states = Array.from(checkboxes).map(cb => cb.checked);
  localStorage.setItem("checkboxStates", JSON.stringify(states));
}

function restoreCheckboxStates() {
  const states = JSON.parse(localStorage.getItem("checkboxStates"));
  if (!states) return;
  const checkboxes = document.querySelectorAll("table input[type='checkbox']");
  checkboxes.forEach((cb, index) => {
    cb.checked = states[index];
  });
}

function flashSorted() {
  const tbody = document.getElementById("formRows");
  tbody.style.transition = "box-shadow .4s";
  tbody.style.boxShadow = "0 0 20px #00f5ff77";

  setTimeout(() => {
    tbody.style.boxShadow = "0 0 0px transparent";
  }, 500);
}

function updateRowColor(select) {
  const row = select.closest("tr");
  row.className = "row";
  if (select.value) {
    row.classList.add("category-" + select.value);
  }
}

function scheduleTotals(){
  if (_raf) return;
  _raf = requestAnimationFrame(()=>{ _raf = 0; updateTotals(); });
}

function filterCategory(category) {
  currentCategory = category;
  localStorage.setItem("selectedCategory", category); // ← 保存

  const rows = document.querySelectorAll('#formRows tr');
  rows.forEach(row => {
    const select = row.querySelector('select.c');
    const value = select ? select.value : '';

    const shouldShow = (category === 'all' || value === category);

    if (shouldShow && row.style.display === 'none') {
      // 表示する必要あり→右からスライドイン
      row.style.display = '';
      row.classList.remove('slide-out-left');
      // スライドインアニメを付ける
      row.classList.add('slide-in-right');
      row.addEventListener('animationend', function onAnimEnd() {
        row.classList.remove('slide-in-right');
        row.removeEventListener('animationend', onAnimEnd);
      });
    } else if (!shouldShow && row.style.display !== 'none') {
      // 非表示にする必要あり→左スライドで消す
      row.classList.remove('slide-in-right');
      row.classList.add('slide-out-left');
      row.addEventListener('animationend', function onAnimEnd() {
        row.style.display = 'none';
        row.classList.remove('slide-out-left');
        row.removeEventListener('animationend', onAnimEnd);
      });
    }
  });

  document.querySelectorAll('.tab button').forEach(btn => btn.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('.tab button')).find(btn => {
    return btn.textContent === category || (category === 'all' && btn.textContent.includes('すべて表示'));
  });
  if (activeBtn) activeBtn.classList.add('active');
}

function filterCashOnlyRows() {
  const rows = document.querySelectorAll('#formRows tr');
  rows.forEach(row => {
    const cardInput = row.querySelector('.card');
    const cardValue = parseInt(cardInput?.value || "0");
    const shouldShow = (!cardValue || cardValue === 0);

    if (shouldShow && row.style.display === 'none') {
      row.style.display = '';
      row.classList.remove('slide-out-left');
      row.classList.add('slide-in-right');
      row.addEventListener('animationend', function onAnimEnd() {
        row.classList.remove('slide-in-right');
        row.removeEventListener('animationend', onAnimEnd);
      });
    } else if (!shouldShow && row.style.display !== 'none') {
      row.classList.remove('slide-in-right');
      row.classList.add('slide-out-left');
      row.addEventListener('animationend', function onAnimEnd() {
        row.style.display = 'none';
        row.classList.remove('slide-out-left');
        row.removeEventListener('animationend', onAnimEnd);
      });
    }
  });

  currentCategory = 'cashOnly';
  document.querySelectorAll('.tab button').forEach(btn => btn.classList.remove('active'));
}


function filterCardInputRows() {
  const rows = document.querySelectorAll('#formRows tr');
  rows.forEach(row => {
    const cardInput = row.querySelector('.card');
    const hasCardValue = cardInput && cardInput.value.trim() !== '';
    const shouldShow = hasCardValue;

    if (shouldShow && row.style.display === 'none') {
      row.style.display = '';
      row.classList.remove('slide-out-left');
      row.classList.add('slide-in-right');
      row.addEventListener('animationend', function onAnimEnd() {
        row.classList.remove('slide-in-right');
        row.removeEventListener('animationend', onAnimEnd);
      });
    } else if (!shouldShow && row.style.display !== 'none') {
      row.classList.remove('slide-in-right');
      row.classList.add('slide-out-left');
      row.addEventListener('animationend', function onAnimEnd() {
        row.style.display = 'none';
        row.classList.remove('slide-out-left');
        row.removeEventListener('animationend', onAnimEnd);
      });
    }
  });

  currentCategory = 'cardInputOnly';
  document.querySelectorAll('.tab button').forEach(btn => btn.classList.remove('active'));
}

//キャンセル伝票グレーアウト
function updateRowGrayOut() {
  const rows = document.querySelectorAll('#app1 tr.row');

  rows.forEach(row => {
    const cSelect = row.querySelector('.c');
    const totalInput = row.querySelector('.total');

    const cVal = cSelect?.value || '';
    const rawVal = totalInput?.value || '';
    const totalVal = rawVal.replace(/,/g, '');

    const isZero = totalVal === '0';     // ← 明示的に0だけ判定
    const isEmpty = totalVal === '';     // ← 未入力

    if (cVal === '' && isZero) {
      row.classList.add('gray-out');
    } else {
      row.classList.remove('gray-out');
    }
  });
}

window.collectApp1State = collectApp1State;
window.applyApp1State   = applyApp1State;






/************************************************************
 * 4. APP2
 ************************************************************/
// 4-1. APP2 state collect/apply
// 4-2. ボトル定数・計算
// 4-3. ボトル履歴
// 4-4. ボトルフォーム生成/削除/保存復元
// 4-5. 履歴表示/復元/削除
// 4-6. calculate / confirmAndCalculate
// 4-7. APP2 ナビゲーション・十字キー

  // === DOM取得 =============================================================
  function getBulkDom() {
    return {
      panel:   document.getElementById('bulkPanel'),
      toggle:  document.getElementById('toggleBulkInput'),
      sel:     document.getElementById('bulkRows'),
      clearBt: document.getElementById('bulkClear'),
      regBt:   document.getElementById('bulkRegister'),
      grid:    document.getElementById('bulkGrid')
    };
  }

window.getBulkDom = getBulkDom;

function installCheckboxColumn() {
  // buildGrid() でチェック列を直接生成するため不要
}

// ===== app2 履歴のローカル状態 =====
let app2History = [];

let BOTTLE_REFRESHING = false;

const BOTTLE_PICKER_CONFIG = {
  defaultSplits: makeRangeButtons(1, 15),
  defaultQtys: makeRangeButtons(1, 10)
};

// APP2 一括入力グリッド用：追加ボトル候補の学習
const APP2_CUSTOM_BOTTLE_KEY = 'app2_custom_bottle_memory_v1';
const APP2_CUSTOM_BOTTLE_MAX = 120;

let BOTTLE_PICKER_STATE = {
  tr: null,
  anchorEl: null,
  detail: '',
  split: '',
  qty: '',
  rafId: 0
};

// 履歴 → { 詳細名: [ { id, split, qty, amount }, ... ] }
let BOTTLE_HISTORY = {};

/* app2（報酬計算）：id を持つ input/select/textarea を丸ごと保存/復元＋ボトル明細 */
function collectApp2State(){
  const root = document.getElementById('app2');
  if(!root) return {};

  const fields = {};
  root.querySelectorAll('input[id], select[id], textarea[id]').forEach(el=>{
    fields[el.id] = (el.type === 'checkbox') ? !!el.checked : (el.value ?? "");
  });

  const bottles = [...root.querySelectorAll('#bottleFormsContainer .bottle-form')].map(form => ({
    details: getSelectedDetail(form) || "",
    split:   form.querySelector('.splitCount')?.value ?? "",
    qty:     form.querySelector('.bottleQuantity')?.value ?? "",
    amount:  form.querySelector('.bottleAmount')?.value ?? ""
  }));

  const historyRoot = document.getElementById('historyList');
  const historyHTML = historyRoot ? historyRoot.innerHTML : "";

  let bulkGridState = { rows: [] };

  try {
    if (typeof window.collectBulkGridStateForSync === 'function') {
      bulkGridState = window.collectBulkGridStateForSync();
    }
  } catch (err) {
    console.error('[APP2 bulkGrid] collect failed:', err);
  }

  return {
    fields,
    bottles,
    historyHTML,
    bulkGrid: bulkGridState
  };
}

function collectBulkGridStateForSync() {
  const getter =
    (typeof window.getBulkDom === 'function')
      ? window.getBulkDom
      : (typeof getBulkDom === 'function' ? getBulkDom : null);

  if (!getter) {
    console.warn('[APP2 bulkGrid] getBulkDom missing');
    return { rows: [] };
  }

  const { grid } = getter();
  if (!grid) {
    console.warn('[APP2 bulkGrid] bulkGrid not found');
    return { rows: [] };
  }

  const mains = [...grid.querySelectorAll('.bulk-mainrow')];

  const rows = mains.map(tr => {
    const row = {
      name: tr.querySelector('.bulk-name')?.value || '',
      exp: tr.querySelector('.bulk-exp')?.checked || false,
      send: tr.querySelector('.bulk-send')?.value || '',
      nums: {},
      bottles: []
    };

    tr.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      if (!k) return;

      if (el.type === 'checkbox') {
        row.nums[k] = !!el.checked;
      } else {
        row.nums[k] = el.value || '';
      }
    });

    let n = tr.nextElementSibling;
    while (n && n.classList.contains('btl-subrow')) {
      row.bottles.push({
        detail: (typeof getSelectedDetail === 'function') ? (getSelectedDetail(n) || '') : '',
        split: n.querySelector('.splitCount')?.value || '',
        qty: n.querySelector('.bottleQuantity')?.value || '',
        amount: n.querySelector('.bottleAmount')?.value || ''
      });
      n = n.nextElementSibling;
    }

    return row;
  });

  return { rows };
}

window.collectBulkGridStateForSync = collectBulkGridStateForSync;

async function applyApp2State(state) {
  const root = document.getElementById('app2');
  if (!root || !state) return;

  const {
    fields = {},
    bottles = [],
    historyHTML = '',
    bulkGrid = { rows: [] }
  } = state || {};

  window._isApplyingBulkGridSync = true;
  window._suppressSyncObservers = true;

  if (typeof window.suppressSync === 'function') {
    window.suppressSync(2000);
  }

  try {
    // 1) 通常入力欄の復元
    if (fields && typeof fields === 'object') {
      Object.entries(fields).forEach(([id, val]) => {
        const el = root.querySelector('#' + CSS.escape(id));
        if (!el) return;

        if (el.type === 'checkbox') {
          el.checked = !!val;
        } else {
          el.value = val ?? '';
        }
      });
    }

    // 2) ボトルフォーム復元
    const bottleContainer = root.querySelector('#bottleFormsContainer');
    if (bottleContainer && Array.isArray(bottles)) {
      BOTTLE_REFRESHING = true;
      bottleContainer.innerHTML = '';

      bottles.forEach((b) => {
        if (typeof window.addBottleForm !== 'function') return;

        const formEl = window.addBottleForm();
        if (!formEl) return;

        const detail = b.details ?? b.detail ?? '';
        const split  = b.split ?? b.splitCount ?? '';
        const qty    = b.qty ?? b.quantity ?? b.bottleQuantity ?? '';
        const amount = b.amount ?? b.bottleAmount ?? '';

        const sel = formEl.querySelector('.bottleDetails');
        if (sel && typeof setBottleDetailValue === 'function') {
          setBottleDetailValue(sel, detail);
        } else if (sel) {
          sel.value = detail;
        }

        const splitEl = formEl.querySelector('.splitCount');
        const qtyEl = formEl.querySelector('.bottleQuantity');
        const amountEl = formEl.querySelector('.bottleAmount');

        if (splitEl) splitEl.value = split;
        if (qtyEl) qtyEl.value = qty;
        if (amountEl) amountEl.value = amount;
      });

      if (typeof window.refreshBottleDropdownsFromHistory === 'function') {
        window.refreshBottleDropdownsFromHistory();
      }

      BOTTLE_REFRESHING = false;
    }

    // 3) 履歴本体復元
    const historyRoot = document.getElementById('historyList');
    if (historyRoot) {
      const nextHTML = (typeof historyHTML === 'string') ? historyHTML : '';

      if (historyRoot.innerHTML !== nextHTML) {
        historyRoot.innerHTML = nextHTML;
      }

      try {
        localStorage.setItem('historyList', nextHTML);
      } catch (_) {}
    }

    // 履歴依存UI再構築
    if (typeof window.renumberHistory === 'function') {
      window.renumberHistory();
    }

    if (typeof window.refreshBottleDropdownsFromHistory === 'function') {
      window.refreshBottleDropdownsFromHistory();
    }

    if (typeof window.updateSummary === 'function') {
      window.updateSummary();
    }

    if (typeof window.createHistoryIndex === 'function') {
      window.createHistoryIndex();
    }

    await new Promise(resolve => requestAnimationFrame(resolve));

    // 4) 一括入力グリッド反映
    if (bulkGrid && typeof window.applyBulkGridStateFromSync === 'function') {
      await window.applyBulkGridStateFromSync(bulkGrid);
      await new Promise(resolve => requestAnimationFrame(resolve));

      const grid = document.getElementById('bulkGrid');

      if (grid && typeof window.updateBulkFilledState === 'function') {
        window.updateBulkFilledState(grid);
      }

      if (typeof window.applyApp2MobileView === 'function') {
        window.applyApp2MobileView();
      }

      if (typeof window.applyReadonlyToBulkGridCustomKeypad === 'function') {
        window.applyReadonlyToBulkGridCustomKeypad();
      }

      if (typeof window.applyReadonlyToCustomKeypadTargets === 'function') {
        window.applyReadonlyToCustomKeypadTargets();
      }
    }

    // 5) 最終再計算
    if (typeof window.updateSummary === 'function') {
      window.updateSummary();
    }

    if (typeof window.createHistoryIndex === 'function') {
      window.createHistoryIndex();
    }

  } catch (err) {
    console.error('[APP2 sync] applyApp2State failed:', err);
  } finally {
    await new Promise(resolve => requestAnimationFrame(resolve));

    if (typeof window.suppressSync === 'function') {
      window.suppressSync(2000);
    }

    window._suppressSyncObservers = false;
    window._isApplyingBulkGridSync = false;
  }
}

// === APP2: ボトルの登録バック金額（ユーザー指定版） ===
const BOTTLE_BASE = Object.freeze({
  'リステル': 6000,
  'パリ': 7500,
  'マバム': 17500,
  'モエ白': 15000,
  'モエロゼ': 17500,
  'モエネク': 20000,
  'モエピカ': 22500,
  'ヴーヴ': 16000,
  'ヴーヴホワイト': 17500,
  'ヴーヴローズ': 19000,
  'ベルエ': 70000,
  'ベルエロゼ': 140000,
  'ソウメイ': 60000,
  'ドンペリ': 50000,
  'ドンペリルミナス': 60000,
  'ドンペリロゼ': 70000,
  'ドンペリルミナスロゼ': 85000,
  'ドンペリP2': 150000,
  'ドンペリゴールド': 250000,
  'アルマンド': 85000,
  'アルマンドロゼ': 140000,
  'アルマンドグリーン': 200000,
  'オリシャンR': 12500,
  'オリシャンB': 30000,
  '柚子小町': 5000,
  '黒霧島': 7500,
  '吉四六': 7500,
  '富乃宝山': 8500,
  '赤霧島': 10000,
  '知多': 20000,
  '山崎': 35000,
  'ベリンジャー': 10000,
  'テキカン': 35000,
  '枝': 500,

  // 空白（自動金額なしにしたい項目は 0 にしておく）
  'その他': 0,
  '保障補正': 0
});



function safeDecodeText(str) {
  if (str == null) return '';
  try {
    return decodeURIComponent(str);
  } catch (e) {
    return String(str);
  }
}


function createBottleForm(detail = '', split = '', quantity = '', amount = '') {
  const form = document.createElement('div');
  form.className = 'bottle-form';

  form.innerHTML = `
  <div class="left-group">
    <button type="button" class="delete-btn">×</button>
    <select class="bottleDetails">${window.BOTTLE_OPTIONS_HTML}</select>
    <input type="number" class="splitCount" placeholder="割">
    <input type="number" class="bottleQuantity" placeholder="数量">
  </div>
  <input type="number" class="bottleAmount" placeholder="金額">
`;

  const sel         = form.querySelector('.bottleDetails');
  const splitInput  = form.querySelector('.splitCount');
  const qtyInput    = form.querySelector('.bottleQuantity');
  const amountInput = form.querySelector('.bottleAmount');
  const delBtn      = form.querySelector('.delete-btn');

  if (detail) {
    setBottleDetailValue(sel, detail);
  }
  if (split !== undefined)    splitInput.value  = split;
  if (quantity !== undefined) qtyInput.value    = quantity;
  if (amount !== undefined)   amountInput.value = amount;

  // 品目変更時
  sel.addEventListener('change', (e) => {
    if (window.BOTTLE_REFRESHING) return;
    const opt = sel.selectedOptions[0];
    if (!opt) return;

    if (opt.dataset.from === 'history') {
      splitInput.value  = opt.dataset.split  || '';
      qtyInput.value    = opt.dataset.qty    || '';
      amountInput.value = opt.dataset.amount || '';
    } else {
      if (!e.isTrusted) return;
      if (splitInput.value === '') splitInput.value = '1';
      if (qtyInput.value   === '') qtyInput.value   = '1';
      updateBottleAmountForForm(form);
    }

    saveBottleForms?.();
    rememberBottleSelectionFromForm(form);
  });

  // 入力イベント
  ['input','change','blur'].forEach(evt => {
    splitInput.addEventListener(evt, () => {
      if (window.BOTTLE_REFRESHING) return;
      updateBottleAmountForForm(form);
      saveBottleForms?.();

      if (evt === 'change' || evt === 'blur') {
        rememberBottleSelectionFromForm(form);
      }
    });

    qtyInput.addEventListener(evt, () => {
      if (window.BOTTLE_REFRESHING) return;
      updateBottleAmountForForm(form);
      saveBottleForms?.();

      if (evt === 'change' || evt === 'blur') {
        rememberBottleSelectionFromForm(form);
      }
    });

    amountInput.addEventListener(evt, () => {
      if (window.BOTTLE_REFRESHING) return;
      saveBottleForms?.();
    });
  });

  // 削除ボタン
  delBtn.addEventListener('click', () => {
    if (confirm('このボトル明細を削除しますか？')) {
      form.remove();
      saveBottleForms?.();
      hydrateAllBottleSelectsWithCustomOptions?.();
    }
  });

  return form;
}

// 登録金額・割・数量から金額を計算
// ルール: (登録金額/割) の “10円未満切り捨て” を単価とし、単価×数量
function computeBottleAmount(detail, split, qty){
  const base = BOTTLE_BASE[detail] ?? 0;
  const s = Math.max(1, intSafe(split, 1)); // 0割回避
  const q = Math.max(0, intSafe(qty, 0));
  const unit = floor100(base / s);
  return unit * q;
}

function rememberBottleSelectionFromForm(form) {
  if (!form) return false;

  const detail = normalizeBottleText(getSelectedDetail(form) || '');
  const split  = normalizeBottleNum(form.querySelector('.splitCount')?.value, '');
  const qty    = normalizeBottleNum(form.querySelector('.bottleQuantity')?.value, '');

  // 品名が空なら何もしない
  if (!detail) return false;

  // 途中入力のゴミを減らすため、割と数量がそろった時だけ学習
  if (!split || !qty) return false;

  upsertCustomBottleMemory({
    detail,
    split: split || '1',
    qty: qty || '1'
  });

  ensureBottleOptionExists(detail);
  hydrateAllBottleSelectsWithCustomOptions();

  return true;
}

function saveBottleForms() {
  const bottleForms = [];

  document.querySelectorAll('.bottle-form').forEach(form => {
    const bottleDetails = getSelectedDetail(form);
    const splitCount = form.querySelector('.splitCount')?.value || '';
    const bottleQuantity = form.querySelector('.bottleQuantity')?.value || '';
    const bottleAmount = parseInt(
      (form.querySelector('.bottleAmount')?.value || '').replace(/,/g, ''),
      10
    ) || 0;

    bottleForms.push({
      bottleDetails,
      splitCount,
      bottleQuantity,
      bottleAmount
    });
  });

  localStorage.setItem('bottleForms', JSON.stringify(bottleForms));
}

function loadBottleForms() {
  const bottleFormsData = JSON.parse(localStorage.getItem('bottleForms') || '[]');
  const container = document.getElementById('bottleFormsContainer');
  if (!container) return;

  container.innerHTML = '';
  window.BOTTLE_REFRESHING = true;

  bottleFormsData.forEach(data => {
    const form = createBottleForm(
      data.bottleDetails ?? '',
      data.splitCount ?? '',
      data.bottleQuantity ?? '',
      data.bottleAmount ?? ''
    );
    if (form) container.appendChild(form);
  });

  window.BOTTLE_REFRESHING = false;
  refreshBottleDropdownsFromHistory();
}

function refreshBottleDropdownsFromHistory() {
  buildBottleHistoryMap();

  BOTTLE_REFRESHING = true; // ←開始

  document.querySelectorAll('select.bottleDetails').forEach(sel => {
  // 退避
  const prevValue = sel.value;
  const form = sel.closest('.bottle-form');
  const prevSplit = form?.querySelector('.splitCount')?.value ?? '';
  const prevQty   = form?.querySelector('.bottleQuantity')?.value ?? '';
  const prevAmt   = form?.querySelector('.bottleAmount')?.value ?? '';

  // 壊れた __HIST__ option を掃除
  Array.from(sel.querySelectorAll('option')).forEach(opt => {
    const v = String(opt.value || '').trim();
    const t = String(opt.textContent || '').trim();

    const brokenValue = v.startsWith('__HIST__') && !opt.dataset?.from;
    const brokenText  = t.startsWith('__HIST__');
    const brokenBase  = String(opt.dataset?.base || '').trim().startsWith('__HIST__');

    if (brokenValue || brokenText || brokenBase) {
      opt.remove();
    }
  });

    // 履歴グループを先頭に
    let grp = Array.from(sel.children).find(n => n.tagName === 'OPTGROUP' && n.label === '履歴');
    if (!grp) {
      grp = document.createElement('optgroup');
      grp.label = '履歴';
      sel.insertBefore(grp, sel.firstChild);
    }
    grp.innerHTML = '';

    // 各品名の履歴を再構築
    Object.entries(BOTTLE_HISTORY).forEach(([rawDetail, variants]) => {
  const detail = normalizeBottleDetail(rawDetail);

  const hasBlank = Array.from(sel.options).some(o => normalizeBottleDetail(o.value) === detail);
  if (!hasBlank) {
    const blankOpt = document.createElement('option');
    blankOpt.value = detail;
    blankOpt.textContent = `${detail}（新規）`;
    blankOpt.dataset.base = detail;
    grp.appendChild(blankOpt);
  }

  variants.forEach(v => {
    const opt = document.createElement('option');
    opt.value = `__HIST__${v.id}`;
    opt.textContent = `${detail}（${v.split !== '' ? "割:" + v.split : "割:-"}/${v.qty !== '' ? "数量:" + v.qty : "数量:-"}/¥${Number(v.amount || 0).toLocaleString()}）`;
    opt.dataset.from = 'history';
    opt.dataset.base = detail;
    opt.dataset.split = v.split;
    opt.dataset.qty = v.qty;
    opt.dataset.amount = v.amount;
    grp.appendChild(opt);
  });
});

    // 選択を復元。失敗したら退避の入力値を戻す
    sel.value = prevValue;
    if (sel.value !== prevValue && form) {
      form.querySelector('.splitCount').value     = prevSplit;
      form.querySelector('.bottleQuantity').value = prevQty;
      form.querySelector('.bottleAmount').value   = prevAmt;
    }
  });

  BOTTLE_REFRESHING = false; // ←終了
}

function calculate() {
   const historyList = document.getElementById('historyList');
  // 「体験及び貸出」のチェックボックスの状態を取得
  const isExperienceAndRentalChecked = document.getElementById('experienceAndRental').checked;
  let experienceText = isExperienceAndRentalChecked ? '体験及び貸出: 有り' : '体験及び貸出: 無し';

  const values = {
  jounai: 1000,
  honshiri: 0,
  douhan: 1500,
  eda: 500,
  help: -1500,
  set40: 5500,
  set20: 3500,
  vip: 2000,
  a: 500,
  b: 1000,
  c: 1500,
  d: 2000,
  e: 2500
};

// Fは「数量(f2) × 単価(チェックボックスfで1500/2000)」に統合
const fCount = parseInt(document.getElementById('f2')?.value) || 0;
const fUnit  = document.getElementById('f')?.checked ? 2000 : 1500;

let total = fCount * fUnit;

for (let key in values) {
  const count = parseInt(document.getElementById(key).value) || 0;
  total += count * values[key];
}


   // 動的に追加されたボトルフォームから金額と詳細を取得
  const bottleForms = document.querySelectorAll('.bottle-form');
  bottleForms.forEach(form => {
    const bottleAmount = parseInt(
   (form.querySelector('.bottleAmount')?.value || '').replace(/,/g, ''), 10
   ) || 0;
    const bottleDetails = getSelectedDetail(form) || '詳細なし';
    total += bottleAmount;
  });

  const kousei = 1000;
  const gensen = Math.ceil((total * 0.1) / 100) * 100;

  let afterGensen = total - gensen;

  let actualKousei = 0;

  // 厚生費の引き方を変更
  if (!isExperienceAndRentalChecked) {
    if (afterGensen - kousei >= 5000) {
      actualKousei = kousei;
    } else {
      actualKousei = Math.max(0, afterGensen - 5000);
    }
  }

  const kouseiStoreCovered = (actualKousei === 0) ? 1000 : 0;
  const kouseiCastCovered = 0;

  let welfareText = `厚生費: ¥${actualKousei.toLocaleString()} (店舗負担:¥${kouseiStoreCovered.toLocaleString()})`;

  // 送迎金額の取得
  let sendoffAmount = parseInt(document.getElementById('sendoffAmount').value)||0;

  // 合計 = 小計 - 源泉費 - 厚生費
  let totalAmount = afterGensen - actualKousei;

    let adjustedSendoff = 0;

    if (!isExperienceAndRentalChecked) {
    adjustedSendoff = sendoffAmount;
    const tempFinalAmount = totalAmount - adjustedSendoff;

    if (tempFinalAmount < 5000) {
    const maxDeductible = totalAmount - 5000;
    adjustedSendoff = Math.max(0, maxDeductible);
    }
  }

  // 最終合計
  let finalAmount = totalAmount - adjustedSendoff;



  // 店舗負担・本人負担の計算
  const castCoveredAmount = adjustedSendoff;
  const storeCoveredAmount = sendoffAmount - adjustedSendoff;

  // 店舗負担合計をグローバルで加算（リセットしない）
  window.totalStoreCovered = (window.totalStoreCovered || 0) + Math.max(storeCoveredAmount, 0);

  let sendoffText = `送迎: ¥${sendoffAmount.toLocaleString()}(本人負担: ¥${castCoveredAmount.toLocaleString()}`;
  if (storeCoveredAmount > 0) {
  sendoffText += `店舗負担: ¥${storeCoveredAmount.toLocaleString()})`;
  } else {
  sendoffText += `)`; // ←これを追加すると安心
  }

  const labels = {
    f: 'F',
    f2: 'F2',
    jounai: '場内',
    honshiri: '本指',
    douhan: '同伴',
    eda: '枝',
    help: 'HELP',
    set40: 'SET40',
    set20: 'SET20',
    vip: 'VIP',
    a: 'A',
    b: 'B',
    c: 'C',
    d: 'D',
    e: 'E'
  };

  let detailsHTML = '<div class="details" style="font-size: 14px; margin-top: 10px;">';

    // F（統合）
if (fCount > 0) {
  const subtotal = fCount * fUnit;
  detailsHTML += `<div>F ×${fCount}（@¥${fUnit.toLocaleString()}）= ¥${subtotal.toLocaleString()}</div>`;
}
 
  for (let key in values) {
  const count = parseInt(document.getElementById(key).value) || 0;
  if (count > 0) {
    const label = labels[key] || key.toUpperCase();
    const unitPrice = values[key];
    const subtotal = count * unitPrice;
    detailsHTML += `<div>${label} ×${count}（¥${unitPrice.toLocaleString()}）= ¥${subtotal.toLocaleString()}</div>`;
  }
}

  // 追加された全ボトル明細
  // 追加された全ボトル明細
bottleForms.forEach(form => {
  const bottleDetail = getSelectedDetail(form) || '詳細なし';

  const split = form.querySelector('.splitCount')?.value || '';
  const quantity = form.querySelector('.bottleQuantity')?.value || '';
  const amountStr = (form.querySelector('.bottleAmount')?.value || '').replace(/,/g, '');
  const bottleAmount = parseInt(amountStr, 10) || 0;

  if (bottleAmount > 0 || bottleDetail || split || quantity) {
    detailsHTML += `<div>ボトル:¥${bottleAmount.toLocaleString()}（${bottleDetail}`;
    if (split) detailsHTML += `/割:${split}`;
    if (quantity) detailsHTML += `/数量:${quantity}`;
    detailsHTML += `）</div>`;
  }
});

  detailsHTML += '</div>';

  const castName = document.getElementById('castName').value || '（名前なし）';

  // 10万を超える場合だけ表示（封筒印字専用）
  const congratsHTML =
  (finalAmount > 100000)
    ? `
      <div class="congrats-box print-only">
        <div class="congrats">～CONGRATULATIONS～</div>
        <div class="finalAmount print-highlight"><strong>最終合計: </strong>¥${finalAmount.toLocaleString()}</div>
      </div>
    `
    : `
      <div class="finalAmount print-highlight"><strong>最終合計: </strong>¥${finalAmount.toLocaleString()}</div>
    `;

  const resultText = `
  <div class="castName"><strong></strong> ${castName}</div>
  <div class="experienceAndRental">${experienceText}</div>
  <div class="subtotal"><strong>小計:</strong> ¥${total.toLocaleString()}</div>
  <div class="tax" style="font-size: 16px; font-weight: bold;">
    <strong>源泉費:</strong> ¥${gensen.toLocaleString()}
  </div>
  <div class="welfare" style="font-size: 16px; font-weight: bold;">
    <strong>${welfareText}</strong>
  </div>
  <div class="totalAmount" style="font-size:25px; font-weight:bold; display:inline-flex; align-items:baseline;">
    <strong>合計:</strong>&nbsp;¥${totalAmount.toLocaleString()}
    <span class="print-only" style="font-size:14px; margin-left:6px;">←領収書記入</span>
  </div>
  <div class="sendoff"><strong>${sendoffText}</strong></div>

  ${congratsHTML}

  ${detailsHTML}
  `;

  // 履歴に新しい項目を追加
  const existingItem = Array.from(historyList.children).find(item => {
  const nameElem = item.querySelector('.castName');
  if (!nameElem) return false;

  // 🔽 正規表現で先頭の番号（例: "1. "）を削除
  const nameText = nameElem.textContent.replace(/^\s*\d+\.\s*/, '').trim();
  
  return nameText === castName;
  });


  // detailsHTMLを囲んで非表示にする
  const detailsHiddenHTML = `<div class="details-html-container" style="display:none; font-size:14px; margin-top:5px;">${detailsHTML}</div>`;

  const fullHTML = `
  <div>
    <label><input type="checkbox" class="history-checkbox"> 削除対象</label>
    ${resultText.replace(detailsHTML, '')}
    ${detailsHiddenHTML}
    <div style="margin-top: 5px;">
      <button onclick="restoreFromHistory(this)" style="margin-right: 5px; font-size: 12px;">復元</button>
      <button onclick="moveHistoryItem(this, 'up')" style="font-size: 12px;">↑</button>
      <button onclick="moveHistoryItem(this, 'down')" style="font-size: 12px;">↓</button>
    </div>
  </div>
  `;

  if (existingItem) {
  existingItem.innerHTML = fullHTML;
  } else {
  const listItem = document.createElement('li');
  listItem.innerHTML = fullHTML;
  historyList.prepend(listItem);
  }

  renumberHistory();

  // サマリーを更新
  updateSummary();


  // 保存処理
  const inputElements = document.querySelectorAll('input[type="number"], input[type="text"]');
  const inputValues = {};
  inputElements.forEach(input => {
    inputValues[input.id] = input.value;
  });
  localStorage.setItem('inputs', JSON.stringify(inputValues));
  localStorage.setItem('historyList', historyList.innerHTML);
  localStorage.setItem('result', resultText);
    // 履歴に追加したので、ボトル候補を更新
  refreshBottleDropdownsFromHistory();

  // チェックボックスの状態も保存
  const checkboxStates = {
  experienceAndRental: document.getElementById('experienceAndRental').checked,
  fUnit2000: document.getElementById('f')?.checked || false
  };
  localStorage.setItem('checkboxes', JSON.stringify(checkboxStates));

    // 🔽 ここを追加：ボトルフォームの内容も保存する
  saveBottleForms();

  document.getElementById("result").innerHTML = resultText;
const resultElem = document.getElementById("result");
if (resultElem) {
  const tabsEl = document.querySelector('.tabs');
  const tabsHeight = tabsEl ? tabsEl.offsetHeight : 0;

  const app2Nav = document.getElementById('app2-nav');
  const navHeight = app2Nav ? app2Nav.offsetHeight : 0;

  const extraOffset = 30;
  const totalOffset = tabsHeight + navHeight + extraOffset;

  const rect = resultElem.getBoundingClientRect();
  const targetY = rect.top + window.pageYOffset - totalOffset;
  window.scrollTo({ top: targetY, behavior: "smooth" });
}
}

// 入力→数値(,除去)の安全変換
function intSafe(v, d = 0){ const n = parseInt(String(v ?? '').toString().replace(/,/g,''),10); return Number.isFinite(n)? n : d; }
// 100円未満切り捨て（例: 3750 → 3700）
function floor100(yen){ return Math.floor(intSafe(yen)/100)*100; }

// フォーム1行の金額を再計算して反映
function updateBottleAmountForForm(form){
  const split = form.querySelector('.splitCount')?.value;
  const qty   = form.querySelector('.bottleQuantity')?.value;
  const amt   = computeBottleAmount(getSelectedDetail(form), split, qty);
  const out   = form.querySelector('.bottleAmount');
  out.value = amt ? String(amt) : '';
}

// 一括入力グリッド用 ボトル階層選択（クリック完結版）
function makeRangeButtons(min, max) {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

function normalizeBottleText(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeBottleNum(v, fallback = '') {
  const n = parseInt(String(v ?? '').replace(/[^\d.-]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? String(n) : fallback;
}

function loadCustomBottleMemory() {
  try {
    const raw = localStorage.getItem(APP2_CUSTOM_BOTTLE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveCustomBottleMemory(list) {
  try {
    localStorage.setItem(APP2_CUSTOM_BOTTLE_KEY, JSON.stringify(list));
  } catch (e) {}
}

function upsertCustomBottleMemory(entry) {
  const detail = normalizeBottleText(entry?.detail);
  const split  = normalizeBottleNum(entry?.split, '1');
  const qty    = normalizeBottleNum(entry?.qty, '1');

  if (!detail) return;

  let list = loadCustomBottleMemory();

  // 同一 detail / split / qty は重複させない
  list = list.filter(x => !(
    normalizeBottleText(x.detail) === detail &&
    normalizeBottleNum(x.split, '1') === split &&
    normalizeBottleNum(x.qty, '1') === qty
  ));

  list.unshift({
    detail,
    split,
    qty,
    updatedAt: Date.now()
  });

  // detail 重複は新しいもの優先で整理
  const seenVariant = new Set();
  const compact = [];
  for (const item of list) {
    const key = [
      normalizeBottleText(item.detail),
      normalizeBottleNum(item.split, '1'),
      normalizeBottleNum(item.qty, '1')
    ].join('||');

    if (seenVariant.has(key)) continue;
    seenVariant.add(key);
    compact.push(item);
    if (compact.length >= APP2_CUSTOM_BOTTLE_MAX) break;
  }

  saveCustomBottleMemory(compact);
}

function getCustomBottleMemory() {
  return loadCustomBottleMemory()
    .filter(x => normalizeBottleText(x.detail))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function getCustomBottleNames() {
  const out = [];
  const seen = new Set();

  getCustomBottleMemory().forEach(x => {
    const name = normalizeBottleText(x.detail);
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  });

  return out;
}

function ensureBottleOptionExists(detail) {
  const name = normalizeBottleText(detail);
  if (!name) return;

  document.querySelectorAll('select.bottleDetails').forEach(select => {
    const exists = Array.from(select.options).some(opt => opt.value === name);
    if (exists) return;

    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name} *`;
    opt.dataset.customBottle = '1';
    select.appendChild(opt);
  });
}

function getBottlePickerNames() {
  const base = [];
  try {
    if (typeof bottleRules === 'object' && bottleRules) {
      base.push(...Object.keys(bottleRules).filter(Boolean));
    }
  } catch (e) {}

  const custom = getCustomBottleNames();

  const seen = new Set();
  return [...base, ...custom].filter(name => {
    const key = normalizeBottleText(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyBottleHierarchySelection(tr, detail, split, qty) {
  if (!tr) return;

  const normalizedDetail = normalizeBottleText(detail);
  const normalizedSplit  = normalizeBottleNum(split, '1');
  const normalizedQty    = normalizeBottleNum(qty, '1');

  const detailEl = tr.querySelector('.bottleDetails');
  const splitEl  = tr.querySelector('.splitCount');
  const qtyEl    = tr.querySelector('.bottleQuantity');

  if (normalizedDetail) {
    ensureBottleOptionExists(normalizedDetail);
  }

  if (detailEl) detailEl.value = normalizedDetail ?? '';
  if (splitEl)  splitEl.value  = normalizedSplit ?? '';
  if (qtyEl)    qtyEl.value    = normalizedQty ?? '';

  if (detailEl) detailEl.dispatchEvent(new Event('change', { bubbles: true }));
  if (splitEl)  splitEl.dispatchEvent(new Event('input',  { bubbles: true }));
  if (splitEl)  splitEl.dispatchEvent(new Event('change', { bubbles: true }));
  if (qtyEl)    qtyEl.dispatchEvent(new Event('input',  { bubbles: true }));
  if (qtyEl)    qtyEl.dispatchEvent(new Event('change', { bubbles: true }));

  rememberBottleSelectionFromRow(tr);

  if (typeof updateBottleAmountForRow === 'function') {
    updateBottleAmountForRow(tr);
  }
}

function getBottleHierarchyPickerEl() {
  return document.getElementById('bottleHierarchyPicker');
}

function renderBottleHierarchyPicker() {
  const picker = getBottleHierarchyPickerEl();
  if (!picker) return;

  const splitGrid = picker.querySelector('.bhp-split-grid');
  const qtyGrid   = picker.querySelector('.bhp-qty-grid');

  const curSplit  = picker.querySelector('.bhp-current-split');
  const curQty    = picker.querySelector('.bhp-current-qty');

  if (curSplit) curSplit.textContent = BOTTLE_PICKER_STATE.split || '-';
  if (curQty)   curQty.textContent   = BOTTLE_PICKER_STATE.qty || '-';

  if (splitGrid) {
    splitGrid.innerHTML = BOTTLE_PICKER_CONFIG.defaultSplits.map(v => `
      <button type="button"
              class="bhp-btn ${String(BOTTLE_PICKER_STATE.split) === String(v) ? 'active' : ''}"
              data-bhp-kind="split"
              data-bhp-value="${v}">${v}</button>
    `).join('');
  }

  if (qtyGrid) {
    qtyGrid.innerHTML = BOTTLE_PICKER_CONFIG.defaultQtys.map(v => `
      <button type="button"
              class="bhp-btn ${String(BOTTLE_PICKER_STATE.qty) === String(v) ? 'active' : ''}"
              data-bhp-kind="qty"
              data-bhp-value="${v}">${v}</button>
    `).join('');
  }
}

function positionBottleHierarchyPicker(anchorEl) {
  const picker = getBottleHierarchyPickerEl();
  if (!picker || !anchorEl) return;

  const rect = anchorEl.getBoundingClientRect();

  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  const left = rect.left + scrollX;
  const top  = rect.bottom + scrollY + 6;

  picker.style.left = left + 'px';
  picker.style.top  = top + 'px';
}

window.addEventListener('scroll', () => {
  const { anchorEl } = BOTTLE_PICKER_STATE;
  if (!anchorEl) return;

  const picker = getBottleHierarchyPickerEl();
  if (!picker || picker.hidden) return;

  positionBottleHierarchyPicker(anchorEl);
});

window.addEventListener('resize', () => {
  const { anchorEl } = BOTTLE_PICKER_STATE;
  if (!anchorEl) return;

  const picker = getBottleHierarchyPickerEl();
  if (!picker || picker.hidden) return;

  positionBottleHierarchyPicker(anchorEl);
});

function openBottleHierarchyPicker(tr, anchorEl = null) {
  if (!tr) return;

  const picker = getBottleHierarchyPickerEl();
  if (!picker) return;

  const resolvedAnchor =
    anchorEl ||
    tr.querySelector('.bottle-hierarchy-btn') ||
    tr.querySelector('.bottleDetails');

  BOTTLE_PICKER_STATE.tr = tr;
  BOTTLE_PICKER_STATE.anchorEl = resolvedAnchor;
  BOTTLE_PICKER_STATE.detail = tr.querySelector('.bottleDetails')?.value || '';
  BOTTLE_PICKER_STATE.split  = tr.querySelector('.splitCount')?.value || '';
  BOTTLE_PICKER_STATE.qty    = tr.querySelector('.bottleQuantity')?.value || '';

  renderBottleHierarchyPicker();

  // いったん画面左上寄りに出しておく
  picker.style.left = '8px';
  picker.style.top = '8px';
  picker.hidden = false;

  // 描画後に実サイズを取って正しい位置へ再配置
  requestAnimationFrame(() => {
    if (!resolvedAnchor || !document.body.contains(resolvedAnchor)) return;
    positionBottleHierarchyPicker(resolvedAnchor);
  });
}

function closeBottleHierarchyPicker() {
  const picker = getBottleHierarchyPickerEl();
  if (!picker) return;

  picker.hidden = true;
  BOTTLE_PICKER_STATE.anchorEl = null;
}

function confirmBottleHierarchyPicker() {
  const { tr, split, qty } = BOTTLE_PICKER_STATE;
  if (!tr) return;

  const detail =
    tr.querySelector('.bottleDetails')?.value ||
    BOTTLE_PICKER_STATE.detail ||
    '';

  if (!detail) {
    alert('先に品目を選択してください。');
    return;
  }

  applyBottleHierarchySelection(
    tr,
    detail,
    String(parseInt(split, 10) || 1),
    String(parseInt(qty, 10) || 1)
  );

  closeBottleHierarchyPicker();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function repositionBottleHierarchyPickerNow() {
  const picker = getBottleHierarchyPickerEl();
  if (!picker || picker.hidden) return;

  const anchorEl = BOTTLE_PICKER_STATE.anchorEl;
  if (!anchorEl || !document.body.contains(anchorEl)) {
    closeBottleHierarchyPicker();
    return;
  }

  positionBottleHierarchyPicker(anchorEl);
}

function requestRepositionBottleHierarchyPicker() {
  if (BOTTLE_PICKER_STATE.rafId) return;

  BOTTLE_PICKER_STATE.rafId = requestAnimationFrame(() => {
    BOTTLE_PICKER_STATE.rafId = 0;
    repositionBottleHierarchyPickerNow();
  });
}

function hydrateAllBottleSelectsWithCustomOptions() {
  getCustomBottleNames().forEach(name => ensureBottleOptionExists(name));
}

function rememberBottleSelectionFromRow(row) {
  if (!row || !row.classList.contains('btl-subrow')) return;

  const detail = normalizeBottleText(
    row.querySelector('.bottleDetails')?.value ||
    row.querySelector('.bottleFreeText')?.value ||
    ''
  );
  const split = normalizeBottleNum(row.querySelector('.splitCount')?.value, '');
  const qty   = normalizeBottleNum(row.querySelector('.bottleQuantity')?.value, '');

  if (!detail) return;

  upsertCustomBottleMemory({
    detail,
    split: split || '1',
    qty: qty || '1'
  });

  ensureBottleOptionExists(detail);
}

function buildBottleHistoryMap() {
  BOTTLE_HISTORY = {};
  const list = document.getElementById('historyList');
  if (!list) return;

  const items = Array.from(list.querySelectorAll('li'));
  const re = /ボトル:\s*¥([\d,]+)（([^/（）]*?)(?:\/割:([^\s/（）]+))?(?:\/数量:([^\s/（）]+))?）/g;

  const seen = new Set();

  for (const li of items) {
    const html = li.innerHTML;
    let m;

    while ((m = re.exec(html)) !== null) {
      const amount = parseInt((m[1] || '').replace(/,/g, ''), 10) || 0;
      const detail = normalizeBottleDetail(m[2] || '');
      const split  = normalizeBottleDetail(m[3] || '');
      const qty    = normalizeBottleDetail(m[4] || '');

      if (!detail) continue;

      const id =
        encodeURIComponent(detail) + '|' +
        encodeURIComponent(split)  + '|' +
        encodeURIComponent(qty)    + '|' +
        amount;

      if (seen.has(id)) continue;
      seen.add(id);

      if (!BOTTLE_HISTORY[detail]) {
        BOTTLE_HISTORY[detail] = [];
      }

      BOTTLE_HISTORY[detail].push({ id, split, qty, amount });
    }
  }
}

function addBottleForm() {
  const container = document.getElementById('bottleFormsContainer');
  const newForm = createBottleForm(); // ←空のフォームを追加
  container.appendChild(newForm);
  refreshBottleDropdownsFromHistory();
  saveBottleForms(); // 保存
}

function autoLearnBottleHistoryFromForm(form) {
  if (!form) return;

  const detail = normalizeBottleDetail(getSelectedDetail(form) || '');
  const split  = String(form.querySelector('.splitCount')?.value || '').trim();
  const qty    = String(form.querySelector('.bottleQuantity')?.value || '').trim();
  const amountRaw = String(form.querySelector('.bottleAmount')?.value || '').replace(/,/g, '').trim();

  // 品名が空なら何もしない
  if (!detail) return;

  // 途中入力のゴミ登録を減らすため、最低限の形だけ登録
  // 例: 品名だけ選んだ時は登録しない
  if (!split && !qty && !amountRaw) return;

  // amount は数値化。空なら 0
  const amount = parseInt(amountRaw, 10) || 0;

  // 保存フォーマットは既存の登録処理に合わせる
  const record = `${detail}|${split}|${qty}|${amount}`;

  let bottleHistory = [];
  try {
    bottleHistory = JSON.parse(localStorage.getItem('BOTTLE_HISTORY') || '[]');
    if (!Array.isArray(bottleHistory)) bottleHistory = [];
  } catch (e) {
    bottleHistory = [];
  }

  // 完全一致があれば追加しない
  if (bottleHistory.includes(record)) {
    return;
  }

  // 先頭追加
  bottleHistory.unshift(record);

  // 履歴肥大化防止
  if (bottleHistory.length > 300) {
    bottleHistory = bottleHistory.slice(0, 300);
  }

  localStorage.setItem('BOTTLE_HISTORY', JSON.stringify(bottleHistory));

  if (typeof refreshBottleDropdownsFromHistory === 'function') {
    refreshBottleDropdownsFromHistory();
  }
}

function renumberHistory() {
  const items = Array.from(document.querySelectorAll('#historyList li')).reverse(); // 下から順に1,2,3
  items.forEach((item, index) => {
    const castElem = item.querySelector('.castName');
    if (castElem) {
      let text = castElem.textContent.replace(/^\s*\d+\.\s*/, ' '); // 旧番号を削除
      const nameOnly = text.replace(/^\s*/, '').trim();
      castElem.innerHTML = `<strong></strong> ${index + 1}. ${nameOnly}`;
    }
  });
}

function normalizeBottleDetail(str) {
  let s = safeDecodeText(String(str || '')).trim();
  if (!s) return '';

  // __HIST__付きの内部値が来たら、本来の品名へ戻す
  if (s.startsWith('__HIST__')) {
    s = s.replace(/^__HIST__/, '');

    const parts = s.split('|');
    const rawDetail = parts[0] || '';

    return safeDecodeText(rawDetail).trim();
  }

  return s;
}

function setBottleDetailValue(selectEl, detail) {
  if (!selectEl) return;

  const normalized = normalizeBottleDetail(detail || '');
  if (!normalized) {
    selectEl.value = '';
    return;
  }

  // 既存 option を優先
  let hit = Array.from(selectEl.options).find(opt => {
    return normalizeBottleDetail(opt.value) === normalized
        || normalizeBottleDetail(opt.dataset?.base || '') === normalized;
  });

  // 無ければ仮 option を作る
  if (!hit) {
    hit = document.createElement('option');
    hit.value = normalized;
    hit.textContent = normalized;
    hit.dataset.base = normalized;
    hit.dataset.customBottle = '1';

    const etcGroup = Array.from(selectEl.children).find(n =>
      n.tagName === 'OPTGROUP' && n.label === 'その他'
    );

    (etcGroup || selectEl).appendChild(hit);
  }

  selectEl.value = hit.value;
}

function getSelectedDetail(formOrRow) {
  if (!formOrRow) return '';

  const sel = formOrRow.querySelector('.bottleDetails');
  if (!sel) return '';

  const opt = sel.selectedOptions?.[0];
  if (!opt) {
    return normalizeBottleDetail(sel.value || '');
  }

  if (opt.dataset?.base) {
    return normalizeBottleDetail(opt.dataset.base);
  }

  return normalizeBottleDetail(sel.value || opt.value || '');
}

function confirmAndCalculate(e) {
  let subtotal = 0;
  let totalAmount = 0;
  let finalAmount = 0;

  if (e && typeof e.preventDefault === 'function') e.preventDefault();

  const castName   = document.getElementById('castName').value || '（名前なし）';
  const experience = document.getElementById('experienceAndRental').checked ? '有り' : '無し';
  const sendoff    = document.getElementById('sendoffAmount').value || '0';

  const labels = {
    f:'F', f2:'F2', jounai:'場内', honshiri:'本指', douhan:'同伴',
    eda:'枝', help:'HELP', set40:'SET40', set20:'SET20',
    vip:'VIP', a:'A', b:'B', c:'C', d:'D', e:'E'
  };

  const mainItems = [];
  Object.keys(labels).forEach(key => {
    const val = document.getElementById(key)?.value;
    if (parseInt(val)) mainItems.push(`${labels[key]} ×${val}`);
  });

  const bottles = [];
document.querySelectorAll('.bottle-form').forEach(form => {
  const det = getSelectedDetail(form);
  const spl = form.querySelector('.splitCount')?.value || '';
  const qty = form.querySelector('.bottleQuantity')?.value || '';
  const amtNum = parseInt(
    (form.querySelector('.bottleAmount')?.value || '').replace(/,/g, ''),
    10
  ) || 0;

  if (det || spl || qty || amtNum) {
    const amt = amtNum.toLocaleString();
    bottles.push(`${det}|${spl}|${qty}|${amt}`);
  }
});

  // === 手動登録時のみ確認ダイアログを表示 ===
  if (e) {
    let msg = `内容を確認してください。\n\n`
            + `キャスト名:${castName}\n体験及び貸出:${experience}\n送迎金額:¥${sendoff}\n`
            + (mainItems.length ? `--- 伝票内訳 ---\n${mainItems.join('\n')}\n` : '')
            + (bottles.length   ? `--- ボトル明細 ---\n${bottles.join('\n')}\n`   : '');
    if (!window.confirm(msg)) return false;
  }

  // --- 計算処理 ---
  if (typeof calculate === 'function') calculate();
  if (typeof updateCalculations === 'function') updateCalculations();
  requestAnimationFrame(() => navScrollTo('app2-resultSection', 'smooth'));

  // #result から合計金額を抽出
  const resultText = document.querySelector('#result')?.innerText || '';
  const match = resultText.match(/合計[^\d]*(\d[\d,]*)/);
  if (match) {
    totalAmount = parseInt(match[1].replace(/,/g,''),10);
    finalAmount = totalAmount;
  }

  // === ✅ 手動登録時のみ履歴リスト追加 ===
  if (e) {
    const historyEl = document.getElementById('historyList');
    if (historyEl) {
      const li = document.createElement('li');
      const bottleText = bottles.length
        ? bottles.map(b=>{
            const [det,spl,qty,amt]=b.split('|');
            return `¥${amt}（${det}${spl?'/割:'+spl:''}${qty?'/数量:'+qty:''}）`;
          }).join('・')
        : 'ボトルなし';
      li.textContent = `${castName}｜合計¥${finalAmount.toLocaleString()}｜${bottleText}`;
      historyEl.prepend(li);
    }
  }

  // === 🔵 ボトル履歴保存（手動・一括どちらでも） ===
  try {
    if (bottles.length > 0) {
      const bottleHistory = JSON.parse(localStorage.getItem('BOTTLE_HISTORY') || '[]');
      bottles.forEach(b => bottleHistory.unshift(b));
      localStorage.setItem('BOTTLE_HISTORY', JSON.stringify(bottleHistory));
    }
    if (typeof refreshBottleDropdownsFromHistory === 'function') {
      refreshBottleDropdownsFromHistory();
    }
  } catch (err) {
    console.warn('ボトル履歴更新時エラー:', err);
  }

  return false;
}

function restoreFromHistory(button) {
  const historyItem = button.closest('li') || button.closest('div');
  if (!historyItem) return;

  // キャスト名の復元
  const castNameElem = historyItem.querySelector('.castName');
  const castName = castNameElem ? castNameElem.textContent.replace(/^\s*\d+\.\s*/, '').trim() : '';
  document.getElementById('castName').value = castName;

  // ラベル対応表を定義（calculate関数と同じ内容）
  const labels = {
    f: 'F',
    f2: 'F2',
    jounai: '場内',
    honshiri: '本指',
    douhan: '同伴',
    eda: '枝',
    help: 'HELP',
    set40: 'SET40',
    set20: 'SET20',
    vip: 'VIP',
    a: 'A',
    b: 'B',
    c: 'C',
    d: 'D',
    e: 'E'
  };

  // 数値入力欄を復元
  const inputIds = Object.keys(labels);
  inputIds.forEach(id => {
    const label = labels[id];
    const regex = new RegExp(`${label} ×(\\d+)`);
    const match = historyItem.textContent.match(regex);
    if (match) {
      document.getElementById(id).value = match[1];
    } else {
      document.getElementById(id).value = '';
    }
  });

  // --- F（統合）の復元（新仕様/旧仕様どちらも吸収） ---
const txt = historyItem.textContent || '';
const f2Old = txt.match(/F2 ×(\d+)/);
const fNew  = txt.match(/F ×(\d+)/);

if (f2Old) {
  // 旧: F2（2000）
  document.getElementById('f2').value = f2Old[1];
  const fEl = document.getElementById('f');
  if (fEl && fEl.type === 'checkbox') fEl.checked = true;
} else if (fNew) {
  document.getElementById('f2').value = fNew[1];
  const is2000 = /F ×\d+（@?¥?2,?000/.test(txt);
  const fEl = document.getElementById('f');
  if (fEl && fEl.type === 'checkbox') fEl.checked = !!is2000;
} else {
  document.getElementById('f2').value = '';
  const fEl = document.getElementById('f');
  if (fEl && fEl.type === 'checkbox') fEl.checked = false;
}


  // 送迎金額を復元
  const sendoffMatch = (historyItem.textContent || '').match(/送迎:\s*¥([\d,]+)/);
  if (sendoffMatch) {
    document.getElementById('sendoffAmount').value = parseInt(sendoffMatch[1].replace(/,/g, ''), 10);
  } else {
    document.getElementById('sendoffAmount').value = 0;
  }

  // 体験及び貸出チェックボックスを復元（textContentかinnerHTMLにキーワードがあるか確認）
  const experienceElem = historyItem.querySelector('.experienceAndRental');
  const experienceText = experienceElem ? experienceElem.textContent : '';
  const experienceChecked = experienceText.includes('体験及び貸出: 有り');
  document.getElementById('experienceAndRental').checked = experienceChecked;

  // ボトル明細を復元
  const bottleRegex = /ボトル:\s*¥([\d,]+)（([^/（）]*?)(?:\/割:([^\s/（）]+))?(?:\/数量:([^\s/（）]+))?）/g;

  // 復元用のループ
  const bottles = [];
  let match;
  while ((match = bottleRegex.exec(historyItem.innerHTML)) !== null) {
  bottles.push({
    bottleAmount: parseInt(match[1].replace(/,/g, '')),
    bottleDetails: match[2] || '',
    splitCount: match[3] || '',
    bottleQuantity: match[4] || ''
  });
  }

  // 復元して配置
  const container = document.getElementById('bottleFormsContainer');
  container.innerHTML = '';
  bottles.forEach(data => {
  const bottleForm = createBottleForm(
    data.bottleDetails,
    data.splitCount,
    data.bottleQuantity,
    data.bottleAmount
  );
  container.appendChild(bottleForm);
  });

  // 保存処理（現在の復元状態を保存しておく）
  saveBottleForms();

    // ページ上部にスクロール
  window.scrollTo({ top: 0, behavior: 'smooth' });

}

function moveHistoryItem(button, direction) {
  const listItem = button.closest('li');
  if (!listItem) return;

  const parentList = listItem.parentNode;
  let targetItem = null;

  if (direction === 'up' && listItem.previousElementSibling) {
    targetItem = listItem.previousElementSibling;
    parentList.insertBefore(listItem, targetItem);
  } else if (direction === 'down' && listItem.nextElementSibling) {
    targetItem = listItem.nextElementSibling;
    parentList.insertBefore(targetItem, listItem);
  }

  requestAnimationFrame(() => {
    listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  renumberHistory();
  localStorage.setItem('historyList', parentList.innerHTML);
  updateSummary();

  if (typeof window.createHistoryIndex === 'function') {
    window.createHistoryIndex();
  }
}

function deleteSelectedHistory() {
  const historyList = document.getElementById('historyList');
  const items = historyList.querySelectorAll('li');

  const checkedItems = Array.from(items).filter(item => {
    const checkbox = item.querySelector('.history-checkbox');
    return checkbox && checkbox.checked;
  });

  if (checkedItems.length === 0) {
    alert('削除する履歴を選択してください');
    return;
  }

  const deletedNames = [];

  checkedItems.forEach(item => {
    const nameElem = item.querySelector('.castName');
    const name = nameElem ? nameElem.textContent.replace('', '').trim() : '不明';

    const confirmed = confirm(`「${name}」の履歴を削除しますか？`);
    if (confirmed) {
      deletedNames.push(name);
      item.remove();
    }
  });

  localStorage.setItem('historyList', historyList.innerHTML);
  updateSummary();
  refreshBottleDropdownsFromHistory();

  if (typeof window.createHistoryIndex === 'function') {
    window.createHistoryIndex();
  }

  if (deletedNames.length > 0) {
    const msg = deletedNames.map(name => `${name} の履歴は削除されました。`).join('\n');
    alert(msg);
  }

  if (typeof window.createHistoryIndex === 'function') {
  window.createHistoryIndex();
}

}

function toggleDetails(button) {
  const container = button.nextElementSibling.nextElementSibling; 
  // ボタンのすぐ次のボタンの次のdiv（details-html-container）を取得
  if (container.style.display === 'none' || container.style.display === '') {
    container.style.display = 'block';
    button.textContent = '詳細を隠す';
  } else {
    container.style.display = 'none';
    button.textContent = '詳細を表示';
  }
}

function calculateBack() {
  const inputs = {
    f: document.getElementById("f"),               // 2kチェック
    f2: document.getElementById("f2"),             // F数量
    jounai: document.getElementById("jounai"),
    honshiri: document.getElementById("honshiri"),
    douhan: document.getElementById("douhan"),
    eda: document.getElementById("eda"),
    help: document.getElementById("help"),
    set40: document.getElementById("set40"),
    set20: document.getElementById("set20"),
    vip: document.getElementById("vip"),
    a: document.getElementById("a"),
    b: document.getElementById("b"),
    c: document.getElementById("c"),
    d: document.getElementById("d"),
    e: document.getElementById("e")
  };

  const values = {
    jounai: 1000,
    honshiri: 0,
    douhan: 1500,
    eda: 500,
    help: -1500,
    set40: 5500,
    set20: 3500,
    vip: 2000,
    a: 500,
    b: 1000,
    c: 1500,
    d: 2000,
    e: 2500
  };

  const labels = {
    f: "F",
    jounai: "場内",
    honshiri: "本指",
    douhan: "同伴",
    eda: "枝",
    help: "HELP",
    set40: "SET40",
    set20: "SET20",
    vip: "VIP",
    a: "A",
    b: "B",
    c: "C",
    d: "D",
    e: "E"
  };

  const getNum = (el) => {
    return parseInt(String(el?.value || "0").replace(/,/g, ""), 10) || 0;
  };

  let total = 0;
  const detailLines = [];

  // =========================================================
  // Fだけ特別処理
  // f  = チェックボックス（OFF:1500 / ON:2000）
  // f2 = 数量
  // =========================================================
  const fCount = getNum(inputs.f2);
  if (fCount > 0) {
    const fUnit = inputs.f?.checked ? 2000 : 1500;
    const fTotal = fCount * fUnit;

    total += fTotal;
    detailLines.push(`${labels.f} × ${fCount}（¥${fUnit.toLocaleString()}）= ¥${fTotal.toLocaleString()}`);
  }

  // =========================================================
  // その他の固定単価項目
  // =========================================================
  Object.keys(values).forEach((key) => {
    const count = getNum(inputs[key]);
    if (count <= 0) return;

    const unitPrice = values[key];
    const itemTotal = count * unitPrice;

    total += itemTotal;

    const absUnit = Math.abs(unitPrice).toLocaleString();
    const absTotal = Math.abs(itemTotal).toLocaleString();

    if (unitPrice < 0) {
      detailLines.push(`${labels[key]} × ${count}（-¥${absUnit}）= -¥${absTotal}`);
    } else {
      detailLines.push(`${labels[key]} × ${count}（¥${absUnit}）= ¥${absTotal}`);
    }
  });

  const totalEl = document.getElementById("backTotal");
  const detailEl = document.getElementById("backDetails");

  if (totalEl) {
    totalEl.textContent = `¥${total.toLocaleString()}`;
  }

  if (detailEl) {
    detailEl.value = detailLines.join("\n");
  }

  return total;
}

function restoreCheckboxes() {
  const checkboxStates = JSON.parse(localStorage.getItem('checkboxes')) || {};
  document.getElementById('experienceAndRental').checked = checkboxStates.experienceAndRental || false;

  const fEl = document.getElementById('f');
  if (fEl && fEl.type === 'checkbox') {
    fEl.checked = !!checkboxStates.fUnit2000;
  }
}

function restoreInputs() {
  const inputValues = JSON.parse(localStorage.getItem('inputs') || '{}');
  Object.entries(inputValues).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
}

// --- app2フォームの十字キー移動 ---
(function(){
  // 移動対象input,selectの共通セレクタ（動的増減対応）
  function getApp2Fields() {
    // app2内のフォーム全体（bottle-form含む）
    return Array.from(document.querySelectorAll(
      '#app2 section#app2-inputSection input:not([type=hidden]):not([disabled]), ' +
      '#app2 section#app2-inputSection select:not([disabled])'
    )).filter(el => el.offsetParent !== null); // 表示のみ
  }

  document.addEventListener('keydown', function(e) {
    // app2以外は無視
    if (!document.getElementById('app2').classList.contains('active')) return;

    // 矢印以外は無視
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;

    const target = e.target;
    // 対象がapp2内のinputかselectか
    if (!target.closest('#app2')) return;
    if (!['INPUT','SELECT'].includes(target.tagName)) return;

    // input/textareaの左右はカーソル移動優先
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (target.selectionStart !== target.selectionEnd)) {
      // 入力値内でのキャレット移動を優先させる
      if ((e.key === 'ArrowLeft' && target.selectionStart > 0) ||
          (e.key === 'ArrowRight' && target.selectionStart < target.value.length)) {
        return; // 何もしない
      }
    }

    // ここでフォーム群取得
    const fields = getApp2Fields();
    const idx = fields.indexOf(target);
    if (idx === -1) return;

    // 配置を2次元配列化
    const fieldMap = [];
    let lastTop = null, row = [];
    fields.forEach(f=>{
      const top = f.getBoundingClientRect().top;
      if (lastTop !== null && Math.abs(top-lastTop) > 8) {
        fieldMap.push(row);
        row = [];
      }
      row.push(f);
      lastTop = top;
    });
    if (row.length) fieldMap.push(row);

    // 現在位置を特定
    let rowIdx = -1, colIdx = -1;
    fieldMap.forEach((row,i)=>{
      const j = row.indexOf(target);
      if(j>=0){ rowIdx=i; colIdx=j; }
    });
    if(rowIdx===-1||colIdx===-1) return;

    // 移動先を決定
    let next;
    if(e.key==='ArrowLeft'){
      next = fieldMap[rowIdx][colIdx-1];
    }
    if(e.key==='ArrowRight'){
      next = fieldMap[rowIdx][colIdx+1];
    }
    if(e.key==='ArrowUp'){
      for(let up=rowIdx-1;up>=0;up--){
        if(fieldMap[up][colIdx]){ next=fieldMap[up][colIdx]; break;}
      }
    }
    if(e.key==='ArrowDown'){
      for(let dn=rowIdx+1;dn<fieldMap.length;dn++){
        if(fieldMap[dn][colIdx]){ next=fieldMap[dn][colIdx]; break;}
      }
    }

    if(next){
      e.preventDefault();
      next.focus();
      if(typeof next.select==='function') next.select();
    }
  });
})();

function updateSummary() {
  const historyItems = document.querySelectorAll('#historyList li');
  let totalPeople = 0;
  let totalAmount = 0;
  let totalGensen = 0;

  historyItems.forEach(item => {
    const text = item.innerText;
    const amountMatch = text.match(/合計:\s*¥([\d,]+)/);
    const gensenMatch = text.match(/源泉費:\s*¥([\d,]+)/);

    if (amountMatch) {
      const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
      totalAmount += amount;
    }

    if (gensenMatch) {
      const gensen = parseInt(gensenMatch[1].replace(/,/g, ''), 10);
      totalGensen += gensen;
    }

    totalPeople += 1;
  });

  document.getElementById('summaryTotalPeople').innerText = `${totalPeople}人`;
  document.getElementById('summaryTotalAmount').innerText = `¥${totalAmount.toLocaleString()}`;
  document.getElementById('summaryTotalTax').innerText = `¥${totalGensen.toLocaleString()}`;

  // カンマ付きでセット
  document.getElementById('femaleSalary').value = totalAmount.toLocaleString();
  document.getElementById('femaleTax').value = totalGensen.toLocaleString();
}

// ====== 履歴インデックス生成 ======
// CSS変数(px)を取得（フォールバック付）
function getVarPx(name, fallback = 0){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// 固定ヘッダ（タブ＋サブナビ）の総高さを取得
function getNavOffsetPx(){
  const tabs = document.querySelector('.tabs')?.offsetHeight ?? getVarPx('--tabs-h', 56);
  const sub  = document.querySelector('#app2-nav')?.offsetHeight ?? getVarPx('--subnav-h', 50);
  return tabs + sub + 10; // 仕上げの余白10px
}

// インデックス置き場（テーブル）を確保 or 作成（app2-inputSection の直前）
function ensureHistoryIndexTable(){
  let table = document.getElementById('historyIndexTable');
  if (table) return table;

  const inputSection = document.getElementById('app2-inputSection'); // ←ここを基準に差し込み
  if (!inputSection) return null;

  table = document.createElement('table');
  table.id = 'historyIndexTable';
  table.className = 'history-index-table';
table.innerHTML = `
  <thead>
    <tr>
      <th>
        <button id="historyIndexToggle" class="history-index-toggle" type="button">
          <span class="history-index-title">履歴</span>
          <span id="historyIndexCount" class="history-index-count">0人</span>
          <span class="caret">▾</span>
        </button>
      </th>
    </tr>
  </thead>
  <tbody id="historyIndexBody"></tbody>
`;

  // app2-inputSection の「直前」に追加（フォームの上に出す）
  inputSection.parentNode.insertBefore(table, inputSection);
  return table;
}

// 先頭の連番「1. 」「１）」「#3 」などを削除
function stripLeadingSerial(s){
  if (!s) return '';
  return s.replace(
    /^\s*(?:No\.|#)?\s*[0-9０-９]+\s*[\)\]）.．、:：-]?\s*/u,
    ''
  ).trim();
}

function addOutputButtonsNextToRestore() {
  const historySection = document.getElementById('app2-historySection');
  if (!historySection) return;

  let items = historySection.querySelectorAll('.history-item');
  if (items.length === 0) {
    const list = document.getElementById('historyList');
    if (list) items = list.querySelectorAll('li');
  }
  if (!items.length) return;

  items.forEach(item => {
    if (item.querySelector('.output-btn')) return;

    // 復元ボタン探す
    const restoreBtn = Array.from(item.querySelectorAll('button'))
      .find(b => b.textContent.includes('復元'));
    if (!restoreBtn) return;

    // 出力ボタン生成
    const outBtn = document.createElement('button');
    outBtn.className = 'output-btn';
    outBtn.textContent = '出力';
    outBtn.style.marginLeft = '8px';

    outBtn.addEventListener('click', async e => {
      e.stopPropagation();

      // 1️⃣ 該当の復元ボタンをクリック
      restoreBtn.click();

      // 2️⃣ 復元処理が終わるまで少し待つ（非同期処理対策）
      await new Promise(res => setTimeout(res, 800));

      // 3️⃣ 既存の出力処理（preparePrintApp2）を呼ぶ
      if (typeof window.preparePrintApp2 === 'function') {
        preparePrintApp2('envelope');
      } else {
        alert('出力機能が見つかりません。');
      }
    });

    // 復元の右横に設置
    restoreBtn.insertAdjacentElement('afterend', outBtn);

    // 並びはCSSに任せる（親にクラスを付与）
    const parent = restoreBtn.parentElement;
    parent.classList.add('history-actions');

    // ついでに ↑/↓ ボタンがあれば統一クラスを付与
    const upBtn   = Array.from(parent.querySelectorAll('button')).find(b => b.textContent.trim() === '↑');
    const downBtn = Array.from(parent.querySelectorAll('button')).find(b => b.textContent.trim() === '↓');
    [restoreBtn, outBtn, upBtn, downBtn].forEach(b => b && b.classList.add('history-action'));
    });
}

/* 金額フォーマット（既存にあるなら差し替えてOK） */
function fmtYen(n){
  if(n == null || n === "") return "¥0";
  const x = Number(n);
  return "¥" + (isFinite(x) ? x.toLocaleString() : String(n));
}

/* 既存の履歴UIを「氏名・小計・合計」だけにトリミング */
function slimHistoryUI(){
  const root = document.querySelector('#app2-historySection') || document;
  const items = root.querySelectorAll('.history-item');
  if(!items.length) return;

  items.forEach(it => {
    // 1) 本文候補（実装違いに強めにしてある）
    const body = it.querySelector('.history-details, .history-body, .history-text, pre, .details, .history') || it;

    // 2) 元テキストを行に分割
    const lines = body.innerText
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    // 3) 必要行を抽出（氏名／小計／合計(最終合計も拾う)）
    //   - 氏名：明確に「氏名:」「名前:」が無い場合、"1. XXX" や先頭の人名らしき行を拾う
    let nameLine =
      lines.find(s => /^氏名[:：]/.test(s)) ||
      lines.find(s => /^名前[:：]/.test(s)) ||
      lines.find(s => /^\d+\s*[\.、]\s*\S+/.test(s)) ||   // 例: "1. TEST"
      lines.find(s => /対象|様|さん/.test(s));

    // 小計
    let subtotalLine = lines.find(s => /^小計[:：]/.test(s));

    // 合計（「最終合計」「合　¥123,456」等にも対応）
    let totalLine =
      lines.find(s => /^(最終)?合計[:：]/.test(s)) ||
      lines.find(s => /^合\s*¥/.test(s));

    // 4) もしテキストから拾えない場合、データ属性がある想定もフォールバック
    //    （history要素に dataset があるなら使う）
    const ds = it.dataset || {};
    const n = ds.name || ds.customerName;
    const sub = ds.subtotal || ds.subTotal;
    const fin = ds.final || ds.total || ds.finalAmount;

    if(!nameLine && n) nameLine = '氏名：' + n;
    if(!subtotalLine && sub != null) subtotalLine = '小計：' + fmtYen(sub);
    if(!totalLine && fin != null) totalLine = '合計：' + fmtYen(fin);

    // 5) 表示HTMLを差し替え（現行の雰囲気を壊さず左右2カラム風）
    const frag = document.createElement('div');
    frag.className = 'history-summary';
    frag.innerHTML = [
      nameLine ? `<div class="history-summary-row"><span class="label">氏名</span><span class="value">${(nameLine.replace(/^氏名[:：]\s*/,'')).replace(/^\d+\s*[\.、]\s*/,'')}</span></div>` : '',
      subtotalLine ? `<div class="history-summary-row"><span class="label">小計</span><span class="value">${subtotalLine.replace(/^小計[:：]\s*/,'')}</span></div>` : '',
      totalLine ? `<div class="history-summary-row"><span class="label">合計</span><span class="value">${totalLine.replace(/^(最終)?合計[:：]\s*/,'').replace(/^合\s*/,'')}</span></div>` : ''
    ].join('');

    body.innerHTML = '';        // 旧テキストを消す
    body.appendChild(frag);     // 新サマリーを入れる

    // 6) アクションボタンを「復元・出力」に整理
    const act = it.querySelector('.history-actions');
    if(act){
      // 不要（↑/↓）は削除
      act.querySelectorAll('[data-role="up"],[data-role="down"],.history-action--up,.history-action--down')
         .forEach(el => el.remove());

      // 「復元」「出力」がなければ追加（クラス名やハンドラは既存に合わせて！）
      const hasRestore = act.querySelector('[data-role="restore"], .history-restore');
      const hasExport  = act.querySelector('[data-role="export"], .history-export, .output-btn');

      if(!hasRestore){
        const b = document.createElement('button');
        b.className = 'history-restore';
        b.textContent = '復元';
        b.addEventListener('click', () => {
          const id = it.dataset.id || it.getAttribute('data-id');
          window.restoreHistory && window.restoreHistory(id, it);
        });
        act.appendChild(b);
      }
      if(!hasExport){
        const b = document.createElement('button');
        b.className = 'history-export output-btn';
        b.textContent = '出力';
        b.addEventListener('click', () => {
          const id = it.dataset.id || it.getAttribute('data-id');
          window.exportHistory && window.exportHistory(id, it);
        });
        act.appendChild(b);
      }

      // 2列グリッドを適用
      act.style.display = 'grid';
      act.style.gridTemplateColumns = 'repeat(2, 1fr)';
      act.style.gap = '8px';
    }
  });
}

(function(){
  const nav = document.getElementById('app2-nav');
  if (!nav) return;

  // 既存のボタン群に一括・個別ボタンを追加
  const bulkBtn = document.createElement('button');
  bulkBtn.id = 'scrollToBulk';
  bulkBtn.textContent = '一括';

  const indivBtn = document.createElement('button');
  indivBtn.id = 'scrollToIndiv';
  indivBtn.textContent = '個別';

  // nav 内に重複防止して追加
  if (!document.getElementById('scrollToBulk')) {
    nav.insertBefore(bulkBtn, nav.children[1] || null);
  }
  if (!document.getElementById('scrollToIndiv')) {
    nav.insertBefore(indivBtn, nav.children[2] || null);
  }

  // スクロールイベント
  bulkBtn.addEventListener('click', () => {
    const grid = document.getElementById('bulkGrid');
    if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  indivBtn.addEventListener('click', () => {
    const firstForm = document.querySelector('#app2 .group, #app2 .bottle-form');
    if (firstForm) firstForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // グリッドが存在しない場合は非表示にする
  function updateButtonVisibility() {
    const gridVisible = !!document.getElementById('bulkGrid');
    bulkBtn.style.display = gridVisible ? '' : 'none';
    indivBtn.style.display = gridVisible ? '' : 'none';
  }

  // 初期化
  updateButtonVisibility();
  const observer = new MutationObserver(updateButtonVisibility);
  observer.observe(document.body, { childList: true, subtree: true });
})();

//app2個別一括スクロール関数開始
(function(){
  const nav = document.getElementById('app2-nav');
  if (!nav) return;

  // ===== 画面に見えているか判定 =====
  function isVisible(el){
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // ===== 固定ヘッダ＋微調整付きスクロール =====
  function getBaseOffset(){
    const tabs  = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tabs-h'))   || 56;
    const sub   = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--subnav-h')) || 50;
    return tabs + sub + 10; // 既定の余白
  }
  function scrollToAnchor(anchorEl, extraAdjust = 0){
    if (!anchorEl) return;
    const top = anchorEl.getBoundingClientRect().top + window.scrollY - (getBaseOffset() - extraAdjust);
    window.scrollTo({ top, behavior: 'smooth' });
  }

  // ===== ボタン生成（重複防止） =====
  function ensureButton(id, label, index){
    let btn = document.getElementById(id);
    if (!btn){
      btn = document.createElement('button');
      btn.id = id; btn.type = 'button'; btn.textContent = label;
      nav.insertBefore(btn, nav.children[index] || null);
    }
    return btn;
  }
  const bulkBtn  = ensureButton('scrollToBulk',  '一括', 1);
  const indivBtn = ensureButton('scrollToIndiv', '個別', 2);

  // ===== 微調整値（PC/SPで少し変える） =====
  const mq = window.matchMedia('(max-width:700px)');
  function getAdjust(){
    const sp = mq.matches;
    return {
      bulk : sp ? 10 : 6,   // ← SS1 の“表ヘッダがちょうど出る”感じ
      indiv: sp ? 18 : 14   // ← SS2 の“個別フォームの見出しが収まる”感じ
    };
  }

    // ===== クリック挙動 =====
  bulkBtn.addEventListener('click', () => {
    const gridHead = document.querySelector('#bulkGrid thead') || document.getElementById('bulkGrid');
    scrollToAnchor(gridHead, getAdjust().bulk);
  });

  indivBtn.addEventListener('click', () => {
    // キャスト名フィールドを基準にスクロール
    const castInput = document.getElementById('castName');
    if (castInput) {
      // オフセット計算を統一関数から取得
      const offset = getBaseOffset() + 25;  // 上に少し余白を残して止まるよう調整
      const y = castInput.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    } else {
      // フォールバック（旧ロジック）
      const firstIndiv = document.querySelector('#app2 .group, #app2 .bottle-form');
      scrollToAnchor(firstIndiv, getAdjust().indiv);
    }
  });

  // ===== 表示制御（App2かつ #bulkGrid が可視のときだけ） =====
  function updateButtons(){
    const isApp2 = document.body.getAttribute('data-active-app') === 'app2';
    const grid   = document.getElementById('bulkGrid');
    const show   = isApp2 && isVisible(grid);
    bulkBtn.style.display  = show ? '' : 'none';
    indivBtn.style.display = show ? '' : 'none';
  }
  updateButtons();

  // 監視（タブ切替・表示切替・スタイル変更）
  const mo = new MutationObserver(updateButtons);
  mo.observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-active-app','class','style']
  });
  mq.addEventListener?.('change', () => {}); // 端末幅で補正値が切替るが、スクロール時に都度取得するので処理は不要

  window.addEventListener('resize', updateButtons);
  document.addEventListener('click', (e)=>{
    if (e.target.closest('#app2') && (e.target.matches('button,[role="button"]'))) {
      requestAnimationFrame(updateButtons);
    }
  });
})();

function requestImmediateFirebaseSyncSafe(reason = '') {
  if (typeof window.canSyncNow === 'function' && !window.canSyncNow()) {
    return;
  }

  if (typeof window.saveAllApps === 'function') {
    Promise.resolve(window.saveAllApps()).catch(err => {
      console.error(`[APP2 sync] ${reason}`, err);
    });
  }
}

//app2一括入力
(function () {

  // === カラム定義 ============================================================
  const COLS = [
    { key: 'name', type: 'text',  header: '氏名', cls: 'bulk-name' },
    { key: 'exp',  type: 'check', header: '体貸', cls: 'bulk-exp' },
    { key: 'send', type: 'num',   header: '送迎', cls: 'bulk-send' },
    { key: 'f',    type: 'check', header: '2k' },
    { key: 'f2',   type: 'num',   header: 'F'  },
    { key: 'jounai',   type: 'num', header: '場内' },
    { key: 'honshiri', type: 'num', header: '本指' },
    { key: 'douhan',   type: 'num', header: '同伴' },
    { key: 'eda',      type: 'num', header: '枝' },
    { key: 'help',     type: 'num', header: 'HE' },
    { key: 'set40',    type: 'num', header: '40' },
    { key: 'set20',    type: 'num', header: '20' },
    { key: 'vip',      type: 'num', header: 'VIP' },
    { key: 'a',        type: 'num', header: 'A' },
    { key: 'b',        type: 'num', header: 'B' },
    { key: 'c',        type: 'num', header: 'C' },
    { key: 'd',        type: 'num', header: 'D' },
    { key: 'e',        type: 'num', header: 'E' },
    { key: 'btl_detail', type: 'text', header: '品名' },
    { key: 'btl_split',  type: 'num',  header: '割' },
    { key: 'btl_qty',    type: 'num',  header: '数量' },
    { key: 'btl_amount', type: 'num',  header: '金額' }
  ];

  // === 定数 ================================================================
  const PANEL_KEY = 'app2_bulkPanelVisible';
  const GRID_KEY  = 'app2_bulkGridData';

  // === 共通ユーティリティ ====================================================
  function norm(v) {
    if (v === 0 || v === '0') return '';
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function getBottleOptionsHTML() {
    const inPage = document.querySelector('#bottleFormsContainer select.bottleDetails');
    if (inPage && inPage.innerHTML.trim()) {
      return inPage.innerHTML;
    }
    return typeof BOTTLE_OPTIONS_HTML !== 'undefined' ? BOTTLE_OPTIONS_HTML : '';
  }

  function setValue(id, val) {
    const el = document.getElementById(id);
    if (!el) return;

    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setChecked(id, v) {
    const el = document.getElementById(id);
    if (!el) return;

    el.checked = !!v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function savePanelState(visible) {
    localStorage.setItem(PANEL_KEY, visible ? '1' : '0');
  }

  function requestImmediateFirebaseSyncSafe(reason = '') {
    if (typeof window.canSyncNow === 'function' && !window.canSyncNow()) {
      return;
    }

    if (typeof window.saveAllApps === 'function') {
      Promise.resolve(window.saveAllApps()).catch(err => {
        console.error(`[APP2 sync] ${reason}`, err);
      });
    }
  }

  // === サブ行取得 ===========================================================
  function getBottleSubrows(mainTr) {
    const arr = [];
    let n = mainTr.nextElementSibling;

    while (n && n.classList.contains('btl-subrow')) {
      arr.push(n);
      n = n.nextElementSibling;
    }
    return arr;
  }

  // === サブ行削除 ===========================================================
  function removeBottleSubrow(mainTr, subTr) {
    if (!mainTr) return;

    const subs = getBottleSubrows(mainTr);
    if (!subs.length) {
      const minusBtn0 = mainTr.querySelector('.btl-minus');
      if (minusBtn0) minusBtn0.disabled = true;
      mainTr.dataset.bottleCount = '0';
      return;
    }

    let target = subTr;

    if (!target || !target.classList || !target.classList.contains('btl-subrow')) {
      target = subs[subs.length - 1];
    }

    if (!subs.includes(target)) return;

    target.remove();

    const remain = getBottleSubrows(mainTr);
    const minusBtn = mainTr.querySelector('.btl-minus');
    if (minusBtn) {
      minusBtn.disabled = remain.length <= 0;
    }

    mainTr.dataset.bottleCount = String(remain.length);

    if (typeof saveBulkGridState === 'function') {
      saveBulkGridState();
    }

    if (typeof window.scheduleApp3Update === 'function') {
      window.scheduleApp3Update('removeBottleSubrow');
    }
  }

function addBottleSubrow(mainTr) {
  const { grid } = getBulkDom();
  if (!grid || !mainTr) return null;

  const cols = grid?.tHead?.rows?.[0]?.cells?.length || 0;
  const hasLeaveCol = cols >= 24;

  const realCols = hasLeaveCol ? 5 : 4;
  const padCount = Math.max(0, cols - realCols);

  const tr = document.createElement('tr');
  tr.className = 'btl-subrow';

  let html = '';

  for (let i = 0; i < padCount; i++) {
    html += '<td class="btl-pad"></td>';
  }

  html += `
    <td class="btl-cell btl-detail-cell btl-group-start">
      <div class="btl-field-wrap btl-detail-wrap">
        <button type="button" class="bottle-hierarchy-btn" aria-label="ボトル選択">選択</button>
        <select class="bottleDetails">
          <option value=""></option>
          ${getBottleOptionsHTML()}
        </select>
      </div>
    </td>

    <td class="btl-cell btl-split-cell">
      <input
        type="text"
        class="splitCount bulk-custom-keypad-target"
        inputmode="numeric"
        placeholder="割"
      >
    </td>

    <td class="btl-cell btl-qty-cell">
      <input
        type="text"
        class="bottleQuantity bulk-custom-keypad-target"
        inputmode="numeric"
        placeholder="数量"
      >
    </td>

    <td class="btl-cell btl-amount-cell">
      <input
        type="text"
        class="bottleAmount bulk-custom-keypad-target"
        inputmode="numeric"
        placeholder="金額"
      >
    </td>

    ${hasLeaveCol ? '<td class="btl-pad"></td>' : ''}
  `;

  tr.innerHTML = html;

  let anchor = mainTr;
  while (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('btl-subrow')) {
    anchor = anchor.nextElementSibling;
  }
  anchor.insertAdjacentElement('afterend', tr);

  // 追加直後は必ず「未選択」
  const detailSelect = tr.querySelector('.bottleDetails');
  if (detailSelect) {
    detailSelect.value = '';
    detailSelect.selectedIndex = 0;
  }

  const splitInput = tr.querySelector('.splitCount');
  const qtyInput   = tr.querySelector('.bottleQuantity');
  const amtInput   = tr.querySelector('.bottleAmount');

  if (splitInput) splitInput.value = '';
  if (qtyInput)   qtyInput.value = '';
  if (amtInput)   amtInput.value = '';

  const minusBtn = mainTr.querySelector('.btl-minus');
  if (minusBtn) {
    minusBtn.disabled = false;
  }

  const count = getBottleSubrows(mainTr).length;
  mainTr.dataset.bottleCount = String(count);

  if (typeof window.applyReadonlyToCustomKeypadTargets === 'function') {
    window.applyReadonlyToCustomKeypadTargets();
  }

  if (typeof saveBulkGridState === 'function') {
    saveBulkGridState();
  }

  if (typeof window.scheduleApp3Update === 'function') {
    window.scheduleApp3Update('addBottleSubrow');
  }

  return tr;
}

function forceBulkGridColumnWidths(widths) {
  const grid = document.getElementById('bulkGrid');
  if (!grid || !Array.isArray(widths)) return;

  grid.style.tableLayout = 'fixed';
  grid.style.width = '100%';
  grid.style.borderCollapse = 'collapse';

  // colgroup 作り直し
  let cg = grid.querySelector('colgroup');
  if (cg) cg.remove();

  cg = document.createElement('colgroup');

  widths.forEach(w => {
    const col = document.createElement('col');
    col.style.width = w;
    cg.appendChild(col);
  });

  grid.insertBefore(cg, grid.firstChild);

  // thead
  const headRow = grid.tHead?.rows?.[0];
  if (headRow) {
    [...headRow.cells].forEach((cell, i) => {
      const w = widths[i] || '';
      cell.style.width = w;
      cell.style.minWidth = w;
      cell.style.maxWidth = w;
    });
  }

  // tbody
  [...grid.tBodies[0].rows].forEach(tr => {
    [...tr.cells].forEach((cell, i) => {
      const w = widths[i] || '';
      cell.style.width = w;
      cell.style.minWidth = w;
      cell.style.maxWidth = w;
    });
  });
}

  // === グリッド構築 =========================================================
function buildGrid(n) {
  const { grid } = getBulkDom();
  if (!grid) return;

  const thead = grid.querySelector('thead');
  const tbody = grid.querySelector('tbody');
  if (!thead || !tbody) return;

  grid.querySelectorAll('colgroup').forEach(el => el.remove());

  grid.querySelectorAll('thead th, tbody td, tbody tr').forEach(el => {
    el.style.display = '';
    el.style.width = '';
    el.style.minWidth = '';
    el.style.maxWidth = '';
  });

  grid.style.tableLayout = 'fixed';
  grid.style.width = '100%';
  grid.style.borderCollapse = 'collapse';

  const wrap = grid.closest('.bulk-grid-wrap');
  if (wrap) wrap.style.overflowX = '';

  const vw = Math.min(window.innerWidth, window.outerWidth || window.innerWidth);
  const vh = Math.min(window.innerHeight, window.outerHeight || window.innerHeight);

  const isLandscape = vw > vh;
  const hasTouchLike =
    (navigator.maxTouchPoints > 0) ||
    window.matchMedia('(pointer: coarse)').matches;

  // iPad mini 実機・DevToolsエミュレーション両対応
  const isCompactLandscapeApp2 =
    hasTouchLike &&
    isLandscape &&
    vw <= 1300;

  const widths = isCompactLandscapeApp2
    ? [
        '3.0%',  // #
        '2.0%',  // 選択
        '5.5%',  // 氏名
        '2.8%',  // 体/貸
        '5.5%',  // 送迎

        '2.5%',  // 2k
        '3.8%',  // F
        '3.0%',  // 場内
        '3.0%',  // 本指
        '3.0%',  // 同伴
        '3.0%',  // 枝
        '2.5%',  // HE
        '3.0%',  // 40
        '3.0%',  // 20
        '3.0%',  // VIP
        '2.5%',  // A
        '2.5%',  // B
        '3.8%',  // C
        '3.8%',  // D
        '3.8%',  // E

        '16.4%', // 品名
        '3.0%',  // 割
        '3.0%',  // 数量
        '7.6%',  // 金額
        '2.0%'   // 退
      ]
    : [
        '2.2%',  // #
        '2.2%',  // 選択
        '6.8%',  // 氏名
        '3.2%',  // 体/貸
        '5.0%',  // 送迎

        '3.2%',  // 2k
        '3.2%',  // F
        '3.2%',  // 場内
        '3.2%',  // 本指
        '3.2%',  // 同伴
        '3.2%',  // 枝
        '3.2%',  // HE
        '3.2%',  // 40
        '3.2%',  // 20
        '3.2%',  // VIP
        '3.2%',  // A
        '3.2%',  // B
        '3.2%',  // C
        '3.2%',  // D
        '3.2%',  // E

        '12.0%', // 品名
        '3.0%',  // 割
        '3.0%',  // 数量
        '8.8%',  // 金額
        '3.0%'   // 退
      ];

  thead.innerHTML = '';
  const trh = document.createElement('tr');

  const thNo = document.createElement('th');
  thNo.textContent = '#';
  trh.appendChild(thNo);

  const thSel = document.createElement('th');
  thSel.className = 'bulk-check-head';
  thSel.innerHTML = `<input type="checkbox" id="bulkCheckAll">`;
  trh.appendChild(thSel);

  COLS.forEach(c => {
    const th = document.createElement('th');
    th.textContent = c.header;
    trh.appendChild(th);
  });

  if (!COLS.some(c => c && c.header === '退')) {
    const thLeave = document.createElement('th');
    thLeave.textContent = '退';
    thLeave.className = 'bulk-leave-head';
    trh.appendChild(thLeave);
  }

  thead.appendChild(trh);
  tbody.innerHTML = '';

  const placeholders = {
    f2: 'F',
    jounai: '場内',
    honshiri: '本指',
    douhan: '同伴',
    eda: '枝',
    help: 'HE',
    set40: '40',
    set20: '20',
    vip: 'VIP',
    a: 'A',
    b: 'B',
    c: 'C',
    d: 'D',
    e: 'E'
  };

  for (let i = 1; i <= n; i++) {
    const tr = document.createElement('tr');
    tr.className = 'bulk-mainrow';
    tr.dataset.bottleCount = '0';

    let html = `
      <td>${i}</td>
      <td class="bulk-check-cell">
        <input type="checkbox" class="bulk-check">
      </td>
      <td><input class="bulk-name" placeholder="氏名"></td>
      <td style="text-align:center;"><input type="checkbox" class="bulk-exp"></td>
      <td><input class="bulk-send bulk-custom-keypad-target" inputmode="numeric" placeholder="送迎"></td>
    `;

    [
      'f', 'f2', 'jounai', 'honshiri', 'douhan', 'eda', 'help',
      'set40', 'set20', 'vip', 'a', 'b', 'c', 'd', 'e'
    ].forEach(k => {
      if (k === 'f') {
        html += `<td style="text-align:center;"><input type="checkbox" data-k="2k" class="bulk-2k"></td>`;
        return;
      }

      const ph = placeholders[k] || '';
      html += `
        <td>
          <input
            data-k="${k}"
            class="bulk-num bulk-custom-keypad-target"
            inputmode="numeric"
            placeholder="${ph}"
          >
        </td>
      `;
    });

    html += `
      <td class="btl-anchor">
        <div class="btl-toolbar">
          <button type="button" class="btl-plus mini-btn" aria-label="ボトル追加">＋</button>
          <button type="button" class="btl-minus mini-btn" aria-label="ボトル削除" disabled>－</button>
        </div>
      </td>
      <td></td>
      <td></td>
      <td></td>
      <td class="bulk-leave-cell">
        <input type="checkbox" class="bulk-leave">
      </td>
    `;

    tr.innerHTML = html;
    tbody.appendChild(tr);
  }

  if (typeof window.applyReadonlyToBulkGridCustomKeypad === 'function') {
    window.applyReadonlyToBulkGridCustomKeypad();
  }

  if (typeof window.applyReadonlyToCustomKeypadTargets === 'function') {
    window.applyReadonlyToCustomKeypadTargets();
  }

  window._lastBulkGridWidths = widths.slice();

  requestAnimationFrame(() => {
    if (typeof applyApp2MobileView === 'function') {
      applyApp2MobileView();
    }

    forceBulkGridColumnWidths(widths);
  });
}

  

  async function applyBulkGridStateFromSync(state) {
    const getter =
      (typeof window.getBulkDom === 'function')
        ? window.getBulkDom
        : (typeof getBulkDom === 'function' ? getBulkDom : null);

    if (!getter) {
      console.warn('[APP2 bulkGrid] getBulkDom missing');
      return;
    }

    const { grid, sel } = getter();
    if (!grid) {
      console.warn('[APP2 bulkGrid] bulkGrid not found');
      return;
    }

    if (!state || !Array.isArray(state.rows)) {
      console.warn('[APP2 bulkGrid] invalid state', state);
      return;
    }

    window._isApplyingBulkGridSync = true;

    try {
      const rowCount = state.rows.length || parseInt(sel?.value || '10', 10) || 10;

      if (sel) {
        sel.value = String(rowCount);
      }

      if (typeof buildGrid === 'function') {
        buildGrid(rowCount);
      }

      const mainRows = [...grid.querySelectorAll('.bulk-mainrow')];

      state.rows.forEach((row, index) => {
        const tr = mainRows[index];
        if (!tr) return;

        const nameEl = tr.querySelector('.bulk-name');
        const expEl  = tr.querySelector('.bulk-exp');
        const sendEl = tr.querySelector('.bulk-send');

        if (nameEl) nameEl.value = row.name || '';
        if (expEl)  expEl.checked = !!row.exp;
        if (sendEl) sendEl.value = row.send || '';

        if (row.nums && typeof row.nums === 'object') {
          tr.querySelectorAll('[data-k]').forEach(el => {
            const k = el.dataset.k;
            if (!k) return;

            let value;

            if (k === '2k') {
              if ('2k' in row.nums) value = row.nums['2k'];
              else if ('f' in row.nums) value = row.nums['f'];
              else return;
            } else {
              if (!(k in row.nums)) return;
              value = row.nums[k];
            }

            if (el.type === 'checkbox') {
              el.checked = !!value;
            } else {
              el.value = value || '';
            }
          });
        }

        if (Array.isArray(row.bottles) && row.bottles.length) {
          row.bottles.forEach(b => {
            try {
              if (typeof addBottleSubrow !== 'function') return;

              const sub = addBottleSubrow(tr);
              if (!sub) return;

              const detailSelect = sub.querySelector('.bottleDetails');
              const splitEl = sub.querySelector('.splitCount');
              const qtyEl = sub.querySelector('.bottleQuantity');
              const amountEl = sub.querySelector('.bottleAmount');

              const detail = b.detail ?? b.details ?? '';
              const split = b.split ?? b.splitCount ?? '';
              const qty = b.qty ?? b.quantity ?? b.bottleQuantity ?? '';
              const amount = b.amount ?? b.bottleAmount ?? '';

              if (detailSelect) {
                if (typeof setBottleDetailValue === 'function') {
                  setBottleDetailValue(detailSelect, detail);
                } else {
                  detailSelect.value = detail;
                }
              }

              if (splitEl) splitEl.value = split || '';
              if (qtyEl) qtyEl.value = qty || '';
              if (amountEl) amountEl.value = amount || '';

              if (typeof updateBottleAmountForRow === 'function') {
                updateBottleAmountForRow(sub);
              }
            } catch (err) {
              console.error('[APP2 bulkGrid] bottle restore failed:', err, b);
            }
          });
        }
      });

      await new Promise(resolve => requestAnimationFrame(resolve));

      if (typeof updateBulkFilledState === 'function') {
        updateBulkFilledState(grid);
      }

      if (typeof window.applyApp2MobileView === 'function') {
        window.applyApp2MobileView();
      }

      if (typeof window.applyReadonlyToBulkGridCustomKeypad === 'function') {
        window.applyReadonlyToBulkGridCustomKeypad();
      }

      if (typeof window.applyReadonlyToCustomKeypadTargets === 'function') {
        window.applyReadonlyToCustomKeypadTargets();
      }

    } catch (err) {
      console.error('[APP2 bulkGrid] apply failed:', err, state);
    } finally {
      await new Promise(resolve => requestAnimationFrame(resolve));
      window._isApplyingBulkGridSync = false;
    }
  }

  window.applyBulkGridStateFromSync = applyBulkGridStateFromSync;

  // === 保存 ================================================================
  let bulkSaveTimer = 0;
  let lastBulkGridStateJson = '';

  function saveBulkGridState() {
    const { grid } = getBulkDom();
    if (!grid) return;

    const mains = [...grid.querySelectorAll('.bulk-mainrow')];

    const rows = mains.map(tr => {
      const row = {
        name: tr.querySelector('.bulk-name')?.value || '',
        exp: tr.querySelector('.bulk-exp')?.checked || false,
        send: tr.querySelector('.bulk-send')?.value || '',
        nums: {},
        bottles: []
      };

      tr.querySelectorAll('[data-k]').forEach(el => {
        const k = el.dataset.k;
        if (el.type === 'checkbox') {
          row.nums[k] = !!el.checked;
        } else {
          row.nums[k] = el.value || '';
        }
      });

      let n = tr.nextElementSibling;
      while (n && n.classList.contains('btl-subrow')) {
        row.bottles.push({
          detail: (typeof getSelectedDetail === 'function') ? (getSelectedDetail(n) || '') : '',
          split: n.querySelector('.splitCount')?.value || '',
          qty: n.querySelector('.bottleQuantity')?.value || '',
          amount: n.querySelector('.bottleAmount')?.value || ''
        });
        n = n.nextElementSibling;
      }

      return row;
    });

    const json = JSON.stringify(rows);

    if (json === lastBulkGridStateJson) return;

    lastBulkGridStateJson = json;
    localStorage.setItem(GRID_KEY, json);
  }

  function scheduleSaveBulkGridState(delay = 120) {
    clearTimeout(bulkSaveTimer);
    bulkSaveTimer = setTimeout(() => {
      saveBulkGridState();
    }, delay);
  }

  window.saveBulkGridState = saveBulkGridState;

  // === 復元 ================================================================
  function restoreBulkGridState(forcedRowCount = null) {
    const { grid, sel } = getBulkDom();
    if (!grid) return;

    const raw = localStorage.getItem(GRID_KEY);
    const data = JSON.parse(raw || '[]');

    const rowCount =
      Number.isInteger(forcedRowCount) && forcedRowCount > 0
        ? forcedRowCount
        : (data.length || parseInt(sel?.value || '40', 10) || 40);

    buildGrid(rowCount);

    if (!data.length) {
      return;
    }

    const mains = [...grid.querySelectorAll('.bulk-mainrow')];

    data.slice(0, rowCount).forEach((r, i) => {
      const tr = mains[i];
      if (!tr) return;

      const nameEl = tr.querySelector('.bulk-name');
      const expEl  = tr.querySelector('.bulk-exp');
      const sendEl = tr.querySelector('.bulk-send');

      if (nameEl) nameEl.value = r.name || '';
      if (expEl)  expEl.checked = !!r.exp;
      if (sendEl) sendEl.value = norm(r.send);

      const kmap = {};
      tr.querySelectorAll('[data-k]').forEach(el => {
        kmap[el.dataset.k] = el;
      });

      const nums = { ...(r.nums || {}) };

      if (!('2k' in nums) && ('f' in nums)) {
        nums['2k'] = nums['f'];
      }

      for (const k in nums) {
        const el = kmap[k];
        if (!el) continue;

        if (el.type === 'checkbox') {
          el.checked = !!nums[k];
        } else {
          el.value = norm(nums[k]);
        }
      }

      if (Array.isArray(r.bottles) && r.bottles.length) {
        r.bottles.forEach(b => {
          addBottleSubrow(tr);

          const subs = getBottleSubrows(tr);
          const last = subs[subs.length - 1];
          if (!last) return;

          const detailSelect = last.querySelector('.bottleDetails');
          if (detailSelect && typeof setBottleDetailValue === 'function') {
            setBottleDetailValue(detailSelect, b.detail || '');
          }

          const splitEl  = last.querySelector('.splitCount');
          const qtyEl    = last.querySelector('.bottleQuantity');
          const amountEl = last.querySelector('.bottleAmount');

          if (splitEl)  splitEl.value  = norm(b.split);
          if (qtyEl)    qtyEl.value    = norm(b.qty);
          if (amountEl) amountEl.value = norm(b.amount);

          if (typeof updateBottleAmountForRow === 'function') {
            updateBottleAmountForRow(last);
          }
        });
      }
    });

    if (typeof updateBulkFilledState === 'function') {
      updateBulkFilledState(grid);
    }

    if (typeof window.applyReadonlyToBulkGridCustomKeypad === 'function') {
      window.applyReadonlyToBulkGridCustomKeypad();
    }

    if (typeof window.applyApp2MobileView === 'function') {
      window.applyApp2MobileView();
    }

    try {
      lastBulkGridStateJson = localStorage.getItem(GRID_KEY) || '';
    } catch (_) {
      lastBulkGridStateJson = '';
    }
  }

  // === メイン行→ボトル選択記憶 =============================================
  function rememberBottleSelectionsFromMainRow(mainRow) {
    if (!mainRow) return;

    const subs = getBottleSubrows(mainRow);
    subs.forEach(row => {
      try {
        if (typeof rememberBottleSelectionFromRow === 'function') {
          rememberBottleSelectionFromRow(row);
        }
      } catch (e) {
        console.warn('rememberBottleSelectionFromRow failed:', e);
      }
    });
  }

  // === 一括登録 ============================================================
  async function bulkRegister() {
    const tb = document.querySelector('#bulkGrid tbody');
    if (!tb) {
      alert('内部テーブルが見つかりません');
      return;
    }

    const mains = [...tb.querySelectorAll('.bulk-mainrow')];

    const rows = mains.map(m => {
      const nums = {};

      nums['2k'] = !!m.querySelector('[data-k="2k"]')?.checked;
      nums.f2 = parseInt(m.querySelector('[data-k="f2"]')?.value || '0', 10) || 0;

      [
        'jounai', 'honshiri', 'douhan', 'eda', 'help',
        'set40', 'set20', 'vip', 'a', 'b', 'c', 'd', 'e'
      ].forEach(k => {
        nums[k] = parseInt(m.querySelector(`[data-k="${k}"]`)?.value || '0', 10) || 0;
      });

      const bottles = [];
      let n = m.nextElementSibling;

      while (n && n.classList.contains('btl-subrow')) {
        const detail = n.querySelector('.bottleDetails')?.value || '';
        const split  = n.querySelector('.splitCount')?.value || '';
        const qty    = n.querySelector('.bottleQuantity')?.value || '';
        const amount = parseInt((n.querySelector('.bottleAmount')?.value || '0').replace(/,/g, ''), 10) || 0;

        if (detail || split || qty || amount) {
          bottles.push({ detail, split, qty, amount });
        }
        n = n.nextElementSibling;
      }

      return {
        mainRow: m,
        name: m.querySelector('.bulk-name')?.value || '',
        exp: m.querySelector('.bulk-exp')?.checked || false,
        send: parseInt(m.querySelector('.bulk-send')?.value || '0', 10) || 0,
        nums,
        bottles
      };
    }).filter(r =>
      r.name ||
      r.exp ||
      r.send ||
      Object.values(r.nums).some(v => !!v) ||
      r.bottles.length
    );

    if (!rows.length) {
      alert('入力がありません');
      return;
    }

    if (!confirm(`${rows.length}人分を登録しますか？`)) {
      return;
    }

    for (const r of rows) {
      setValue('castName', r.name);
      setChecked('experienceAndRental', r.exp);
      setValue('sendoffAmount', r.send);

      setChecked('f', !!(r.nums['2k'] ?? r.nums.f));
      setValue('f2', r.nums.f2 || '');

      [
        'jounai', 'honshiri', 'douhan', 'eda', 'help',
        'set40', 'set20', 'vip', 'a', 'b', 'c', 'd', 'e'
      ].forEach(id => {
        setValue(id, r.nums[id] || '');
      });

      const cont = document.getElementById('bottleFormsContainer');
      if (cont) {
        cont.innerHTML = '';

        r.bottles.forEach(b => {
          if (typeof createBottleForm === 'function') {
            const f = createBottleForm(b.detail, b.split, b.qty, b.amount);
            cont.appendChild(f);
          }
        });

        r.bottles.forEach(b => {
          if (typeof upsertCustomBottleMemory === 'function') {
            upsertCustomBottleMemory({
              detail: b.detail,
              split: b.split || '1',
              qty: b.qty || '1'
            });
          }

          if (typeof ensureBottleOptionExists === 'function') {
            ensureBottleOptionExists(b.detail);
          }
        });
      }

      if (typeof confirmAndCalculate === 'function') {
        confirmAndCalculate();
      } else if (typeof calculate === 'function') {
        calculate();
      }

      document.getElementById('registerButton')?.click();
      rememberBottleSelectionsFromMainRow(r.mainRow);
    }

    alert('一括登録完了');
  }

  // === 初期化 ==============================================================
document.addEventListener('DOMContentLoaded', () => {
  const { panel, toggle, sel, clearBt, regBt, grid } = getBulkDom();
  if (!panel || !grid) return;

  panel.hidden = false;
  document.body.classList.add('bulk-wide');
  savePanelState(true);

  const initialRows = parseInt(sel?.value || '40', 10) || 40;

  if (localStorage.getItem(GRID_KEY)) {
    restoreBulkGridState();
  } else {
    buildGrid(initialRows);
  }

  // 行数変更
  sel?.addEventListener('change', () => {
    const n = parseInt(sel.value || '40', 10) || 40;

    saveBulkGridState();

    if (typeof restoreBulkGridState === 'function') {
      restoreBulkGridState(n);
    } else if (typeof buildGrid === 'function') {
      buildGrid(n);
    }

    if (typeof updateBulkFilledState === 'function') {
      updateBulkFilledState(grid);
    }

    if (typeof window.applyReadonlyToBulkGridCustomKeypad === 'function') {
      window.applyReadonlyToBulkGridCustomKeypad();
    }

    if (typeof window.applyReadonlyToCustomKeypadTargets === 'function') {
      window.applyReadonlyToCustomKeypadTargets();
    }

    if (typeof applyApp2MobileView === 'function') {
      applyApp2MobileView();
    }
  });

  // 一括登録
  regBt?.addEventListener('click', () => {
    bulkRegister();
  });

  // クリア
  clearBt?.addEventListener('click', () => {
    const n = parseInt(sel?.value || '40', 10) || 40;

    if (!confirm('一括入力グリッドをクリアしますか？')) return;

    localStorage.removeItem(GRID_KEY);
    lastBulkGridStateJson = '';
    buildGrid(n);

    if (typeof updateBulkFilledState === 'function') {
      updateBulkFilledState(grid);
    }

    if (typeof window.applyReadonlyToBulkGridCustomKeypad === 'function') {
      window.applyReadonlyToBulkGridCustomKeypad();
    }

    if (typeof window.applyReadonlyToCustomKeypadTargets === 'function') {
      window.applyReadonlyToCustomKeypadTargets();
    }

    if (typeof applyApp2MobileView === 'function') {
      applyApp2MobileView();
    }

    saveBulkGridState();
  });

  // 全選択
  grid.addEventListener('change', (e) => {
    const checkAll = e.target.closest('#bulkCheckAll');
    if (!checkAll) return;

    grid.querySelectorAll('.bulk-check').forEach(ch => {
      ch.checked = !!checkAll.checked;
    });

    scheduleSaveBulkGridState();
  });

  // ＋ / － / 入力類の委譲
  grid.addEventListener('click', (e) => {
    const plusBtn = e.target.closest('.btl-plus');
    if (plusBtn) {
      const mainTr = plusBtn.closest('.bulk-mainrow');
      if (!mainTr) return;

      addBottleSubrow(mainTr);

      if (typeof updateBulkFilledState === 'function') {
        updateBulkFilledState(grid);
      }

      return;
    }

    const minusBtn = e.target.closest('.btl-minus');
    if (minusBtn) {
      const mainTr = minusBtn.closest('.bulk-mainrow');
      if (!mainTr) return;

      removeBottleSubrow(mainTr);

      if (typeof updateBulkFilledState === 'function') {
        updateBulkFilledState(grid);
      }

      return;
    }
  });

  grid.addEventListener('input', (e) => {
    const t = e.target;
    if (!t) return;

    if (
      t.closest('.bulk-mainrow') ||
      t.closest('.btl-subrow')
    ) {
      scheduleSaveBulkGridState();

      if (typeof window.scheduleApp3Update === 'function') {
        window.scheduleApp3Update('bulkGridInput');
      }

      if (typeof updateBulkFilledState === 'function') {
        updateBulkFilledState(grid);
      }
    }
  });

  grid.addEventListener('change', (e) => {
    const t = e.target;
    if (!t) return;

    if (
      t.closest('.bulk-mainrow') ||
      t.closest('.btl-subrow')
    ) {
      scheduleSaveBulkGridState();

      if (typeof window.scheduleApp3Update === 'function') {
        window.scheduleApp3Update('bulkGridChange');
      }

      if (typeof updateBulkFilledState === 'function') {
        updateBulkFilledState(grid);
      }
    }
  });

  if (toggle) {
    toggle.style.display = 'none';
  }
});

})();

// === 金額変換ユーティリティ ==========================================
function intSafe(v, d = 0) {
  const n = parseInt(String(v ?? '').toString().replace(/,/g,''), 10);
  return Number.isFinite(n) ? n : d;
}

// 100円未満切り捨て（例: 3750 → 3700）
function floor100(yen) {
  return Math.floor(intSafe(yen) / 100) * 100;
}

// --- 履歴オプションを生成して追加する関数 ---
function appendBottleHistoryOptions(selectEl, historyList){
  const grp = document.createElement('optgroup');
  grp.label = '最近の登録（履歴）';

  historyList.forEach(item => {
    const o = document.createElement('option');
    const s = parseInt(item.splitCount || 1, 10);
    const q = parseInt(item.bottleQuantity || 1, 10);
    const a = parseInt(item.bottleAmount || 0, 10);
    o.textContent = `${item.bottleDetails}${s ? ` / 割${s}` : ''}${q ? ` / 数${q}` : ''}${a ? ` / ￥${a.toLocaleString()}` : ''}`;
    o.value = `hist:${item.bottleDetails}:${s||''}:${q||''}:${a||''}`;
    o.dataset.base  = item.bottleDetails || '';
    o.dataset.split = String(s || '');
    o.dataset.qty   = String(q || '');
    o.dataset.amt   = String(a || '');
    grp.appendChild(o);
  });

  [...selectEl.querySelectorAll('optgroup[label="最近の登録（履歴）"]')].forEach(n=>n.remove());
  selectEl.insertBefore(grp, selectEl.firstChild);
}

// === 自動入力処理本体 ================================================
function applySelectRule(selectEl) {
  const tr = selectEl.closest('.btl-subrow') || selectEl.closest('.bottle-form');
  const splitEl = tr.querySelector('.splitCount');
  const qtyEl   = tr.querySelector('.bottleQuantity');
  const amtEl   = tr.querySelector('.bottleAmount');

  const opt  = selectEl.selectedOptions && selectEl.selectedOptions[0];
  const val  = selectEl.value;
  const rule = bottleRules[val];

  // 1) 履歴由来オプション
  if (opt && (opt.dataset.split || opt.dataset.qty || opt.dataset.amt || opt.dataset.base)) {
    const baseName = opt.dataset.base || val;
    if (splitEl) splitEl.value = opt.dataset.split ?? '';
    if (qtyEl)   qtyEl.value   = opt.dataset.qty   ?? '';

    // --- ★ 修正版ここから ---
    const savedAmt = opt.dataset.amt;
    if (savedAmt !== undefined && savedAmt !== null && savedAmt !== '') {
      // dataset.amt が存在すればそのまま使う
      const num = parseInt(savedAmt, 10);
      amtEl.value = Number.isFinite(num) ? num.toLocaleString() : '';
    } else {
      // dataset.amt が空なら rule から再計算
      const base = bottleRules[baseName]?.amt ?? 0;
      const s = Math.max(1, parseInt(splitEl.value || '1', 10) || 1);
      const q = Math.max(1, parseInt(qtyEl.value   || '1', 10) || 1);
      const per   = Math.floor(base / s);
      const total = per * q;
      amtEl.value = total ? total.toLocaleString() : '';
    }
    // --- ★ 修正版ここまで ---

  } else if (rule) {
    // 2) 通常オプション
    if (splitEl && splitEl.value === '') splitEl.value = rule.split ?? '';
    if (qtyEl   && qtyEl.value   === '') qtyEl.value   = rule.qty   ?? '';
    if (amtEl)  {
      const v = Math.floor(rule.amt ?? 0).toLocaleString();
      if (amtEl.value === '') amtEl.value = v;
    }

  } else {
    // 3) その他
    if (splitEl) splitEl.value = '';
    if (qtyEl)   qtyEl.value   = '';
    if (amtEl)   amtEl.value   = '';
  }

  // 入力イベントを発火
  splitEl?.dispatchEvent(new Event('input',  { bubbles:true }));
  qtyEl  ?.dispatchEvent(new Event('input',  { bubbles:true }));
  amtEl  ?.dispatchEvent(new Event('input',  { bubbles:true }));
}

// === 一括入力フォーム用：金額再計算 ======================================
function updateBottleAmountForRow(tr) {
  const sel   = tr.querySelector('.bottleDetails');
  const split = intSafe(tr.querySelector('.splitCount')?.value || 1, 1);
  const qty   = intSafe(tr.querySelector('.bottleQuantity')?.value || 1, 1);
  const amtEl = tr.querySelector('.bottleAmount');
  if (!sel || !amtEl) return;

  // ---- 品名の決定（履歴対応版） ----
  let val = sel.value || '';
  let baseName = sel.selectedOptions?.[0]?.dataset?.base || val;

  try {
    if (val.startsWith('__HIST__')) {
      const decoded = decodeURIComponent(val.split('|')[0].replace('__HIST__', ''));
      if (decoded) baseName = decoded;
    }
  } catch (e) {}
  baseName = baseName.trim();

  const base = bottleRules[baseName]?.amt ?? 0;

  // ★ 割ったあと 100 円未満切り捨て
  const perRaw     = base / Math.max(1, split);
  const perPerson  = floor100(perRaw);                // ←ここで 100 円未満切り捨て
  const total      = perPerson * Math.max(1, qty);    // 本数分掛ける

  amtEl.value = total ? total.toLocaleString() : '';
}

// ====== グリッド移動（Enter=縦 / Tab=横）完全停止版 ======
(function(){
  const grid = document.getElementById('bulkGrid');
  if (!grid) return;

  const isInvisible = (node) => node?.offsetParent === null;
  const isDisabledLike = (node) => !node || node.disabled || node.readOnly || isInvisible(node);
  const isBottleSpacerRow = (tr) =>
    tr?.classList?.contains('btl-subrow') || tr?.dataset?.rowType === 'bottle-subrow';

  function onGridNav(e){
  const key = e.key;
  if (e.isComposing) return;
  // ← Enter は新ナビが処理するので素通り
  if (key === 'Enter') return;
  // ここからは Tab 専用
  if (key !== 'Tab') return;

  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
  if (!grid.contains(el)) return;

  // 同一行の左右（Tab/Shift+Tab）のみ面倒を見る
  const currentRow = el.closest('tr');
  if (!currentRow) return;

  const rowInputs = Array.from(currentRow.querySelectorAll('input, select, textarea'));
  const colIdx = rowInputs.indexOf(el);
  if (colIdx === -1) return;

  e.preventDefault(); // ここでだけ既定の Tab を止める

  const delta = e.shiftKey ? -1 : 1;
  const nextInRow = rowInputs[colIdx + delta];

  // 非表示/無効はスキップせず“何もしない”＝他ハンドラを止めない
  if (nextInRow && !nextInRow.disabled && nextInRow.offsetParent !== null) {
    nextInRow.focus();
    nextInRow.select?.();
    // ここはフォーカス済みなので他へ流さないでOK
    return;
  }

  // 見つからない/フォーカスできない場合は何もしない（他ハンドラに譲る）
  return;
}

  // capture=true で最優先捕捉し、他ハンドラより先に制御
  document.addEventListener('keydown', onGridNav, true);
})();

// === スマホ表示：氏名・体/貸・送迎 だけ表示（一本化） ==================
(function(){
function applyApp2MobileView() {
  const grid = document.getElementById('bulkGrid');
  if (!grid || !grid.tHead || !grid.tBodies[0]) return;

const vw = Math.min(window.innerWidth, window.outerWidth || window.innerWidth);
const vh = Math.min(window.innerHeight, window.outerHeight || window.innerHeight);
const isLandscape = vw > vh;

const hasTouchLike =
  (navigator.maxTouchPoints > 0) ||
  window.matchMedia('(pointer: coarse)').matches;

// buildGrid() と同じ判定
const isCompactLandscapeApp2 =
  hasTouchLike &&
  isLandscape &&
  vw <= 1300;

  const ths = Array.from(grid.tHead.rows[0]?.cells || []);
  const rows = Array.from(grid.tBodies[0]?.rows || []);

  // 共通のテーブル固定
  grid.style.tableLayout = 'fixed';
  grid.style.width = '100%';
  grid.style.borderCollapse = 'collapse';

  const wrap = grid.closest('.bulk-grid-wrap');

  // iPad mini 横向き compact は「全部表示」のままにする
  if (isCompactLandscapeApp2) {
    ths.forEach(th => {
      if (th) th.style.display = 'table-cell';
    });

    rows.forEach(tr => {
      Array.from(tr.cells || []).forEach(td => {
        if (td) td.style.display = 'table-cell';
      });
    });

    if (wrap) wrap.style.overflowX = '';

    // buildGrid 側で保存した幅を最後に再強制
    if (Array.isArray(window._lastBulkGridWidths) && typeof forceBulkGridColumnWidths === 'function') {
      forceBulkGridColumnWidths(window._lastBulkGridWidths);
    }

    return;
  }

  // それ以外だけ mobile view を適用
  const isPhoneLike =
    vw <= 768 &&
    matchMedia('(pointer: coarse)').matches;

  for (let i = 0; i < ths.length; i++) {
    const colIndex = i + 1; // 1-based

    // スマホ時だけ最低限の列だけ見せる
    const show = !isPhoneLike || (colIndex === 2 || colIndex === 3 || colIndex === 4);

    if (ths[i]) {
      ths[i].style.display = show ? 'table-cell' : 'none';
    }

    rows.forEach(tr => {
      if (tr.classList.contains('btl-subrow')) return;
      const td = tr.cells[i];
      if (td) {
        td.style.display = show ? 'table-cell' : 'none';
      }
    });
  }

  if (wrap) {
    wrap.style.overflowX = isPhoneLike ? 'hidden' : '';
  }

  // 最後に幅を再強制
  if (Array.isArray(window._lastBulkGridWidths) && typeof forceBulkGridColumnWidths === 'function') {
    forceBulkGridColumnWidths(window._lastBulkGridWidths);
  }
}

  // グローバルに公開（buildGrid 直後でも呼べるように）
  window.applyApp2MobileView = applyApp2MobileView;

  // 初期 & リサイズで適用
  document.addEventListener('DOMContentLoaded', applyApp2MobileView);
  window.addEventListener('load', applyApp2MobileView);
  window.addEventListener('resize', applyApp2MobileView);

  if (window._lastBulkGridWidths) {
  forceBulkGridColumnWidths(window._lastBulkGridWidths);
}

  
})();

(function () {
  const grid = document.getElementById('bulkGrid');
  if (!grid) return;

  const clearHighlight = () => {
    grid.querySelectorAll('tr.hl-row').forEach(el => el.classList.remove('hl-row'));
    grid.querySelectorAll('.hl-col').forEach(el => el.classList.remove('hl-col'));
  };

  grid.addEventListener('focusin', (e) => {
    const td = e.target.closest('td');
    if (!td || !grid.contains(td)) return;

    clearHighlight();

    // 行をハイライト
    const tr = td.parentElement;
    tr.classList.add('hl-row');

    // 列インデックスを取得
    const idx = td.cellIndex;
    if (idx < 0) return;

    // ヘッダの同列をハイライト
    const th = grid.tHead && grid.tHead.rows && grid.tHead.rows[0] && grid.tHead.rows[0].cells[idx];
    if (th) th.classList.add('hl-col');

    // 本文の同列をハイライト
    grid.tBodies[0] && Array.from(grid.tBodies[0].rows).forEach(r => {
      const c = r.cells[idx];
      if (c) c.classList.add('hl-col');
    });
  });

  // グリッド外へフォーカスが抜けたら消す（内部移動はfocusinで上書き）
  grid.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!grid.contains(document.activeElement)) clearHighlight();
    }, 0);
  });
})();

function addAndGetSubrow(mainRow){
  if (typeof addBottleSubrow === 'function') addBottleSubrow(mainRow);

  if (typeof getBottleSubrows === 'function') {
    const subs = getBottleSubrows(mainRow);
    const row = subs[subs.length - 1] || null;

    if (row) {
      const sel = row.querySelector('.bottleDetails');
      if (sel) {
        sel.value = '';
        sel.selectedIndex = 0;
      }

      const split = row.querySelector('.splitCount');
      const qty   = row.querySelector('.bottleQuantity');
      const amt   = row.querySelector('.bottleAmount');

      if (split) split.value = '';
      if (qty)   qty.value   = '';
      if (amt)   amt.value   = '';
    }

    return row;
  }

  return null;
}

// チェックボックスの活性/選択を空行に合わせて更新
function updateRowCheckState(mainRow){
  const cb = mainRow.querySelector('.bulk-check');
  if (!cb) return;

  const empty = isBulkRowEmpty(mainRow);
  const isLeave = mainRow.classList.contains('is-leave');

  if (isLeave) {
    cb.disabled = true;
    cb.checked = false;
    mainRow.classList.remove('bulk-empty');
    return;
  }

  cb.disabled = empty;
  if (empty) cb.checked = false;

  mainRow.classList.toggle('bulk-empty', empty);
}

//一括入力グリッドで入力のあるフォームのみ色を変えるJS開始
(function(){
  const grid = document.getElementById('bulkGrid');
  if (!grid) return;

  // 入力があるか判定（0 は入力あり扱い）
  function hasValue(el){
    if (el.type === 'checkbox') return el.checked;
    const v = (el.value ?? '').toString().trim();
    return v !== '';
  }

  function updateFilledState(el){
    const filled = hasValue(el);
    el.classList.toggle('is-filled', filled);
    const td = el.closest('td');
    if (td) td.classList.toggle('cell-filled', filled);
  }

  function scanAll(){
    grid.querySelectorAll('input, select, textarea').forEach(updateFilledState);
  }

  // 入力中の即時反映
  grid.addEventListener('input', (e)=>{
    if (e.target.matches('#bulkGrid input, #bulkGrid textarea')) updateFilledState(e.target);
  });
  grid.addEventListener('change', (e)=>{
    if (e.target.matches('#bulkGrid select, #bulkGrid input[type="checkbox"]')) updateFilledState(e.target);
  });

  // 初期スキャン
  scanAll();

  // 行の追加/復元にも追従
  const mo = new MutationObserver((mut)=>{
    for (const m of mut){
      m.addedNodes?.forEach(node=>{
        if (node.nodeType === 1){
          if (node.matches?.('input,select,textarea')) updateFilledState(node);
          node.querySelectorAll?.('input,select,textarea').forEach(updateFilledState);
        }
      });
    }
  });
  mo.observe(grid.tBodies[0] || grid, { childList: true, subtree: true });

  // 外から呼べる再スキャン（履歴一括復元の完了後などに）
  window.rescanBulkFilledState = scanAll;
})();

//APP2 一括入力：右端に「退」チェック列を追加
(function injectBulkLeaveStyles(){
  if (document.getElementById('bulk-leave-styles')) return;
  const css = `
    #bulkGrid thead th.bulk-leave-head { width:3.2em;text-align:center; }
    #bulkGrid tbody td.bulk-leave-cell { text-align:center; }
    #bulkGrid input.bulk-leave { transform:scale(1.05);cursor:pointer; }

    /* グレーアウト見た目（操作可・変更不可） */
    #bulkGrid tr.bulk-mainrow.is-leave td,
    #bulkGrid tr.btl-subrow.is-leave td {
    opacity: .45 !important;
    filter: grayscale(0.9);
    }


    /* 読み取り専用スタイル */
    #bulkGrid input[readonly],
    #bulkGrid select[data-readonly="1"] {
    background: rgba(100, 100, 100, 0.2) !important;
    color: #ccc !important;
    cursor: not-allowed !important;
    }

    /* ★例外：退チェック＆マイナスボタンは常に操作可 */
    #bulkGrid tr.is-leave input.bulk-leave,
    #bulkGrid tr.bulk-mainrow.is-leave .btl-minus,
    #bulkGrid tr.btl-subrow.is-leave   .btl-minus{
      pointer-events:auto!important;
    }
  `.trim();
  const s=document.createElement('style');
  s.id='bulk-leave-styles';
  s.textContent=css;
  document.head.appendChild(s);
})();

/* ==== 退勤列セットアップ ==== */
(function setupBulkLeaveColumn(){
  const grid=document.getElementById('bulkGrid');
  if(!grid) return;

  function ensureLeaveHead(){
    const thRow=grid.tHead?.rows?.[0];
    if(!thRow||thRow.querySelector('.bulk-leave-head'))return;
    const th=document.createElement('th');
    th.className='bulk-leave-head';
    th.textContent='退';
    th.style.width = '3%';
    thRow.appendChild(th);
  }

  function getSubrows(mainTr){
    const subs=[];
    let cur=mainTr.nextElementSibling;
    while(cur&&cur.classList.contains('btl-subrow')){
      subs.push(cur);
      cur=cur.nextElementSibling;
    }
    return subs;
  }


  /* ✅改修版：退勤ON/OFFで「選択可・変更不可」制御 */
function applyRowLeaveState(mainTr, isLeave) {
  const subs = getSubrows(mainTr);
  const all = [mainTr, ...subs];
  all.forEach(tr => tr.classList.toggle('is-leave', !!isLeave));

  // 退勤チェック自身の制御
  const sel = mainTr.querySelector('.bulk-check');
  if (sel) {
    if (isLeave) { sel.checked = false; sel.disabled = true; }
    else { sel.disabled = false; }
  }

  // 各入力要素の制御
  const allEls = [
    ...mainTr.querySelectorAll('input, select, button'),
    ...subs.flatMap(s => Array.from(s.querySelectorAll('input, select, button')))
  ];

  allEls.forEach(el => {
    const isMinus = el.classList.contains('btl-minus');
    const isLeaveCheck = el.classList.contains('bulk-leave');

    if (isLeave) {
      // --- 退勤中 ---
      if (el.tagName === 'INPUT' && !isLeaveCheck) {
        el.readOnly = true;        // ← 入力禁止だがフォーカス可
      } else if (el.tagName === 'SELECT') {
        el.dataset.readonly = '1'; // ← セレクト専用フラグ
        el.addEventListener('mousedown', preventSelectChange, { once: true });
      } else if (!isLeaveCheck && !isMinus) {
        el.disabled = true;        // ボタン類などは無効化
      }
    } else {
      // --- 通常 ---
      if (el.tagName === 'INPUT') el.readOnly = false;
      if (el.tagName === 'SELECT') delete el.dataset.readonly;
      el.disabled = false;
    }
  });
}

/* セレクト変更抑止 */
function preventSelectChange(e) {
  if (e.currentTarget.dataset.readonly === '1') {
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }
}


  function ensureLeaveCell(mainTr){
    if(mainTr.querySelector('td.bulk-leave-cell'))return;
    const td=document.createElement('td');
    td.className='bulk-leave-cell';
    td.innerHTML=`<input type="checkbox" class="bulk-leave" aria-label="退勤行">`;
    mainTr.appendChild(td);
  }

  const tbody=grid.tBodies?.[0];
  if(!tbody)return;
  ensureLeaveHead();

  const process=()=>{ ensureLeaveHead(); tbody.querySelectorAll('tr.bulk-mainrow').forEach(r=>ensureLeaveCell(r)); };
  process();
  new MutationObserver(process).observe(tbody,{childList:true,subtree:false});

  document.addEventListener('change',e=>{
    if(!e.target?.classList?.contains('bulk-leave'))return;
    const tr=e.target.closest('tr.bulk-mainrow');
    if(!tr)return;
    applyRowLeaveState(tr,e.target.checked);
  });

  window._bulkLeave={applyRowLeaveState,getSubrows,isLeave:tr=>!!tr?.classList?.contains('is-leave')};
})();

//共通：app2ナビゲーション（Enter / 矢印キー 両対応）
/* 有効フィールド取得関数 */
function getApp2ActiveFields(current) {
  const app2  = document.getElementById('app2');
  const grid  = document.getElementById('bulkGrid');
  if (!app2) return [];

  const inGrid = !!(current && grid && grid.contains(current));
  const scope  = inGrid ? grid : app2;

  const all = Array.from(scope.querySelectorAll('input, select, textarea'));
  return all.filter(el => {
    if (!el.offsetParent) return false;        // 非表示は除外
    if (el.disabled) return false;             // disabled は除外（退行で一部ボタン等）
    // ※ readonly / data-readonly は “フォーカスOK” にするため除外しない
    return true;
  });
}

// === 幾何学ベースの次候補探索（列ズレに強い） ===
function findNextByGeometry(fields, current, dir) {
  const rect = current.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top  + rect.height/ 2;

  let best = null, bestScore = Infinity;
  const vertical = (dir === 'down' || dir === 'up');
  const sign     = (dir === 'down') ? +1 : -1;

  for (const el of fields) {
    if (el === current) continue;
    const r  = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top  + r.height/ 2;

    if (vertical) {
      const dy = ey - cy;
      if (sign * dy <= 0) continue;     // 進行方向のみ
      const dx = Math.abs(ex - cx);
      const score = dy * 1000 + dx;     // 縦優先
      if (score < bestScore) { best = el; bestScore = score; }
    } else {
      // 左右は同じ行近傍のみ
      const dy = Math.abs(ey - cy);
      if (dy > 8) continue;
      const dx = ex - cx;
      if ((dir === 'right' && dx <= 0) || (dir === 'left' && dx >= 0)) continue;
      const score = Math.abs(dx);
      if (score < bestScore) { best = el; bestScore = score; }
    }
  }
  return best;
}

// 移動の入口：現在地に応じて探索範囲と手法を切り替え
function moveFocus(dir, current) {
  const grid = document.getElementById('bulkGrid');
  const inGrid = !!(grid && current && grid.contains(current));

  if (inGrid && (dir === 'down' || dir === 'up')) {
    // ← グリッド内の上下は “同列維持” アルゴリズムを必ず使用
    moveFocusGridVertical(current, dir);
    return;
  }

  // それ以外は近傍幾何学
  const fields = getApp2ActiveFields(current);
  const next = findNextByGeometry(fields, current, dir);
  if (next) {
    next.focus();
    next.select?.();
  }
}

// === 共通移動 ===
// グリッド行→次の「メイン行」へ（btl-subrow と退行を自動スキップ）
function moveFocusGridVertical(current, dir /* 'down' | 'up' */) {
  const grid = document.getElementById('bulkGrid');
  if (!grid) return;

  const curTr  = current.closest('tr');
  if (!curTr) return;

  // 現行行の列スロットを決める
  const rowSlots = Array.from(curTr.querySelectorAll('input, select, textarea'));
  const colIdx   = rowSlots.indexOf(current);
  if (colIdx < 0) return;

  // メイン行のみを縦走査対象にする（←ここは据え置き）
  const allRows = Array.from(grid.tBodies?.[0]?.rows || [])
    .filter(tr => tr.classList.contains('bulk-mainrow'));

  const r0 = allRows.indexOf(curTr);
  if (r0 < 0) return;

  const step = (dir === 'up') ? -1 : +1;
  let r = r0 + step;

  while (r >= 0 && r < allRows.length) {
    const tr = allRows[r];

    // ★退行でもフォーカス可能にするため “スキップしない”
    const cand = Array.from(tr.querySelectorAll('input, select, textarea'))[colIdx];

    // フォーカス可能なら移動（readonly/data-readonlyでもOK）
    if (cand && cand.offsetParent && !cand.disabled) {
      cand.focus();
      cand.select?.();
      return;
    }
    r += step;
  }
}

// === イベント統合（capture=true で最優先） ===
(function attachGridNavOnce(){
  if (window.__app2NavInstalled) return;
  window.__app2NavInstalled = true;

  document.addEventListener('keydown', (e) => {
    // app2 以外・対象外要素は無視
    const app2 = document.getElementById('app2');
    if (!app2 || !app2.classList.contains('active')) return;
    const target = e.target;
    if (!target || !target.closest('#app2')) return;
    if (!['INPUT','SELECT','TEXTAREA'].includes(target.tagName)) return;

    // Enter は常に “下へ” ＋ submit を完全阻止
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      moveFocus('down', target);
      return;
    }

    // 矢印
    let dir = null;
    if (e.key === 'ArrowDown') dir = 'down';
    else if (e.key === 'ArrowUp') dir = 'up';
    else if (e.key === 'ArrowLeft') dir = 'left';
    else if (e.key === 'ArrowRight') dir = 'right';
    if (!dir) return;

    e.preventDefault();
    moveFocus(dir, target);
  }, true);
})();

window.sortHistoryIndex = function() {
  const container = document.querySelector('.history-index-table');
  if (!container) return;

  // ボタン要素を全部取得（表題行は除外）
  const buttons = Array.from(container.querySelectorAll('.idx-btn'));

  // 50音順ソート（濁音・半濁音・小文字も考慮）
  buttons.sort((a, b) => {
    const aText = a.textContent
      .replace(/[ァ-ン]/g, s => String.fromCharCode(s.charCodeAt(0) - 0x60)) // カナ→ひらがな
      .replace(/[ﾞﾟ]/g, ""); // 濁点除去
    const bText = b.textContent
      .replace(/[ァ-ン]/g, s => String.fromCharCode(s.charCodeAt(0) - 0x60))
      .replace(/[ﾞﾟ]/g, "");
    return aText.localeCompare(bText, 'ja');
  });

  // 並べ替え反映（タイトル以外を削除して再追加）
  const title = container.querySelector('.history-index-title');
  container.querySelectorAll('.idx-btn').forEach(btn => btn.remove());
  buttons.forEach(btn => container.appendChild(btn));
  
  // 成功時の軽い視覚フィードバック（オプション）
  title.style.textShadow = '0 0 8px #00f5ff';
  setTimeout(() => title.style.textShadow = '', 800);
};

document.addEventListener('click', (e)=>{
  if (e.target.closest('#historyIndexToggle')) {
    const tbl = document.getElementById('historyIndexTable');
    tbl?.classList.toggle('collapsed');
  }
});

function createHistoryIndex() {
  const table = document.getElementById('historyIndexTable');
  if (!table) {
    console.warn('[createHistoryIndex] historyIndexTable not found');
    return;
  }

  const tbody = document.getElementById('historyIndexBody');
  if (!tbody) {
    console.warn('[createHistoryIndex] historyIndexBody not found');
    return;
  }

  const historyList = document.getElementById('historyList');
  if (!historyList) {
    console.warn('[createHistoryIndex] historyList not found');
    return;
  }

  const countEl = document.getElementById('historyIndexCount');

  // 履歴本体そのものを使う
  const items = Array
  .from(historyList.querySelectorAll(':scope > li'))
  .reverse();   // ← これ追加

  tbody.innerHTML = '';

  if (!items.length) {
    if (countEl) countEl.textContent = '0人';
    return;
  }

  if (countEl) {
    countEl.textContent = `${items.length}人`;
  }

  let cols = 6;
  if (window.innerWidth <= 1200) cols = 5;
  if (window.innerWidth <= 900) cols = 4;
  if (window.innerWidth <= 700) cols = 3;
  if (window.innerWidth <= 520) cols = 2;

  let tr = null;

  items.forEach((item, index) => {
    const castNameEl = item.querySelector('.castName');

    let name = '';
    if (castNameEl) {
      name = castNameEl.textContent
        .replace(/^\s*\d+\.\s*/, '')
        .trim();
    }

    if (!name) {
      name = `履歴${index + 1}`;
    }

    if (index % cols === 0) {
      tr = document.createElement('tr');
      tbody.appendChild(tr);
    }

    const td = document.createElement('td');
    td.className = 'history-index-cell';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history-index-btn';
    btn.textContent = name;

    btn.addEventListener('click', () => {
      // 元仕様：該当履歴へスクロール
      if (typeof scrollWithOffset === 'function') {
        scrollWithOffset(item);
      } else {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // 軽く視覚フィードバック
      item.classList.add('history-target-hit');
      setTimeout(() => {
        item.classList.remove('history-target-hit');
      }, 1200);
    });

    td.appendChild(btn);
    tr.appendChild(td);
  });

  const remainder = items.length % cols;
  if (remainder !== 0 && tr) {
    for (let i = 0; i < cols - remainder; i++) {
      const emptyTd = document.createElement('td');
      emptyTd.className = 'history-index-cell empty';
      tr.appendChild(emptyTd);
    }
  }

}

window.createHistoryIndex = createHistoryIndex;
window.createHistoryIndex = createHistoryIndex;

// 公開しておく（必要なら手動再生成で呼べる）
window.createHistoryIndex = createHistoryIndex;

document.getElementById('side-clear')?.addEventListener('click', clearApp2Inputs);

// 一括入力用のフォールバック選択肢
window.BOTTLE_OPTIONS_HTML = `
  <option value="">選択してください</option>
  <optgroup label="リステル等">
    <option value="リステル">リステル</option>
    <option value="パリ">パリ</option>
    <option value="マバム">マバム</option>
  </optgroup>
  <optgroup label="モエ">
    <option value="モエ白">モエ白</option>
    <option value="モエロゼ">モエロゼ</option>
    <option value="モエネク">モエネク</option>
    <option value="モエピカ">モエピカ</option>
  </optgroup>
  <optgroup label="ヴーヴ">
    <option value="ヴーヴ">ヴーヴ</option>
    <option value="ヴーヴホワイト">ヴーヴホワイト</option>
    <option value="ヴーヴローズ">ヴーヴローズ</option>
  </optgroup>
  <optgroup label="ベルエ">
    <option value="ベルエ">ベルエ</option>
    <option value="ベルエロゼ">ベルエロゼ</option>
  </optgroup>
  <optgroup label="ソウメイ">
    <option value="ソウメイ">ソウメイ</option>
  </optgroup>
  <optgroup label="ドンペリ">
    <option value="ドンペリ">ドンペリ</option>
    <option value="ドンペリルミナス">ドンペリルミナス</option>
    <option value="ドンペリロゼ">ドンペリロゼ</option>
    <option value="ドンペリルミナスロゼ">ドンペリルミナスロゼ</option>
    <option value="ドンペリP2">ドンペリP2</option>
    <option value="ドンペリゴールド">ドンペリゴールド</option>
  </optgroup>
  <optgroup label="アルマンド">
    <option value="アルマンド">アルマンド</option>
    <option value="アルマンドロゼ">アルマンドロゼ</option>
    <option value="アルマンドグリーン">アルマンドグリーン</option>
  </optgroup>
  <optgroup label="オリシャン">
    <option value="オリシャンR">オリシャンR</option>
    <option value="オリシャンB">オリシャンB</option>
  </optgroup>
  <optgroup label="焼酎・リキュール等">
    <option value="柚子小町">柚子小町</option>
    <option value="黒霧島">黒霧島</option>
    <option value="吉四六">吉四六</option>
    <option value="富乃宝山">富乃宝山</option>
    <option value="赤霧島">赤霧島</option>
  </optgroup>
  <optgroup label="ウイスキー">
    <option value="知多">知多</option>
    <option value="山崎">山崎</option>
  </optgroup>
  <optgroup label="ワイン">
    <option value="ベリンジャー">ベリンジャー</option>
  </optgroup>
  <optgroup label="テキーラ">
    <option value="テキカン">テキカン</option>
  </optgroup>
  <optgroup label="その他">
    <option value="枝">枝</option>
    <option value="その他">その他</option>
    <option value="保障補正">保障補正</option>
  </optgroup>
`;

// === ボトル自動入力ルール ============================================
const bottleRules = {
  // --- リステル等 ---
  "リステル": { split: 1, qty: 1, amt: 6000 },
  "パリ": { split: 1, qty: 1, amt: 7500 },
  "マバム": { split: 1, qty: 1, amt: 17500 },

  // --- モエ ---
  "モエ白": { split: 1, qty: 1, amt: 15000 },
  "モエロゼ": { split: 1, qty: 1, amt: 17500 },
  "モエネク": { split: 1, qty: 1, amt: 20000 },
  "モエピカ": { split: 1, qty: 1, amt: 22500 },

  // --- ヴーヴ ---
  "ヴーヴ": { split: 1, qty: 1, amt: 16000 },
  "ヴーヴホワイト": { split: 1, qty: 1, amt: 17500 },
  "ヴーヴローズ": { split: 1, qty: 1, amt: 19000 },

  // --- ベルエ ---
  "ベルエ": { split: 1, qty: 1, amt: 70000 },
  "ベルエロゼ": { split: 1, qty: 1, amt: 140000 },

  // --- ソウメイ ---
  "ソウメイ": { split: 1, qty: 1, amt: 60000 },

  // --- ドンペリ ---
  "ドンペリ": { split: 1, qty: 1, amt: 50000 },
  "ドンペリルミナス": { split: 1, qty: 1, amt: 60000 },
  "ドンペリロゼ": { split: 1, qty: 1, amt: 70000 },
  "ドンペリルミナスロゼ": { split: 1, qty: 1, amt: 85000 },
  "ドンペリP2": { split: 1, qty: 1, amt: 150000 },
  "ドンペリゴールド": { split: 1, qty: 1, amt: 250000 },

  // --- アルマンド ---
  "アルマンド": { split: 1, qty: 1, amt: 85000 },
  "アルマンドロゼ": { split: 1, qty: 1, amt: 140000 },
  "アルマンドグリーン": { split: 1, qty: 1, amt: 200000 },

  // --- オリシャン ---
  "オリシャンR": { split: 1, qty: 1, amt: 12500 },
  "オリシャンB": { split: 1, qty: 1, amt: 30000 },

  // --- 焼酎・リキュール等 ---
  "柚子小町": { split: 1, qty: 1, amt: 5000 },
  "黒霧島": { split: 1, qty: 1, amt: 7500 },
  "吉四六": { split: 1, qty: 1, amt: 7500 },
  "富乃宝山": { split: 1, qty: 1, amt: 8500 },
  "赤霧島": { split: 1, qty: 1, amt: 10000 },

  // --- ウイスキー ---
  "知多": { split: 1, qty: 1, amt: 20000 },
  "山崎": { split: 1, qty: 1, amt: 35000 },

  // --- ワイン ---
  "ベリンジャー": { split: 1, qty: 1, amt: 10000 },

  // --- テキーラ ---
  "テキカン": { split: 1, qty: 1, amt: 35000 },

  // --- その他 ---
  "枝": { split: 1, qty: 1, amt: 500 },
  "その他": { split: 1, qty: 1, amt: 0 },
  "保障補正": { split: 1, qty: 1, amt: 0 },
};

// === 割・数量の変更で金額を自動再計算（グリッド版） ===
document.addEventListener('input', e => {
  if (!e.target || !e.target.closest('#bulkGrid')) return;
  if (e.target.classList.contains('splitCount') ||
      e.target.classList.contains('bottleQuantity')) {
    const tr = e.target.closest('.btl-subrow');
    if (tr) updateBottleAmountForRow(tr);
  }
});

// 予備：セレクト変更でも確実に再計算（既存と重複しても無害）
document.addEventListener('change', e => {
  if (!e.target || !e.target.closest('#bulkGrid')) return;
  if (e.target.classList.contains('splitCount') ||
      e.target.classList.contains('bottleQuantity')) {
    const tr = e.target.closest('.btl-subrow');
    if (tr) updateBottleAmountForRow(tr);
  }
});

// === クリック式ボトル階層ピッカー制御 ===============================
document.addEventListener('click', e => {
  const btn = e.target.closest('.bottle-hierarchy-btn');
  if (btn) {
    const tr = btn.closest('.btl-subrow');
    if (!tr) return;
    openBottleHierarchyPicker(tr, btn);
    return;
  }

  const pickerBtn = e.target.closest('[data-bhp-kind]');
  if (pickerBtn) {
    const kind = pickerBtn.dataset.bhpKind;
    const value = pickerBtn.dataset.bhpValue || '';

    if (kind === 'detail') BOTTLE_PICKER_STATE.detail = value;
    if (kind === 'split')  BOTTLE_PICKER_STATE.split  = value;
    if (kind === 'qty')    BOTTLE_PICKER_STATE.qty    = value;

    renderBottleHierarchyPicker();
    return;
  }

  if (e.target.closest('.bhp-close')) {
    closeBottleHierarchyPicker();
    return;
  }

  if (e.target.closest('.bhp-confirm')) {
    confirmBottleHierarchyPicker();
    return;
  }

  const picker = document.getElementById('bottleHierarchyPicker');
  if (picker && !picker.hidden) {
    if (!e.target.closest('#bottleHierarchyPicker') &&
        !e.target.closest('.bottle-hierarchy-btn')) {
      closeBottleHierarchyPicker();
    }
  }
});

// === ボトル選択時に既存ルール適用 + 金額再計算 ===============================
document.addEventListener('change', e => {
  if (!e.target.classList.contains('bottleDetails')) return;

  const selectEl = e.target;
  const tr = selectEl.closest('.btl-subrow');
  if (!tr) return;

  applySelectRule(selectEl);
  updateBottleAmountForRow(tr);
});

//  一括入力グリッドのボトル学習イベント
document.addEventListener('change', e => {
  const row = e.target.closest('#bulkGrid tr.btl-subrow');
  if (!row) return;

if (
  e.target.matches('.bottleDetails') ||
  e.target.matches('.splitCount') ||
  e.target.matches('.bottleQuantity')
) {
  rememberBottleSelectionFromRow(row);
}
});

document.addEventListener('blur', e => {
  const row = e.target.closest?.('#bulkGrid tr.btl-subrow');
  if (!row) return;

if (
  e.target.matches('.bottleDetails') ||
  e.target.matches('.splitCount') ||
  e.target.matches('.bottleQuantity')
) {
  rememberBottleSelectionFromRow(row);
}
}, true);

window.addEventListener('scroll', requestRepositionBottleHierarchyPicker, true);
window.addEventListener('resize', requestRepositionBottleHierarchyPicker);

// 履歴 → 一括入力へ一括復元（ボトル含む）
document.addEventListener('click', async (e) => {
  if (!e.target || e.target.id !== 'bulkImportFromHistory') return;

  // ---------- 1) 表示部品の用意：中央HUD & 小バッジ ----------
  const ensureHUD = () => {
    let hud = document.getElementById('bulkHUD');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'bulkHUD';
      hud.innerHTML = `
        <div class="bulkHUD-inner">
          <div class="bulkHUD-spinner"></div>
          <div class="bulkHUD-title">復元中...</div>
          <div class="bulkHUD-count" id="bulkHUDCount">0/0（0%）</div>
          <div class="bulkHUD-bar">
            <div class="bulkHUD-bar-fill" id="bulkHUDBar"></div>
          </div>
        </div>`;
      document.body.appendChild(hud);

      // HUDのスタイルをインラインで注入（CSS未読でも出る）
      const s = document.createElement('style');
      s.textContent = `
#bulkHUD{
  position:fixed; inset:0; display:none;
  align-items:center; justify-content:center;
  background:rgba(0,0,0,.60); z-index:999999;
}
#bulkHUD.show{ display:flex; animation:bulkHUDfade .15s ease-out; }
@keyframes bulkHUDfade{ from{opacity:0} to{opacity:1} }

#bulkHUD .bulkHUD-inner{
  min-width: min(640px, 86vw);
  max-width: 90vw;
  padding: 28px 26px 24px;
  border-radius: 16px;
  background: linear-gradient(180deg,#0b1a2a,#132a3f 60%,#0d1830);
  box-shadow: 0 10px 36px rgba(0,0,0,.45), 0 0 30px rgba(0,245,255,.20) inset;
  border: 1.5px solid rgba(0,245,255,.35);
  color: #d7faff;
  text-align: center;
  font-family: 'Orbitron',system-ui,sans-serif;
}

#bulkHUD .bulkHUD-title{
  font-size: clamp(18px, 2.2vw, 22px);
  letter-spacing:.08em;
  color:#9ee9ff; margin-top:8px; margin-bottom:6px;
  text-shadow: 0 0 10px rgba(0,245,255,.35);
}

#bulkHUD .bulkHUD-count{
  font-size: clamp(22px, 3vw, 28px);
  font-weight:700; letter-spacing:.04em;
  margin-bottom: 14px; color:#fff;
}

#bulkHUD .bulkHUD-bar{
  width: 100%; height: 18px; border-radius: 999px;
  background: rgba(0,245,255,.15);
  border: 1px solid rgba(0,245,255,.35);
  box-shadow: inset 0 0 10px rgba(0,245,255,.28);
  overflow: hidden;
}
#bulkHUD .bulkHUD-bar-fill{
  width:0%; height:100%;
  background: linear-gradient(90deg,#00f5ff,#62ffd0 70%);
  box-shadow: 0 0 18px rgba(0,245,255,.65);
  transition: width .12s ease;
}

#bulkHUD .bulkHUD-spinner{
  margin: 4px auto 10px;
  width: clamp(56px, 8vw, 72px); height: clamp(56px, 8vw, 72px);
  border: 4px solid rgba(0,245,255,.22);
  border-top-color:#00f5ff; border-radius:50%;
  animation: bulkSpin 1s linear infinite;
}
@keyframes bulkSpin { to { transform: rotate(360deg); } }

#bulkHUD.done .bulkHUD-title{ color:#b6ffd8; }
#bulkHUD.done .bulkHUD-count{ color:#b6ffd8; text-shadow:0 0 8px rgba(0,255,160,.35); }
#bulkHUD.done .bulkHUD-bar-fill{
  background: linear-gradient(90deg,#20ffb8,#c7ffd7);
  box-shadow: 0 0 18px rgba(32,255,184,.65);
}
      `;
      document.head.appendChild(s);
    }
    return hud;
  };

  const ensureBadge = (btn) => {
    let badge = document.getElementById('bulkRestoreProgress');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'bulkRestoreProgress';
      Object.assign(badge.style, {
        marginLeft:'8px', padding:'2px 8px', borderRadius:'999px',
        fontSize:'12px', background:'rgba(0,245,255,.15)',
        border:'1px solid rgba(0,245,255,.45)',
        boxShadow:'0 0 8px rgba(0,245,255,.35) inset', color:'#cfefff'
      });
      btn.insertAdjacentElement('afterend', badge);
    }
    return badge;
  };

  const hud   = ensureHUD();
  const badge = ensureBadge(e.target);

  // HUD表示（描画機会を与えてから重処理へ）
  hud.classList.remove('done'); hud.classList.add('show');
  hud.style.display = 'flex';
  await new Promise(r => setTimeout(r, 50)); // ← 描画確定のためのワンショット

  try {
    window.BULK_RESTORING = true;

    // ===== 設定 =====
    const FILL_OLD_TO_NEW = true;
    const RESTORE_WAIT_MS = 200;

    // ===== ユーティリティ =====
    const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
    const setVal = (el, v, kind='input') => { if(!el) return; el.value = v ?? ''; el.dispatchEvent(new Event(kind,{bubbles:true})); };
    const clearSubrows = (mainRow) => {
      while (mainRow.nextElementSibling && mainRow.nextElementSibling.classList.contains('btl-subrow')) {
        mainRow.nextElementSibling.remove();
      }
    };
const addAndGetSubrow = (mainRow) => {
  const grid = document.getElementById('bulkGrid');
  const cols = grid?.tHead?.rows?.[0]?.cells?.length || 0;

  /* 退列ありなら 5実セル、なしなら 4実セル */
  const hasLeaveCol = cols >= 24;
  const realCols = hasLeaveCol ? 5 : 4;
  const pads = Math.max(0, cols - realCols);

  const tr = document.createElement('tr');
  tr.className = 'btl-subrow';

  for (let i = 0; i < pads; i++) {
    const td = document.createElement('td');
    td.className = 'btl-pad';
    tr.appendChild(td);
  }

  tr.insertAdjacentHTML('beforeend', `
    <td class="btl-cell btl-detail-cell">
      <div class="btl-field-wrap btl-detail-wrap">
        <button type="button" class="bottle-hierarchy-btn" aria-label="ボトル選択">選択</button>
        <select class="bottleDetails">
          ${(window.BOTTLE_OPTIONS_HTML || '<option value=""></option>')}
        </select>
      </div>
    </td>

    <td class="btl-cell btl-split-cell">
      <input
        type="text"
        class="splitCount bulk-custom-keypad-target"
        inputmode="numeric"
        placeholder="割"
      >
    </td>

    <td class="btl-cell btl-qty-cell">
      <input
        type="text"
        class="bottleQuantity bulk-custom-keypad-target"
        inputmode="numeric"
        placeholder="数量"
      >
    </td>

    <td class="btl-cell btl-amount-cell">
      <input
        type="text"
        class="bottleAmount bulk-custom-keypad-target"
        inputmode="numeric"
        placeholder="金額"
      >
    </td>

    ${hasLeaveCol ? '<td class="btl-pad"></td>' : ''}
  `);

  let anchor = mainRow;
  while (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('btl-subrow')) {
    anchor = anchor.nextElementSibling;
  }
  anchor.insertAdjacentElement('afterend', tr);

  return tr;
};


    // ===== 1) 履歴ノード =====
    let items = document.querySelectorAll('#app2-historySection .history-item');
    if (!items.length) {
      const list = document.getElementById('historyList');
      if (list) items = list.querySelectorAll('li');
    }
    items = Array.from(items);
    if (!items.length) {
    console.warn('復元できる履歴がありません。');
    if (badge) {
    badge.textContent = '復元対象なし';
    badge.style.background = 'rgba(255,180,0,.18)';
    badge.style.borderColor = 'rgba(255,180,0,.5)';
    badge.style.boxShadow = '0 0 10px rgba(255,180,0,.35) inset';
  }
  return;
}
    if (FILL_OLD_TO_NEW) items.reverse();

    const total = items.length; let done = 0;
    const hudCount = document.getElementById('bulkHUDCount');
    const hudBar   = document.getElementById('bulkHUDBar');
    const updateProgress = () => {
      const pct = total ? Math.floor((done/total)*100) : 0;
      const label = `復元中...｜${done}/${total}（${pct}%）`;
      if (hudCount) hudCount.textContent = `${done}/${total}（${pct}%）`;
      if (hudBar)   hudBar.style.width = pct + '%';
      if (badge)    badge.textContent  = label;
    };
    updateProgress();

    // ===== 2) 行数合わせ =====
    const need = items.length;
    const rowsSel = document.getElementById('bulkRows');
    if (rowsSel) rowsSel.value = String(Math.max(need, parseInt(rowsSel.value||'0',10)||0));
    if (typeof buildGrid === 'function') buildGrid(need);
    const tbody = document.querySelector('#bulkGrid tbody');
    if (!tbody) throw new Error('一括入力テーブルが見つかりません。');

    // ===== 3) 復元ループ =====
    const QUANT_IDS = ['f','f2','jounai','honshiri','douhan','eda','help','set40','set20','vip','a','b','c','d','e'];
    let rowIndex = 0;
    for (const it of items) {
      const row = tbody.querySelectorAll('tr.bulk-mainrow')[rowIndex];
      if (!row) break;

      const restoreBtn = Array.from(it.querySelectorAll('button')).find(b => b.textContent.includes('復元'));
      if (!restoreBtn) { rowIndex++; continue; }

      restoreBtn.click();
      await sleep(RESTORE_WAIT_MS);

      setVal(row.querySelector('.bulk-name'), document.getElementById('castName')?.value, 'input');
      const exp = row.querySelector('.bulk-exp');
      if (exp) { exp.checked = !!document.getElementById('experienceAndRental')?.checked; exp.dispatchEvent(new Event('change', {bubbles:true})); }
      setVal(row.querySelector('.bulk-send'), document.getElementById('sendoffAmount')?.value, 'input');
      const norm = (v) => {
      const s = (v ?? '').toString().trim();
      return (s === '' || s === '0') ? '' : s;
      };

      QUANT_IDS.forEach(id => {
       const input = row.querySelector(`[data-k="${id}"]`);
     if (!input) return;

     // ★ 2k（f）は checkbox：checked をコピー
     if (id === 'f') {
    input.checked = !!document.getElementById('f')?.checked;
    return;
      }

     // ★ それ以外は value：ただし "0" は空扱い
     const v = norm(document.getElementById(id)?.value);
     setVal(input, v, 'input');
      });


      clearSubrows(row);
      const forms = Array.from(document.querySelectorAll('#bottleFormsContainer .bottle-form'));
for (const f of forms) {
  // 履歴候補でも __HIST__... ではなく実品名を取る
  const d = getSelectedDetail(f) || '';
  const s = f.querySelector('.splitCount')?.value || '';
  const q = f.querySelector('.bottleQuantity')?.value || '';
  const a = f.querySelector('.bottleAmount')?.value || '';

  if (!d && !s && !q && !a) continue;

  const sub = addAndGetSubrow(row);
  if (!sub) continue;

  const sel = sub.querySelector('.bottleDetails');
  if (sel) {
    setBottleDetailValue(sel, d);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  setVal(sub.querySelector('.splitCount'), s, 'input');
  setVal(sub.querySelector('.bottleQuantity'), q, 'input');
  setVal(sub.querySelector('.bottleAmount'), a, 'input');

  if (typeof updateBottleAmountForRow === 'function') {
    updateBottleAmountForRow(sub);
  }
}

      rowIndex++; done++;
      updateProgress();
      await new Promise(r => requestAnimationFrame(r)); // ← 描画更新を保証
    }

    // 仕上げ
    document.querySelectorAll('#bulkGrid input')
      .forEach(el => el.dispatchEvent(new Event('input', { bubbles:true })));

    // 完了演出
    hud.classList.add('done');
    if (hudCount) hudCount.textContent = `${done}/${total}（100%）`;
    if (badge) {
      badge.textContent = `復元完了｜${done}/${total}（100%）`;
      badge.style.background = 'rgba(0,255,160,.18)';
      badge.style.borderColor = 'rgba(0,255,160,.5)';
      badge.style.boxShadow = '0 0 10px rgba(0,255,160,.35) inset';
      setTimeout(()=>badge.remove(), 2500);
    }
  } catch (err) {
    console.error(err);
    if (badge) {
      badge.textContent = '復元エラー';
      badge.style.background = 'rgba(255,80,80,.18)';
      badge.style.borderColor = 'rgba(255,80,80,.5)';
      badge.style.boxShadow = '0 0 10px rgba(255,80,80,.35) inset';
    }
  } finally {
    // HUDは少し残してからフェードアウト
    setTimeout(()=>{
      const hud = document.getElementById('bulkHUD');
      if (hud) hud.style.display = 'none';
      window.BULK_RESTORING = false;
    }, 600);
  }
});

window.collectApp2State = collectApp2State;
window.applyApp2State   = applyApp2State;

/* =========================================================
   APP2: サイドナビを一括入力グリッドの下端より上へ行かせない
========================================================= */
/* =========================================================
   APP2: スマホ時だけ sideNav を bulkPanel の下端より上へ行かせない
========================================================= */
/* =========================================================
   APP2: サイドナビを bulkPanel の下端より上へ行かせない
========================================================= */
(function () {
  const sideNav = document.getElementById('app2-sideNav');
  if (!sideNav) return;

  function isApp2Mobile() {
    return (
      document.body.getAttribute('data-active-app') === 'app2' &&
      window.innerWidth <= 768
    );
  }

  function pxVar(name, fallback = 0) {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function getNormalTop() {
    const tabsH = pxVar('--tabs-h', 40);
    const subH  = pxVar('--subnav-h', 40);
    return tabsH + subH + 8;
  }

  function isVisible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null;
  }

  function updateApp2SideNavClamp() {
    if (!sideNav) return;

    const normalTop = getNormalTop();

    /* APP2スマホ以外では通常位置へ戻す */
    if (!isApp2Mobile()) {
      sideNav.style.setProperty('top', `${normalTop}px`, 'important');
      return;
    }

    const bulkPanel = document.getElementById('bulkPanel');

    /* bulkPanel が無い/見えていないなら通常位置 */
    if (!isVisible(bulkPanel)) {
      sideNav.style.setProperty('top', `${normalTop}px`, 'important');
      return;
    }

    const gap = 8; /* bulkグリッド下端との余白 */
    const rect = bulkPanel.getBoundingClientRect();

    /* bulkPanel の下端より上へ行かせない */
    const clampedTop = Math.max(normalTop, Math.round(rect.bottom + gap));

    sideNav.style.setProperty('top', `${clampedTop}px`, 'important');
  }

  let rafId = 0;
  function requestUpdate() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      updateApp2SideNavClamp();
    });
  }

  document.addEventListener('DOMContentLoaded', requestUpdate);
  window.addEventListener('load', requestUpdate);
  window.addEventListener('resize', requestUpdate, { passive: true });
  window.addEventListener('scroll', requestUpdate, { passive: true });

  const mo = new MutationObserver(requestUpdate);
  mo.observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ['class', 'style', 'data-active-app']
  });

  /* bulkPanel 自体の変化にも追従 */
  const bulkPanel = document.getElementById('bulkPanel');
  if (bulkPanel) {
    const mo2 = new MutationObserver(requestUpdate);
    mo2.observe(bulkPanel, {
      attributes: true,
      childList: true,
      subtree: true
    });
  }

  window.updateApp2SideNavClamp = requestUpdate;
})();

/* =========================================================
   入力済みセルに filled クラスを付与
========================================================= */
function updateBulkFilledState(root = document) {
  root.querySelectorAll('#bulkGrid input[type="text"], #bulkGrid input[type="number"], #bulkGrid select')
    .forEach(el => {
      const val = (el.value || '').trim();
      if (val !== '') {
        el.classList.add('filled');
      } else {
        el.classList.remove('filled');
      }
    });
}

document.addEventListener('input', (e) => {
  if (e.target.closest('#bulkGrid')) {
    updateBulkFilledState(e.target.closest('#bulkGrid'));
  }
}, true);

document.addEventListener('change', (e) => {
  if (e.target.closest('#bulkGrid')) {
    updateBulkFilledState(e.target.closest('#bulkGrid'));
  }
}, true);





/************************************************************
 * 5. APP3
 ************************************************************/


/* app3（ざっくり）：id付きの要素を一括保存/復元 */
function collectApp3State(){
  const root = document.getElementById('app3');
  if(!root) return {};
  const fields = {};
  root.querySelectorAll('input[id], select[id], textarea[id]').forEach(el=>{
    fields[el.id] = (el.type === 'checkbox') ? !!el.checked : (el.value ?? "");
  });
  return { fields };
}
function applyApp3State(state){
  const root = document.getElementById('app3');
  if(!root || !state || !state.fields) return;
  Object.entries(state.fields).forEach(([id, val])=>{
    const el = root.querySelector('#'+CSS.escape(id));
    if(!el) return;
    if(el.type === 'checkbox'){ el.checked = !!val; }
    else { el.value = val ?? ""; }
  });
}

function updateExtraGroupFields() {

  let grossProfit   = get('grossProfit')   || 0;
  let cardSales     = get('cardSales')     || 0;
  let adviserFee    = get('adviserFee')    || 0;
  let remainingCash = get('remainingCash') || 0;
  let totalTax      = get('totalTax')      || 0;

  let totalGrossPlusTax = remainingCash + totalTax + adviserFee;

  let el;
  

  el = document.getElementById('grossProfit_extra');
  if (el) el.value = formatNumber(grossProfit);

  el = document.getElementById('cardSales_extra');
  if (el) el.value = formatNumber(cardSales);

  // ←これ追加
  el = document.getElementById('adviserFee_extra');
  if (el) el.value = formatNumber(adviserFee);

  el = document.getElementById('remainingCash_extra');
  if (el) el.value = formatNumber(remainingCash);

  el = document.getElementById('totalWithholdingTax');
  if (el) el.value = formatNumber(totalTax);

  el = document.getElementById('totalGrossPlusTax');
  if (el) el.value = formatNumber(totalGrossPlusTax);
}

function updateNegativeColor(id) {
  const el = document.getElementById(id);
  if (!el) return; // 無ければ何もしない
  const v = parseInt((el.value || '0').replace(/,/g, ''), 10) || 0;
  el.classList.toggle('negative', v < 0);
}

function saveApp3Data() {
  const fields = [
    'startCash', 'maleSalary', 'scoutBack', 'driverFee', 'maleTax',
    'alcohol', 'receipt1', 'receipt2', 'receipt3', 'receipt4', 'receipt5', 'finalCash'
  ];
  const data = {};
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  localStorage.setItem('app3_inputs', JSON.stringify(data));
}

function restoreApp3Data() {
  const saved = localStorage.getItem('app3_inputs');
  if (!saved) return;
  const data = JSON.parse(saved);
  Object.entries(data).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  updateCalculations(); // 計算更新
  attachCommaFormatApp1and3();
}

function loadFromLocal() {
  const inputs = document.querySelectorAll('input');
  inputs.forEach(input => {
    const saved = localStorage.getItem(input.id);
    if (saved !== null) input.value = saved;
  });
}

function saveToLocal() {
  const inputs = document.querySelectorAll('input');
  inputs.forEach(input => {
    // disabled 状態でも保存
    localStorage.setItem(input.id, input.value);
  });
}

function formatNumber(num) {
 return num.toLocaleString('ja-JP');
}

// 1) 最初に使う共通getter（カンマ/¥除去）
function get(id){
  const el = document.getElementById(id);
  if (!el) return 0;
  const raw = (el.value ?? el.textContent ?? "0").toString().replace(/[^\d\-]/g,"");
  const num = parseInt(raw,10);
  return Number.isNaN(num) ? 0 : num;
}

function attachCommaFormatApp3() {
  document.querySelectorAll(
    '#app3 input[type="text"], #app3 input[type="number"]'
  ).forEach(input => {
    if (input._commaFormatApplied) return;
    input._commaFormatApplied = true;

    input.addEventListener('input', function () {
      let val = this.value.replace(/,/g, '');
      if (val === '' || !/^-?\d*$/.test(val)) {
        this.value = '';
        return;
      }
      this.value = addComma(val);
    });

    input.addEventListener('focus', function () {
      this.value = this.value.replace(/,/g, '');
    });

    input.addEventListener('blur', function () {
      this.value = addComma(this.value);
    });
  });
}

window.collectApp3State = collectApp3State;
window.applyApp3State   = applyApp3State;

function getTotalStoreBurden() {
  try {
    const items = document.querySelectorAll('#historyList > li');
    let total = 0;
    items.forEach(li => {
      // 1) data属性があれば最優先
      const attr = li.getAttribute('data-store-covered');
      if (attr !== null && attr !== '') {
        const v = parseInt(attr, 10);
        if (!Number.isNaN(v)) { total += v; return; }
      }
      // 2) sendoff 行のテキストから拾う
      const txt = li.querySelector('.sendoff')?.textContent || '';
      const m = txt.match(/店舗負担:\s*¥?\s*([\d,]+)/);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''), 10);
        if (!Number.isNaN(v)) total += v;
      }
    });
    return total;
  } catch (e) {
    console.warn('店舗負担合計の取得に失敗', e);
    return 0;
  }
}

// ★追加：総客数・女子出勤数ミニフォームを自動反映
function updateAttendanceMiniForm() {
  // 総客数 → customersCount
  const totalSpan = document.getElementById('totalCustomers');
  const customersInput = document.getElementById('customersCount');
  if (totalSpan && customersInput) {
    const num = parseInt(totalSpan.textContent.replace(/[^0-9\-]/g, ''), 10);
    customersInput.value = Number.isNaN(num) ? '' : num;
  }

  // 履歴インデックス人数（「○人」）→ femaleAttendance
  const historyCountSpan = document.getElementById('historyIndexCount');
  const femaleInput = document.getElementById('femaleAttendance');
  if (historyCountSpan && femaleInput) {
    const m = historyCountSpan.textContent.match(/(\d+)/);
    const num2 = m ? parseInt(m[1], 10) : NaN;
    femaleInput.value = Number.isNaN(num2) ? '' : num2;
  }
}

function updateCalculations(){

  // --- ① driverFee を最初に再計算 ---
  (function(){
    // storeTotal → driverExtra1 に反映
    const el = document.getElementById('driverExtra1');
    if (el) {
      const storeTotal = getTotalStoreBurden();
      el.value = Number.isNaN(storeTotal) ? '' : storeTotal.toLocaleString('ja-JP');
    }

    // extra1 + extra2 → driverFee に反映
    const extra1 = get('driverExtra1');
    const extra2 = get('driverExtra2');
    const sum = extra1 + extra2;
    const feeEl = document.getElementById('driverFee');
    if (feeEl) feeEl.value = sum ? sum.toLocaleString('ja-JP') : '';
  })();


  // --- ② カード売上・税関連 ---
  const cardTotalText = document.getElementById('cardTotal')?.textContent || '0';
  const cardTotal = parseInt(cardTotalText.replace(/,/g, ''), 10) || 0;
  const cardSalesInput = document.getElementById('cardSales');
  if (cardSalesInput) cardSalesInput.value = formatNumber(cardTotal);

  const summaryTaxText = document.getElementById('summaryTotalTax')?.innerText || '¥0';
  const summaryTaxValue = parseInt(summaryTaxText.replace(/[¥,]/g, ''), 10) || 0;
  const femaleTaxEl0 = document.getElementById('femaleTax');
  if (femaleTaxEl0) femaleTaxEl0.value = summaryTaxValue;

  // --- ③ totalBackAmount → catchBack ---
  const totalBackAmountText =
    document.getElementById("totalBackAmount")?.textContent?.replace(/,/g, "") || "0";
  const totalBackAmount = parseInt(totalBackAmountText, 10) || 0;
  const catchBackEl = document.getElementById("catchBack");
  if (catchBackEl) catchBackEl.value = totalBackAmount.toLocaleString();

  // --- ④ 売上・現金 ---
  const total = get('totalSales');
  const card = get('cardSales');
  const cash = total - card;
  const cashSalesEl = document.getElementById('cashSales');
  if (cashSalesEl) cashSalesEl.value = formatNumber(cash);

  // --- ⑤ 税・経費 ---
  const tax = get('femaleTax') + get('maleTax');
  const totalTaxEl = document.getElementById('totalTax');
  if (totalTaxEl) totalTaxEl.value = formatNumber(tax);

  const receiptTotal =
    get('receipt1') + get('receipt2') + get('receipt3') + get('receipt4') + get('receipt5');
  const r6 = document.getElementById('receipt6');
  if (r6) r6.value = formatNumber(receiptTotal);

  const expenses = get('alcohol') + receiptTotal;
  const totalExpEl = document.getElementById('totalExpenses');
  if (totalExpEl) totalExpEl.value = formatNumber(expenses);


  // --- ⑥ adviserFee 自動計算 ---
  const adviserCountEl = document.getElementById('totalCountValue');
  const adviserFeeInput = document.getElementById('adviserFee');
  if (adviserCountEl && adviserFeeInput) {
    const count = parseInt(adviserCountEl.textContent.replace(/,/g, ''), 10) || 0;
    adviserFeeInput.value = (count * 1000).toLocaleString();
  }


  // --- ⑦ 人件費合計 ---
  const labor =
    get('femaleSalary') +
    get('maleSalary') +
    get('catchBack') +
    get('scoutBack') +
    get('adviserFee') +
    get('driverFee');

  const totalLaborEl = document.getElementById('totalLaborCosts');
  if (totalLaborEl) totalLaborEl.value = formatNumber(labor);


  // --- ⑧ 粗利益・残・誤差 ---
  const gross = total - labor - tax - expenses;
  const grossEl = document.getElementById('grossProfit');
  if (grossEl) grossEl.value = formatNumber(gross);

  const remaining = gross - card;
  const remainingEl = document.getElementById('remainingCash');
  if (remainingEl) remainingEl.value = formatNumber(remaining);

  const startCash = get('startCash');
  const finalCash = get('finalCash');
  const extraSafeCash = get('extraSafeCash');
  const adviserFee = get('adviserFee'); // ←追加
  const difference = (finalCash - remaining - tax - adviserFee) - (startCash + extraSafeCash);
  const diffEl = document.getElementById('cashDifference');
  if (diffEl) diffEl.value = formatNumber(difference);


  // --- ⑨ 表示更新・保存 ---
  updateAttendanceMiniForm();
  updateNegativeColor('grossProfit');
  updateNegativeColor('remainingCash');
  updateNegativeColor('cashDifference');
  updateExtraGroupFields();
  attachCommaFormatApp3();
  saveToLocal();
  updateExtraGroupFields();
}

// APP1/APP2 の集計DOM変化を監視 → APP3更新を予約
(function installApp3AutoSyncObservers(){
  const watchIds = [
    'cardTotal',        // カード売上の元
    'summaryTotalTax',  // 税合計の元
    'totalBackAmount',  // CB合計の元
    'totalCustomers',   // 総客数（ミニフォーム用）
    'historyIndexCount' // 女子出勤数（ミニフォーム用）
  ];

  const observer = new MutationObserver(() => {
    scheduleApp3Update('mutation');
  });

  watchIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    observer.observe(el, {
      childList: true,
      characterData: true,
      subtree: true
    });
  });
})();

// APP3 更新を「次フレームにまとめる」グローバル関数（必須）
(function(){
  let pending = false;

  window.scheduleApp3Update = function(reason = '') {
    if (pending) return;
    pending = true;

    requestAnimationFrame(() => {
      pending = false;

      // APP3 側の更新関数が存在する場合だけ呼ぶ（存在しない環境でも落とさない）
      try {
        if (typeof window.updateAttendanceMiniForm === 'function') {
          window.updateAttendanceMiniForm();
        }
      } catch(e){}

      try {
        if (typeof window.updateCalculations === 'function') {
          window.updateCalculations();
        }
      } catch(e){
        console.warn('scheduleApp3Update failed:', reason, e);
      }
    });
  };
})();

function attachApp3Listeners() {
  const fields = [
    'startCash', 'maleSalary', 'scoutBack', 'driverFee', 'maleTax',
    'alcohol', 'receipt1', 'receipt2', 'receipt3', 'receipt4', 'receipt5', 'finalCash'
  ];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', saveApp3Data);
    }
  });
}

function getCustomFileName() {
  // JSTに補正（サーバーUTCなら+9）
  const now = new Date();
  now.setHours(now.getHours() + 9);

  let fileDate = new Date(now);
  const hour = now.getHours();
  if (hour < 20) {
    fileDate.setDate(fileDate.getDate() - 1);
  }
  const y = fileDate.getFullYear();
  const m = String(fileDate.getMonth() + 1).padStart(2, '0');
  const d = String(fileDate.getDate()).padStart(2, '0');

  return `IBASD_${y}-${m}-${d}`;
}





/************************************************************
 * 6. Excel出力・外部連携
 ************************************************************/

// 日計シート列マッピング（PA）
const COLMAP_PA = {
  totalCustomers:  "B",
  historyIndexCount: "C",
  maleAttendance: "D",
  cardSales: "F",
  totalSales: "G",
  femaleSalary: "H",
  maleSalary: "I",
  catchBack: "J",
  scoutBack: "K",
  adviserFee: "L",
  driverFee: "M",
  femaleTax: "O",
  maleTax: "P",
  alcohol: "R",
  receipt6: "S",
};

// CBシート列マッピング（本数）
const COLMAP_CB = {
  UKcount:   "B",
  Kcount:    "C",
  ABcount:   "D",
  LAcount:   "E",
  PAcount:   "F",
  BBcount:   "G",
  MScount:   "H",
  GMcount:   "I",
  Bcount:    "J",
  JOEcount:  "K",
  KOSEcount: "L",
  HEcount:   "M",
  PBcount:   "N"
};

//式行（上書き禁止）
const FORMULA_ROWS = [17, 34, 35];


// APP3保存と封筒印刷で共通利用する日付文字列生成関数
function getApp3StyleDate() {
  const d = new Date();
  // 5時より前なら前日扱い
  if (d.getHours() < 5) {
    d.setDate(d.getDate() - 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

// メイン処理：日計 + CB に同時書き込み
async function exportApp3MonthlyWrite_xpop(){

  const workDate = readWorkDate();
  if (!workDate){
    alert("対象日付を入力してください。");
    return;
  }

  const d = new Date(workDate.replace(/\./g,"/").replace(/-/g,"/"));
  if (isNaN(d)) { alert("日付形式が不正です。"); return; }

  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth()+1).padStart(2,"0");
  const dd   = d.getDate();


  // (1) ファイル選択
  let fileHandle, file;
  try{
    [fileHandle] = await showOpenFilePicker({
      types: [{
        description: 'Excel',
        accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] }
      }],
      excludeAcceptAllOption: false,
      multiple: false
    });
    file = await fileHandle.getFile();
  }catch{
    alert("Excelファイルが選択されませんでした。");
    return;
  }

  const buffer = await file.arrayBuffer();


  // (2) ブック読み込み
  const workbook = await XlsxPopulate.fromDataAsync(buffer);

  // シート名は「日計」「CB」
  const sheetPA = workbook.sheet("日計");
  const sheetCB = workbook.sheet("CB");

  if (!sheetPA){
    alert("Excel内に『日計』シートがありません。");
    return;
  }
  if (!sheetCB){
    alert("Excel内に『CB』シートがありません。");
    return;
  }


  // (3) A列で dd に一致する行を探す（1行目は表題なので2行目以降）
  let targetRow = null;
  for (let r = 2; r <= 40; r++) {
    const v = sheetPA.cell("A" + r).value();

    if (typeof v === "number" && v === dd){
      targetRow = r;
      break;
    }
    if (typeof v === "string"){
      const n = parseInt(v,10);
      if (!Number.isNaN(n) && n === dd){
        targetRow = r;
        break;
      }
    }
  }

  if (!targetRow){
    alert(`${dd}日 に対応する行が A列に見つかりません。`);
    return;
  }

  if (FORMULA_ROWS.includes(targetRow)) {
    alert(`${dd}日は合計行（式行）のため上書きできません。`);
    return;
  }


  const $ = (id)=>document.getElementById(id);

  // (4) 日計シートへ書き込み
  for (const [id, col] of Object.entries(COLMAP_PA)) {
    const el = $(id);
    if (!el) continue;

    const raw = (el.value ?? el.textContent ?? "0").toString();
    const num = parseFloat(raw.replace(/[^\d.-]/g,"")) || 0;

    sheetPA.cell(`${col}${targetRow}`).value(num);
  }

  // (5) CBシートへ書き込み（本数）
  for (const [id, col] of Object.entries(COLMAP_CB)) {
    const el = $(id);
    if (!el) continue;

    const raw = (el.value ?? el.textContent ?? "0").toString();
    const num = parseFloat(raw.replace(/[^\d.-]/g,"")) || 0;

    sheetCB.cell(`${col}${targetRow}`).value(num);
  }


  // (6) 上書き保存
  try{
    const outBuffer = await workbook.outputAsync();
    const writable = await fileHandle.createWritable();
    await writable.write(outBuffer);
    await writable.close();

    alert(`Excelに書き込みました：\n${dd}日 → ${targetRow}行目（『日計』『CB』両方）`);
  }catch(e){
    console.error(e);
    alert("Excel書き出しに失敗しました。");
  }
}

// 入力済みHTMLとして保存 v2.9
window.exportAsFilledHTML = function(){
  const doc = document;
  const cloned = doc.documentElement.cloneNode(true);
  const $all = (root, sel) => Array.from(root.querySelectorAll(sel));
  const esc  = (window.CSS && CSS.escape) ? CSS.escape : s=>String(s).replace(/[^a-zA-Z0-9_\-]/g,'\\$&');
  const byId = (root, id) => id ? root.querySelector('#'+esc(id)) : null;

  // ===== 1) 値の焼き込み（id/name 優先） =====
  // input
  $all(doc,'input').forEach(oi=>{
    const ci = (oi.id && byId(cloned,oi.id)) || (oi.name && cloned.querySelector(`[name="${esc(oi.name)}"]`));
    if(!ci) return;
    const type=(oi.getAttribute('type')||'text').toLowerCase();
    if(type==='checkbox'||type==='radio'){
      if(oi.checked) ci.setAttribute('checked',''); else ci.removeAttribute('checked');
      if(type==='radio' && oi.name){
        $all(cloned,`input[type="radio"][name="${esc(oi.name)}"]`).forEach(r=>{ if(r!==ci) r.removeAttribute('checked'); });
      }
    }else{
      ci.setAttribute('value', oi.value ?? '');
    }
    ci.setAttribute('disabled','disabled'); ci.setAttribute('readonly','readonly');
    ['onclick','onchange','oninput','onsubmit'].forEach(a=>ci.removeAttribute(a));
  });
  // textarea
  $all(doc,'textarea').forEach(ot=>{
    const ct = (ot.id && byId(cloned,ot.id)) || (ot.name && cloned.querySelector(`[name="${esc(ot.name)}"]`));
    if(!ct) return;
    ct.textContent = ot.value ?? '';
    ct.setAttribute('disabled','disabled'); ct.setAttribute('readonly','readonly');
    ['onclick','onchange','oninput','onsubmit'].forEach(a=>ct.removeAttribute(a));
  });
  // select
  $all(doc,'select').forEach(os=>{
    const cs = (os.id && byId(cloned,os.id)) || (os.name && cloned.querySelector(`[name="${esc(os.name)}"]`));
    if(!cs) return;
    const val = os.value ?? '';
    $all(cs,'option').forEach(opt=>{ if(opt.value===val) opt.setAttribute('selected',''); else opt.removeAttribute('selected'); });
    cs.setAttribute('disabled','disabled'); cs.setAttribute('readonly','readonly');
    ['onclick','onchange','oninput','onsubmit'].forEach(a=>cs.removeAttribute(a));
  });

  // ===== 2) APP1 伝票行（#formRows tr.row）を行×クラスで焼き込み =====
  const oRows = $all(doc,'#formRows tr.row');
  const cRows = $all(cloned,'#formRows tr.row');
  const fields = ['.table-number','.honshi','.c','.amount','.num','.detail','.card','.total'];
  oRows.forEach((tr,i)=>{
    const ctr = cRows[i]; if(!ctr) return;
    fields.forEach(sel=>{
      const oi = tr.querySelector(sel);
      const ci = ctr.querySelector(sel);
      if(!oi || !ci) return;
      if (ci.tagName === 'SELECT') {
        const val = oi.value ?? '';
        $all(ci,'option').forEach(opt=>{ if(opt.value===val) opt.setAttribute('selected',''); else opt.removeAttribute('selected'); });
      } else {
        const type=(oi.getAttribute('type')||'text').toLowerCase();
        if(type==='checkbox'||type==='radio'){
          if(oi.checked) ci.setAttribute('checked',''); else ci.removeAttribute('checked');
        }else{
          ci.setAttribute('value', oi.value ?? '');
        }
      }
      ci.setAttribute('disabled','disabled'); ci.setAttribute('readonly','readonly');
      ['onclick','onchange','oninput','onsubmit'].forEach(a=>ci.removeAttribute(a));
    });
  });

  // ===== 3) カテゴリ表チェック（#categorySection）を出現順で固定 =====
  const oCbs = $all(doc,'#categorySection input[type="checkbox"]');
  const cCbs = $all(cloned,'#categorySection input[type="checkbox"]');
  oCbs.forEach((o,i)=>{
    const c = cCbs[i]; if(!c) return;
    if(o.checked) c.setAttribute('checked',''); else c.removeAttribute('checked');
    c.setAttribute('disabled','disabled');
    ['onclick','onchange'].forEach(a=>c.removeAttribute(a));
  });

  // ===== 4) タブをアンカー式に変換（JS不要の切替） =====
  const tabsBar = cloned.querySelector('.tabs');
  if(tabsBar){
    $all(tabsBar,'.tab').forEach(old=>{
      if(old.tagName.toLowerCase()==='a') return;
      const target = old.getAttribute('data-target') || 'app1';
      const label  = (old.textContent||'').trim() || target;
      const a = document.createElement('a');
      a.className = old.className.replace(/\bactive\b/g,'').trim();
      a.setAttribute('href','#'+target);
      a.setAttribute('role','tab');
      a.textContent = label;
      old.replaceWith(a);
    });
  }

  // ===== 5) 保存版用CSSを追加（:target で切替 & アニメ無効化） =====
  const head  = cloned.querySelector('head') || cloned.getElementsByTagName('head')[0];
  const style = document.createElement('style');
  style.textContent = `
    /* 保存版バッジ＆操作不可 */
    body[data-frozen="1"] * { caret-color: transparent; }
    [disabled], input[readonly], select[disabled], textarea[disabled]{ opacity:.85; pointer-events:none; }
    .frozen-banner{
      position:fixed; top:8px; right:8px; z-index:99999;
      padding:6px 10px; font:12px/1 system-ui,-apple-system,Segoe UI,Roboto,"M PLUS 2",sans-serif;
      background:rgba(0,245,255,.14); border:1px solid rgba(0,245,255,.55);
      border-radius:8px; color:#00f5ff; backdrop-filter: blur(6px);
    }
    /* 既存のアニメを打ち消して“表示優先” */
    .content{ opacity:1 !important; transform:none !important; }

    /* JSなしのAPP切替：デフォ非表示、:targetだけ表示 */
    .content{ display:none !important; }
    .content:target{ display:block !important; }
    /* ハッシュ無しの初期表示はapp1 */
    :root #app1{ display:block !important; }
  `;
  head.appendChild(style);

  // ===== 6) バナー付与・初期表示の保険 =====
  const body = cloned.querySelector('body') || cloned.getElementsByTagName('body')[0];
  if(body){
    body.setAttribute('data-frozen','1');
    const banner = document.createElement('div');
    banner.className = 'frozen-banner';
    banner.textContent = 'このファイルは入力済みの保存版（編集不可）';
    body.appendChild(banner);
  }
  ['app1','app2','app3'].forEach(id=>{
    const el = byId(cloned,id);
    if(el){ el.removeAttribute('hidden'); el.style.visibility='visible'; }
  });

  // ===== 7) クリック不可（証跡用） =====
  $all(cloned,'button').forEach(b=>{ b.setAttribute('disabled','disabled'); b.removeAttribute('onclick'); b.type='button'; });
  $all(cloned,'form').forEach(f=>{ f.setAttribute('onsubmit','return false;'); });

  // ===== 8) <script> 全削除（完全静的化） =====
  $all(cloned,'script').forEach(s=> s.remove());

  // ===== 9) ダウンロード =====
  const htmlText = '<!DOCTYPE html>\n' + cloned.outerHTML;
  const blob = new Blob([htmlText], { type:'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  try{
    const base = (typeof window.getCustomFileName==='function') ? window.getCustomFileName()
               : 'IBASD_' + new Date().toISOString().slice(0,10);
    a.href = url; a.download = base + '.html'; a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
};


// APP1 印刷
(function(){
  const YEN = (v)=> Number(v||0).toLocaleString('ja-JP');

  // #result をそのまま印刷（既存互換）
  window.preparePrintApp1 = function () {
    const html = (document.getElementById('result')?.innerHTML || '').trim();
    if (!html) { alert('印刷する内容がありません。'); return; }

    const printCSS = `
      <style>
        @media print {
          @page { size: 90mm 205mm; margin: 0; }
          html, body {
            margin: 0; padding: 0; background: #fff;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          #result {
            width: 90mm !important; max-height: 205mm !important;
            margin: 0 auto !important; padding: 8mm 6mm !important;
            box-sizing: border-box; font-size: 10.5pt; line-height: 1.25;
          }
          #result, .envelope {
            page-break-before: avoid;
            page-break-after: avoid;
            page-break-inside: avoid;
          }
        }
      </style>`;

    openPrintApp1(printCSS + `<div id="result">${html}</div>`, { rotateOnMobile: true });
  };

  // 封筒印刷（ALL or 個別カテゴリ）
  window.printEnvelopeApp1 = function (category) {
    const dateStr = (typeof getApp3StyleDate === 'function')
      ? getApp3StyleDate()
      : (() => {
          const d = new Date();
          return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        })();

    if (category === 'ALL') {
      if (!confirm('伝票の記入はすべて完了していますか？')) return;

      const CATS = ['UK','K','AB','LA','PA','BB','MS','GM','B','JOE','KOSE','HE','PB'];

      const perCat = CATS.map(key => {
        const arr = (window.catchbackDetails && window.catchbackDetails[key]) || [];
        const total = arr.reduce((s, d) => {
          const n = parseInt(String(d?.count ?? 0).replace(/,/g,''), 10);
          return s + (isNaN(n) ? 0 : n);
        }, 0);
        return { key, total };
      });

      const shown = perCat.filter(x => x.total > 0);
      const list  = shown.length ? shown : perCat;

      const grand  = list.reduce((s, x) => s + x.total, 0);
      const amount = grand * 1000;

      // openPrintApp1 は行テキストを再構成するので 1行ずつ渡す
      const lines = list.map(x => `${x.key} (計${x.total})`).join('\n');

      const innerAll = `
        <div class="envelope">
          <div class="print-date">${dateStr}</div>
          <div class="print-title">顧問料</div>
          <div style="text-align:center; font-size:26pt; margin:2mm 0 3mm;">￥${YEN(amount)}</div>
          <div style="text-align:center; font-size:14pt; margin-bottom:4mm;">（人数: ${grand}）</div>
          ${lines}
          <div style="text-align:center; font-size:14pt; margin-top:4mm;">Total ${grand}</div>
        </div>`;

      openPrintApp1(innerAll, { rotateOnMobile:true });
      return;
    }

    // 個別カテゴリ
    // 個別カテゴリ
// --- 個別カテゴリ ---
const arr = (window.catchbackDetails && window.catchbackDetails[category]) || [];
const lineTexts = [];
let total = 0;
arr.forEach(d => {
  const unit  = Number(String(d.unit || 0).replace(/[,￥¥]/g,''));
  const count = Number(String(d.count|| 0).replace(/,/g,''));
  if (unit && count) {
    lineTexts.push(`${unit.toLocaleString()}×${count}`);
    total += count;
  }
});

// ✅ 合計金額を画面上の <span id="UKtotal"> の値から取得
const totalSpan = document.getElementById(`${category}total`);
const amountText = totalSpan ? totalSpan.textContent.trim() : "0";

// <br> で改行
const rowsHtml = lineTexts.length ? lineTexts.join('<br>') : '0';

// 出力HTML
const innerCat = `
  <div class="envelope" style="font-size:11pt;line-height:1.35;">
    <div class="print-date">${dateStr}</div>
    <div class="print-title">${category}</div>
    <div class="detail-list" style="margin:3mm 0 4mm 0;">
      ${rowsHtml}
    </div>
    <div style="text-align:center; font-size:12pt; margin-top:2mm;">
      Total ${total}本
    </div>
    <div style="text-align:center; font-size:22pt; margin:3mm 0 0;">
      ￥${amountText}
    </div>
  </div>`;

openPrintApp1(innerCat, { rotateOnMobile:true, noRebuild:true });
  }

  // コア：印刷ウィンドウ生成・整形・復帰制御
  function openPrintApp1(innerHTML, opts = { rotateOnMobile:true }) {
    // ---- 行テキスト化して3行パターンを再構成 ----
    // ---- 行テキスト化して3行パターンを再構成 ----
let rebuilt = innerHTML;
if (!opts?.noRebuild) {
  const tmpEl = document.createElement('div');
  tmpEl.innerHTML = innerHTML;
  const lines = (tmpEl.innerText.trim().split(/\r?\n/)).map(s => s.trim());

  rebuilt = "";
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i] || "";
    const b = lines[i + 1] || "";
    const c = lines[i + 2] || "";

    if (/^[A-Z]{1,6}$/.test(a) &&
        (/^\d{1,3}(?:,\d{3})*(?:\s*×\s*\d+)?$|^\d+$/.test(b)) &&
        c.includes("計")) {
      rebuilt += `
        <div class="cat-line">
          <span class="cat">${a}</span>
          <span class="val">${b}</span>
          <span class="cnt">${c}</span>
        </div>`;
      i += 2;
    } else if (a === "") {
      rebuilt += `<div class="group-sep"></div>`;
    } else {
      rebuilt += `<div class="misc">${a}</div>`;
    }
  }
}

    // ---- 子ウィンドウ生成（毎回ユニーク名）----
    const isSP = /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent);
    const winName = "app1print_" + Date.now();
    const w = window.open("", winName);
    if (!w) { alert("ポップアップがブロックされました。許可してください。"); return; }

    const doc = w.document;
    doc.open();
    doc.write(`
      <!doctype html>
      <html lang="ja">
      <head>
        <meta charset="utf-8">
        <title>APP1 出力</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          @page { size: 90mm 205mm; margin: 0; }
          html, body {
            margin: 0; padding: 0; background: #fff;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          #page {
            width: 90mm; height: 205mm;
            padding: 8mm 6mm; box-sizing: border-box;
            font-size: 11pt; line-height: 1.3;
          }
          .rotate180 #page { transform: rotate(180deg); transform-origin: 50% 50%; }
          .cat-line {
            display: grid; grid-template-columns: 3.2em 6em auto;
            column-gap: 8px; align-items: baseline;
          }
          .cat-line .cat { font-weight: 700; }
          .cat-line .val, .cat-line .cnt { text-align: right; }
          .cat-line .cnt { opacity: .9; }
          .group-sep { height: 0.8em; }
          .misc { margin: 2px 0; }
          #__app1Back {
            position: fixed; right: 8px; top: 8px; padding: .5em .8em;
            font-size: 12px; border: 1px solid #888; border-radius: 6px;
            background: #fff; cursor: pointer; z-index: 9999;
          }
          @media print { #__app1Back { display:none } }
        </style>
      </head>
      <body class="${isSP && opts.rotateOnMobile ? 'rotate180' : ''}">
        <div id="page">${rebuilt}</div>
        <button id="__app1Back">← 元の画面へ戻る</button>
        <script>
          (function(){
            function backToOpener(){
              try { if (window.opener && !window.opener.closed) window.opener.focus(); } catch(e){}
              try { window.close(); } catch(e){}
              try { if (window.opener && !window.opener.closed) window.opener.postMessage({type:'IBASD_PRINT_DONE'}, '*'); } catch(e){}
            }

            // 印刷キック（load 済みでも一回だけ）
            let kicked=false, printed=false;
            function kick(){
              if (kicked) return; kicked=true;
              try { window.focus(); window.print(); printed=true; } catch(e){}
            }
            if (document.readyState === 'complete') { setTimeout(kick, 80); }
            else {
              window.addEventListener('load', ()=> setTimeout(kick,120), {once:true});
              document.addEventListener('readystatechange', ()=> {
                if (document.readyState === 'complete') setTimeout(kick, 80);
              });
            }
            setTimeout(kick, 1500); // 最後の一押し

            // 必ず閉じて戻る：5重トリガ
            window.addEventListener('afterprint', backToOpener);
            window.addEventListener('focus', ()=> { if (printed) backToOpener(); });
            document.addEventListener('visibilitychange', ()=> { if (!document.hidden) backToOpener(); });
            try {
              const mql = matchMedia('print');
              const h = e => { if (!e.matches) backToOpener(); };
              (mql.addEventListener ? mql.addEventListener('change', h) : mql.addListener(h));
            } catch(e){}
            setTimeout(backToOpener, 12000); // タイムアウト保険

            // 手動戻る
            document.getElementById('__app1Back')?.addEventListener('click', backToOpener);
          })();
        <\/script>
      </body>
      </html>
    `);
    doc.close();

    // 親側：ユーザー操作直後の“第一弾”をここで試す
    try {
      w.__app1Printed = false;
      w.focus();
      w.print();           // ここで開けば最短
      w.__app1Printed = true;

      w.addEventListener('load', () => {
        if (!w.__app1Printed) {
          try { w.focus(); w.print(); w.__app1Printed = true; } catch(e){}
        }
      }, { once:true });
    } catch(e) {}

    // 親側ウォッチドッグ：子が閉じたら即フォーカス
    try {
      const wd = setInterval(() => {
        if (!w || w.closed) { clearInterval(wd); try { window.focus(); } catch(e){} }
      }, 700);

      window.addEventListener('message', (ev) => {
        if (ev && ev.data && ev.data.type === 'IBASD_PRINT_DONE') {
          try { window.focus(); } catch(e){}
        }
      }, { once:true });
    } catch(e){}
  }

})();

// APP2 印刷

function openPrintApp2(innerHTML, opts = {}) {
  const { scale = 1.00, rotateOnMobile = true, trimBottomMM = 0 } = opts;
  const isSP = /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent);
  const rotate = rotateOnMobile && isSP;

  // ★ 最終合計をチェックして、条件を満たせば special クラスを付与
  const temp = document.createElement('div');
  temp.innerHTML = innerHTML;
  const finalEl = temp.querySelector('.finalAmount');
  if (finalEl) {
    const num = parseInt(finalEl.textContent.replace(/[^0-9]/g, ''), 10);
    if (num >= 100000) {
      finalEl.classList.add('rainbow-print');
    }
  }
  innerHTML = temp.innerHTML;

  const printHTML = `<!doctype html><html lang="ja"><head>
  <meta charset="utf-8"><title>print</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { --scale:${scale}; }
    @page { size: 90mm 205mm; margin: 0; }
    html,body {
      margin:0; padding:0; background:#fff;
      -webkit-print-color-adjust:exact; print-color-adjust:exact;
    }

    #page { width:90mm; max-height:205mm; margin:0 auto; overflow:hidden; }
    .rotate180 #page { margin-bottom:-${trimBottomMM}mm; }

    #result {
      width:calc(90mm/var(--scale));
      min-height:calc(205mm/var(--scale));
      margin:0 auto; padding:0;
      box-sizing:border-box;
      transform:scale(var(--scale));
      transform-origin:top center;
    }
    .rotate180 #result {
      transform:rotate(180deg) scale(var(--scale));
      transform-origin:center center;
    }

.envelope {
  box-sizing: border-box;
  width: calc(84mm / var(--scale)); /* ← 86→84 にして左右3mmずつの余白を確保 */
  max-height: 205mm;
  margin: 0 auto;
  text-align: left;
  font-family: 'ＭＳ 明朝', serif;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: .02em;
  padding: calc(5mm / var(--scale)); /* padding もスケールで割って実効幅を維持 */
}
    .print-date  { text-align:left;  font-size:11pt; margin:4mm 0 0; }
    .print-title { text-align:center;font-size:14pt;margin:2mm 0 8mm;font-weight:700; }
    .receipt-row { display:flex; justify-content:space-between; align-items:baseline; }
    .receipt-row .label{ margin-right:5mm; white-space:nowrap; }
    .receipt-row .value{ font-weight:700; font-size:12pt; text-align:right; }
    .totalAmount{ font-size:18pt !important; font-weight:800; color:#0066cc; margin:3mm 0 2mm; }
    .finalAmount{ font-size:18pt !important; font-weight:900; color:#009944; margin:4mm 0 3mm; }
    .castName   { font-size:16pt !important; font-weight:700; }

      .castName {
    font-size: 18pt !important;
    font-weight: 800 !important;
    margin: 3mm 0 !important;   /* 名前上下の余白復活 */
  }

  .subtotal {
    font-size: 14pt !important;
    font-weight: 700 !important;
    color: #333 !important;
    margin-top: 2mm !important;
    margin-bottom: 2mm !important;
  }

  .totalAmount {
    font-size: 15pt !important;
    font-weight: 800 !important;
    color: #0066cc !important;
    margin-top: 3mm !important;
    margin-bottom: 2mm !important;
  }

  .finalAmount {
    font-size: 18pt !important;
    font-weight: 900 !important;
    color: #009944 !important;
    margin-top: 4mm !important;
    margin-bottom: 3mm !important;
  }

    /* 印刷だけ虹色 */
    @media print {
      @keyframes rainbowText {
        0%   { color: red; }
        20%  { color: orange; }
        40%  { color: yellow; }
        60%  { color: green; }
        80%  { color: blue; }
        100% { color: purple; }
      }

  .rainbow-print {
    background: linear-gradient(90deg, red, orange, yellow, green, blue, indigo, violet);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    font-weight: 900;
  }

#result .congrats.print-only {
  display: none;
  text-align: center;
  font-weight: bold;
  font-size: 14pt;

  /* ↓ ここを追加または調整 */
  margin-bottom: 2px;   /* 最終合計との間隔を小さくする */
}
@media print {
  #result .congrats.print-only {
    display: block;
  }

#result .congrats-box {
  border: 2px solid #000;
  padding: 6px 10px;
  margin: 6px 0;

  /* ここから追加/変更 */
  max-width: calc(100% - 4mm); /* ← 右端クリップ回避の安全幅 */
  margin-left: 2mm;
  margin-right: 2mm;
  /* ここまで */

  text-align: center;
  border-radius: 6px;
  display: block;
  box-sizing: border-box;
}

#result .congrats.print-only {
  font-weight: bold;
  font-size: 14pt;
  margin-bottom: 2px;       /* 最終合計との間隔を調整 */
}
}
       
    }
    
  </style>
  </head><body class="${rotate ? 'rotate180' : ''}">
    <div id="page"><div id="result">${innerHTML}</div></div>
    <script>
      function tryClose(){ try{ window.close(); }catch(e){} }
      window.onload = function(){
        try{ window.focus(); window.print(); }catch(e){}
        window.onafterprint = tryClose;
        window.addEventListener('focus', tryClose, { once:true });
        document.addEventListener('visibilitychange', function(){ if(!document.hidden) tryClose(); });
        setTimeout(tryClose, 2500);
      };
    <\/script>
  </body></html>`;

  try {
  let w = window.open('', 'PRINT_APP2', 'width=480,height=800');
  if (w && w.document) {
    w.document.open(); 
    w.document.write(printHTML); 
    w.document.close();
    return w; // ← return に修正！
  }
} catch(_) {}

try {
  const blob = new Blob([printHTML], {type:'text/html'});
  const url = URL.createObjectURL(blob);
  const w = window.open(url,'_blank');
  return w; // ← こちらもreturn w
} catch(_) {}

}

// HTMLエスケープ（XSS/レイアウト崩れ対策）
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// 履歴の描画
function renderApp2History(){
  const ul = document.getElementById('app2-historyList');
  if(!ul) return;
  ul.innerHTML = app2History.map(e => {
    const when = new Date(e.time||Date.now()).toLocaleString();
  return `<li class="history-item">
            <span class="history-name">${escapeHtml(e.cast||'（名前なし）')}</span>｜${when}
            ｜小計:${e.subtotal?.toLocaleString?.() ?? e.subtotal}
            ｜合計:${e.total?.toLocaleString?.() ?? e.total}
            ｜最終:${e.final?.toLocaleString?.() ?? e.final}
          </li>`;
  }).join('');
}

// 一括入力グリッド：選択→まとめて出力
// 一括入力グリッド：選択→まとめて出力
(function(){
  const QUANT_IDS = ['f','f2','jounai','honshiri','douhan','eda','help','set40','set20','vip','a','b','c','d','e'];
  const WAIT_BETWEEN_PRINT_MS = 500;

  function ensureToolbar(){
    const hasPrintBtn = !!document.getElementById('bulkPrintSelected');
    const hasToggleBtn = !!document.getElementById('bulkToggleChecks');

    if (!hasPrintBtn) console.warn('[bulk] #bulkPrintSelected が見つかりません');
    if (!hasToggleBtn) console.warn('[bulk] #bulkToggleChecks が見つかりません');
  }

  function installCheckboxColumn(){
    // buildGrid() 側でチェック列を生成する方式に変更済み
  }

  function pushBulkRowToNormalForm(mainRow){
    if (!mainRow) return;

    const name = mainRow.querySelector('.bulk-name')?.value ?? '';
    const nameEl = document.getElementById('castName');
    if (nameEl) {
      nameEl.value = name;
      nameEl.dispatchEvent(new Event('input', { bubbles:true }));
    }

    const exp = !!mainRow.querySelector('.bulk-exp')?.checked;
    const expEl = document.getElementById('experienceAndRental');
    if (expEl) {
      expEl.checked = exp;
    }

    const send = mainRow.querySelector('.bulk-send')?.value ?? '';
    const sendEl = document.getElementById('sendoffAmount');
    if (sendEl) {
      sendEl.value = send;
      sendEl.dispatchEvent(new Event('input', { bubbles:true }));
    }

    QUANT_IDS.forEach(id => {
      const dst = document.getElementById(id);
      if (!dst) return;

      if (id === 'f') {
        const src = mainRow.querySelector('[data-k="2k"]');
        dst.checked = !!src?.checked;
        return;
      }

      const src = mainRow.querySelector(`[data-k="${id}"]`);
      if (!src) return;

      const v = (src.value ?? '').toString().trim();
      dst.value = (v === '0') ? '' : v;
    });

    const container = document.getElementById('bottleFormsContainer');
    if (container) {
      container.querySelectorAll('.bottle-form').forEach(el => el.remove());

      let anchor = mainRow.nextElementSibling;
      while (anchor && anchor.classList.contains('btl-subrow')) {
        const detail = (typeof getSelectedDetail === 'function') ? (getSelectedDetail(anchor) || '') : '';
        const split  = anchor.querySelector('.splitCount')?.value ?? '';
        const qty    = anchor.querySelector('.bottleQuantity')?.value ?? '';
        const amt    = anchor.querySelector('.bottleAmount')?.value ?? '';

        const form = document.createElement('div');
        form.className = 'bottle-form';
        form.innerHTML = `
          <div class="left-group">
            <select class="bottleDetails">${window.BOTTLE_OPTIONS_HTML || '<option value=""></option>'}</select>
          </div>
          <input class="splitCount" inputmode="numeric">
          <input class="bottleQuantity" inputmode="numeric">
          <input class="bottleAmount" inputmode="numeric">
        `;
        container.appendChild(form);

        const sel = form.querySelector('.bottleDetails');
        const sEl = form.querySelector('.splitCount');
        const qEl = form.querySelector('.bottleQuantity');
        const aEl = form.querySelector('.bottleAmount');

        if (sel) {
          if (typeof setBottleDetailValue === 'function') {
            setBottleDetailValue(sel, detail);
          } else {
            sel.value = detail;
          }
          sel.dispatchEvent(new Event('change', { bubbles:true }));
        }
        if (sEl) {
          sEl.value = split;
          sEl.dispatchEvent(new Event('input', { bubbles:true }));
        }
        if (qEl) {
          qEl.value = qty;
          qEl.dispatchEvent(new Event('input', { bubbles:true }));
        }
        if (aEl) {
          aEl.value = amt;
          aEl.dispatchEvent(new Event('input', { bubbles:true }));
        }

        anchor = anchor.nextElementSibling;
      }
    }
  }

  async function printSelectedRows() {
    const grid = document.getElementById('bulkGrid');
    if (!grid) return alert('一括入力テーブルが見つかりません。');

    const selected = Array.from(grid.tBodies?.[0]?.querySelectorAll('tr.bulk-mainrow') || [])
      .filter(tr => {
        const on = tr.querySelector('.bulk-check')?.checked;
        return on && !isBulkRowEmpty(tr);
      });

    if (!selected.length) return alert('出力する行をチェックしてください。');

    for (const row of selected) {
      pushBulkRowToNormalForm(row);

      let win = null;
      try {
        if (typeof window.preparePrintApp2 === 'function') {
          win = await window.preparePrintApp2();
        }
      } catch (e) {
        console.error('印刷呼び出しエラー:', e);
      }

      await waitForWindowClose(win);
      await new Promise(r => setTimeout(r, WAIT_BETWEEN_PRINT_MS));
    }
  }

  function waitForWindowClose(win) {
    return new Promise(resolve => {
      if (!win || win.closed) return resolve();

      const timer = setInterval(() => {
        if (win.closed) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  }

  function bindEvents(){
    document.addEventListener('change', e => {
      if (e.target && e.target.id === 'bulkCheckAll') {
        const on = !!e.target.checked;

        document.querySelectorAll('#bulkGrid tr.bulk-mainrow').forEach(tr => {
          const cb = tr.querySelector('.bulk-check');
          if (!cb) return;

          const isLeave = tr.classList.contains('is-leave');
          if (cb.disabled || isLeave) return;

          cb.checked = on;
        });
      }
    });

    document.addEventListener('click', e => {
      if (e.target && e.target.id === 'bulkToggleChecks') {
        document.querySelectorAll('#bulkGrid tr.bulk-mainrow').forEach(tr => {
          const cb = tr.querySelector('.bulk-check');
          if (!cb) return;

          const isLeave = tr.classList.contains('is-leave');
          if (cb.disabled || isLeave) return;

          cb.checked = !cb.checked;
        });
      }
    });

    document.addEventListener('click', e => {
      if (e.target && e.target.id === 'bulkPrintSelected') {
        printSelectedRows();
      }
    });

    const tbody = document.querySelector('#bulkGrid tbody');
    if (tbody) {
      const mo = new MutationObserver(() => installCheckboxColumn());
      mo.observe(tbody, { childList: true, subtree: false });
    }

    document.addEventListener('input', (e) => {
      if (!e.target || !e.target.closest('#bulkGrid')) return;
      const row = e.target.closest('tr.bulk-mainrow') || e.target.closest('tr')?.previousElementSibling;
      if (row && row.classList.contains('bulk-mainrow')) updateRowCheckState(row);
    });

    document.addEventListener('change', (e) => {
      if (!e.target || !e.target.closest('#bulkGrid')) return;
      const row = e.target.closest('tr.bulk-mainrow') || e.target.closest('tr')?.previousElementSibling;
      if (row && row.classList.contains('bulk-mainrow')) updateRowCheckState(row);
    });
  }

  function init(){
    ensureToolbar();
    installCheckboxColumn();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ===== 空行判定：氏名/体験/送迎/数量群/ボトルのどれも入ってなければ空 =====
function isBulkRowEmpty(mainRow){
  if (!mainRow) return true;

  // 氏名・送迎・体験(貸出)チェック
  const name = mainRow.querySelector('.bulk-name')?.value?.trim() || '';
  const send = mainRow.querySelector('.bulk-send')?.value?.trim() || '';
  const exp  = mainRow.querySelector('.bulk-exp')?.checked ? '1' : '';

  // F〜Eなど数量系
  const ids = (window.QUANT_IDS && Array.isArray(window.QUANT_IDS))
    ? window.QUANT_IDS
    : ['f','f2','jounai','honshiri','douhan','eda','help','set40','set20','vip','a','b','c','d','e'];

  // "0" を空扱いする正規化
  const norm = (v) => {
    const s = (v ?? '').toString().trim();
    return (s === '' || s === '0') ? '' : s;
  };

  let anyQuant = false;
  ids.forEach(k => {
    const el = mainRow.querySelector(`[data-k="${k}"]`);
    if (!el) return;

    // ★ f（2k）はチェックボックス
    if (k === 'f') {
      if (el.checked) anyQuant = true;
      return;
    }

    // ★ 数値は 0 を空扱い
    const v = norm(el.value);
    if (v !== '') anyQuant = true;
  });

  // ボトル（直後の .btl-subrow 連鎖に何か入っているか）
  let anchor = mainRow.nextElementSibling;
  let anyBottle = false;
  while (anchor && anchor.classList.contains('btl-subrow')) {
    const d = getSelectedDetail(anchor) || '';
    const s = norm(anchor.querySelector('.splitCount')?.value);
    const q = norm(anchor.querySelector('.bottleQuantity')?.value);
    const a = norm(anchor.querySelector('.bottleAmount')?.value);
    if (d || s || q || a) { anyBottle = true; break; }
    anchor = anchor.nextElementSibling;
  }

  // 送迎も "0" は空扱いにしたい場合は norm(send) にしてOK
  return !(name || send || exp || anyQuant || anyBottle);
}

window.preparePrintApp2 = function (mode = 'envelope') {
  if (typeof window.showApp === 'function') window.showApp('app2');

  // 印刷前に保存内容も最新化
  if (typeof saveBottleForms === 'function') saveBottleForms();

  if (typeof window.calculate === 'function') window.calculate();

  const html = (document.getElementById('result')?.innerHTML || '').trim();
  if (!html) {
    alert('印刷する内容がありません。先に「計算」で結果を出してください。');
    return;
  }

  const hasEnvelope = /class\s*=\s*["'][^"']*envelope/.test(html);
  const inner = (mode === 'envelope' && !hasEnvelope)
    ? `<div class="envelope">${html}</div>`
    : html;

  openPrintApp2(inner, { scale: 1.05, rotateOnMobile: true, trimBottomMM: 20 });
};



/************************************************************
 * 7. 初期化
 ************************************************************/
// initCommon()
// initApp1()
// initApp2()
// initApp3()
// document.addEventListener('DOMContentLoaded', initAll)

// 特定アプリ(app1, app2, app3)をリセット
function resetApp(appId, full = false) {
  if (!confirm(full 
    ? "本当に完全クリアしますか？（履歴・保存データも削除）" 
    : "入力をクリアしますか？"
  )) return;

  if (appId === 'app1') {
    resetApp1(full);
  } else if (appId === 'app2') {          // ← これを追加
    resetApp2(full);
  } else if (appId === 'app3') {
    resetApp3(full);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

}

function resetAllApps() {
  if (!confirm("app1〜app3のデータを全て削除しますか？")) return;

  const overlay = document.getElementById('resetOverlay');
  const canvas  = document.getElementById('matrixCanvas');
  const flash   = document.getElementById('resetFlash');

  if (overlay) overlay.style.display = 'flex';
  setTimeout(() => {
    if (overlay) overlay.classList.add('active');
  }, 20);

  if (typeof startMatrixEffect === 'function' && canvas) {
    startMatrixEffect(canvas);
  }

  setTimeout(() => {
    if (flash) flash.style.opacity = 1;

    setTimeout(() => {
      try { resetApp1(true); } catch (e) { console.error('resetApp1 failed:', e); }
      try { resetApp2(true); } catch (e) { console.error('resetApp2 failed:', e); }
      try { resetApp3(true); } catch (e) { console.error('resetApp3 failed:', e); }

      if (typeof showApp === 'function') {
        showApp('app1');
      } else {
        document.body.setAttribute("data-active-app", "app1");
        document.querySelectorAll(".content").forEach(el => el.classList.remove("active"));
        document.getElementById("app1")?.classList.add("active");
        document.querySelectorAll(".tabs .tab").forEach(tab => tab.classList.remove("active"));
        document.querySelector('.tabs .tab[data-target="app1"]')?.classList.add("active");
      }

      window.scrollTo({ top: 0, behavior: 'auto' });

      try { localStorage.removeItem('appScrollMap'); } catch (e) {}
      if (window.clearTabScrollMemory) window.clearTabScrollMemory();

      const wrapper = document.getElementById("contentWrapper");
      if (wrapper) wrapper.scrollTop = 0;

      setTimeout(() => {
        if (flash) flash.style.opacity = 0;
        if (typeof stopMatrixEffect === 'function') stopMatrixEffect();
        if (overlay) {
          overlay.classList.remove('active');
          overlay.style.display = 'none';
        }
      }, 520);
    }, 400);
  }, 1600);
}

// =========================
// app1用リセット（安全版）
// =========================
function resetApp1(full) {
  const formRows = document.getElementById("formRows");
  if (!formRows) return;

  // 1行だけ残す
  while (formRows.rows.length > 1) {
    formRows.deleteRow(1);
  }

  // 先頭行だけ初期化
  const firstRow = formRows.querySelector("tr.row");
  if (firstRow) {
    firstRow.querySelectorAll("input").forEach(el => {
      el.value = "";
    });

    firstRow.querySelectorAll("select").forEach(el => {
      el.value = "";
    });

    const rowNo = firstRow.querySelector(".rowNumber");
    if (rowNo) rowNo.textContent = "1";

    firstRow.className = "row";
  }

  // APP1内のカテゴリ表チェックだけを外す
  document.querySelectorAll("#categorySection input[type='checkbox']").forEach(cb => {
    cb.checked = false;
  });

  // 安全に値を入れるヘルパ
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const totalCountCell = document.getElementById("totalCountCell");
  if (totalCountCell) {
    totalCountCell.innerHTML =
      '<button type="button" class="print-mini" onclick="printEnvelopeApp1(\'ALL\')">出力</button>' +
      '<span id="totalCountValue" class="count-value">0</span>';
  }

  // 合計リセット
  setText("totalCustomers", "0");
  setText("cashTotal", "0");
  setText("cardTotal", "0");
  setText("totalAmount", "0");
  setText("totalBackAmount", "0");

  // カテゴリ別リセット
  const categories = ["UK", "K", "AB", "LA", "PA", "BB", "MS", "GM", "B", "JOE", "KOSE", "HE", "PB", "X", "Z"];
  categories.forEach(cat => {
    setText(`${cat}count`, "0");
    setText(`${cat}total`, "0");
  });

  // 行番号管理
  rowNumber = 2;

  // 再描画
  if (typeof updateRowGrayOut === "function") {
    updateRowGrayOut();
  }
  if (typeof updateTotals === "function") {
    updateTotals();
  }

  // 保存削除
  if (full) {
    try { localStorage.removeItem("formData"); } catch (e) {}
    try { localStorage.removeItem("checkboxStates"); } catch (e) {}
  }
}

// app2用リセット
function resetApp2(full) {
  // === 通常フォームのクリア =========================================
  document.querySelectorAll('#app2 input[type="text"], #app2 input[type="number"]').forEach(el => el.value = '');
  const exp = document.getElementById('experienceAndRental');
  if (exp) exp.checked = false;
  const result = document.getElementById('result');
  if (result) result.innerHTML = '';
  const bottleForms = document.getElementById('bottleFormsContainer');
  if (bottleForms) bottleForms.innerHTML = '';

  // === 一括入力フォームのクリア（内包） ===============================
  (function clearBulkInputForm() {
    const grid = document.getElementById('bulkGrid');
    if (!grid) return;

    grid.querySelectorAll('.bulk-name, .bulk-send, .bulk-num').forEach(el => el.value = '');
    grid.querySelectorAll('.bulk-exp').forEach(el => (el.checked = false));
    grid.querySelectorAll('.btl-subrow').forEach(tr => tr.remove());
    grid.querySelectorAll('tr.bulk-mainrow').forEach(row => {
      row.dataset.bottleCount = '0';
      const minusBtn = row.querySelector('.btl-minus');
      if (minusBtn) minusBtn.setAttribute('disabled', 'true');
    });
  })();

  // === 完全クリア時（履歴/保存データも削除） =========================
  if (full) {
    const historyList = document.getElementById('historyList');
    if (historyList) historyList.innerHTML = '';

    // 通常フォーム関連ローカルデータ削除
    localStorage.removeItem('inputs');
    localStorage.removeItem('historyList');
    localStorage.removeItem('result');
    localStorage.removeItem('bottleForms');

    // ✅ 一括入力グリッド関連も削除
    localStorage.removeItem('app2_bulkGridData');
    localStorage.removeItem('app2_bulkPanelVisible');

    // グリッド本体もクリア
    const grid = document.getElementById('bulkGrid');
    if (grid) grid.querySelector('tbody')?.replaceChildren();

    if (typeof updateSummary === 'function') updateSummary();

    const countEl = document.getElementById('historyIndexCount');
    if (countEl) countEl.textContent = '0人';
    if (typeof window.createHistoryIndex === 'function') window.createHistoryIndex();
  }
}

// app3用リセット
function resetApp3(full) {
  document.querySelectorAll('#app3 input').forEach(el => {
    if (el.type !== 'button') el.value = '';
  });
  updateCalculations();

  if (full) {
    localStorage.removeItem('app3_inputs');
    localStorage.removeItem('app3_result');

    // ✅ 一括入力グリッド関連も完全に消去
    localStorage.removeItem('app2_bulkGridData');
    localStorage.removeItem('app2_bulkPanelVisible');

    // グリッド本体も空にする
    const grid = document.getElementById('bulkGrid');
    if (grid) grid.querySelector('tbody')?.replaceChildren();
  }

  attachCommaFormatApp1and3();
}

function clearApp2Inputs() {
  resetApp2(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


// 初期化ヘルパ
function initUpdateRowGrayOut() {
  updateRowGrayOut();
}

function initExperienceAndRentalConfirm() {
  const exp = document.getElementById('experienceAndRental');
  if (!exp) return;

  exp.addEventListener('change', function (e) {
    // プログラムからの変更は無視
    if (!e.isTrusted) return;

    if (this.checked) {
      const confirmed = confirm('「体験及び貸出」にチェックが入りました。');
      if (!confirmed) this.checked = false;
    }
  });
}

function initCategorySectionTable() {
  const table = document.querySelector('#categorySection table');
  if (!table) return;

  // ヘッダを差し替え
  const thRow = table.querySelector('thead tr');
  if (thRow) {
    thRow.innerHTML = '<th></th><th>カテゴリ</th><th>本数</th><th>金額</th>';
  }

  // 各行を4列化
  table.querySelectorAll('tbody tr').forEach(tr => {
    if (tr.children.length >= 4) return;

    const firstTd = tr.children[0];
    if (!firstTd) return;

    const isTotal = /合計/.test(firstTd.textContent);

    if (isTotal) {
      const blank = document.createElement('td');
      tr.insertBefore(blank, firstTd);

      const catTd = document.createElement('td');
      catTd.innerHTML = firstTd.innerHTML;
      tr.replaceChild(catTd, firstTd);
      return;
    }

    const cb = firstTd.querySelector('input[type="checkbox"]');
    const nameText = firstTd.textContent.replace(/\s+/g, ' ').trim();

    firstTd.innerHTML = '';
    if (cb) firstTd.appendChild(cb);

    const catTd = document.createElement('td');
    catTd.textContent = nameText;
    tr.insertBefore(catTd, tr.children[1]);
  });
}

function initSideCalcButton() {
  document.getElementById('side-calc')?.addEventListener('click', () => {
    confirmAndCalculate(new Event('submit'));
  });
}

function initHistoryIndexObserver() {
  const historySection = document.getElementById('app2-historySection');

  if (!historySection) {
    try {
      if (typeof createHistoryIndex === 'function') {
        createHistoryIndex();
      }
    } catch (e) {
      console.error('[initHistoryIndexObserver] initial createHistoryIndex failed:', e);
    }
    return;
  }

  const mo = new MutationObserver(() => {
    try {
      if (typeof createHistoryIndex === 'function') {
        createHistoryIndex();
      }
    } catch (e) {
      console.error('[initHistoryIndexObserver] observer createHistoryIndex failed:', e);
    }
  });

  mo.observe(historySection, { childList: true, subtree: true });

  try {
    if (typeof createHistoryIndex === 'function') {
      createHistoryIndex();
    }
  } catch (e) {
    console.error('[initHistoryIndexObserver] first createHistoryIndex failed:', e);
  }
}

function initOutputButtonsObserver() {
  try {
    if (typeof addOutputButtonsNextToRestore === 'function') {
      addOutputButtonsNextToRestore();
    }
  } catch (e) {
    console.error('[initOutputButtonsObserver] initial add failed:', e);
  }

  const his = document.getElementById('app2-historySection');
  if (!his) return;

  const mo = new MutationObserver(() => {
    try {
      if (typeof addOutputButtonsNextToRestore === 'function') {
        addOutputButtonsNextToRestore();
      }
    } catch (e) {
      console.error('[initOutputButtonsObserver] observer add failed:', e);
    }
  });

  mo.observe(his, { childList: true, subtree: true });
}

function initBulkRowsChangeHandler() {
  const sel = document.getElementById('bulkRows');
  if (!sel) return;

  if (sel._bulkRowsChangeBound) return;
  sel._bulkRowsChangeBound = true;

  sel.addEventListener('change', () => {
    const nextN = parseInt(sel.value || '40', 10) || 40;

    // 行数変更前だけは即保存
    saveBulkGridState();

    if (typeof restoreBulkGridState === 'function') {
      restoreBulkGridState(nextN);
    } else if (typeof buildGrid === 'function') {
      buildGrid(nextN);
    }

    const grid = document.getElementById('bulkGrid');
    if (typeof updateBulkFilledState === 'function') {
      updateBulkFilledState(grid);
    }

    if (typeof window.applyReadonlyToBulkGridCustomKeypad === 'function') {
      window.applyReadonlyToBulkGridCustomKeypad();
    }
  });
}

function initBottleCustomOptions() {
  hydrateAllBottleSelectsWithCustomOptions();
}

function initExportExcelButton() {
  const btn = document.getElementById('exportExcelApp3');
  if (btn) {
    btn.addEventListener('click', exportApp3MonthlyWrite_xpop);
  }
}

function initBulkCustomKeypad() {
  installBulkCustomKeypad();
}

function initArrowNavigationApp1() {
  enableArrowNavigationApp1();
}

function initWorkStartDate() {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  if (!localStorage.getItem("workStartDate")) {
    localStorage.setItem("workStartDate", todayStr);
  }
}

function initSlimHistoryUI() {
  setTimeout(slimHistoryUI, 0);
}

function initRestoreAllApps() {
  try {
    // 通常フォーム系の復元
    if (typeof restoreState === 'function') {
      restoreState();
    }

    // 履歴ベースの候補やインデックスは作る
    if (typeof refreshBottleDropdownsFromHistory === 'function') {
      refreshBottleDropdownsFromHistory();
    }

    if (typeof createHistoryIndex === 'function') {
      createHistoryIndex();
    }

    if (typeof window.scheduleApp3Update === 'function') {
      window.scheduleApp3Update('initRestoreAllApps');
    }
  } catch (e) {
    console.error('[initRestoreAllApps] restore failed:', e);
  }
}

//DOMContentLoaded 統合初期化
document.addEventListener('DOMContentLoaded', () => {
  updateBulkFilledState(document);

  initUpdateRowGrayOut();
  initExperienceAndRentalConfirm();
  initRestoreAllApps();
  initCategorySectionTable();
  initSideCalcButton();
  initHistoryIndexObserver();
  initOutputButtonsObserver();
  initBulkRowsChangeHandler();
  initBottleCustomOptions();
  initExportExcelButton();
  initBulkCustomKeypad();
  initArrowNavigationApp1();
  initWorkStartDate();
  initSlimHistoryUI();
  observeTotalCountForAdviserFee();
});


/************************************************************
 * 7. 演出専用レイヤー
 ************************************************************/

// --- マトリックス風エフェクト ---
let matrixInterval, matrixStopFlag = false;

function startMatrixEffect(canvas) {
  const ctx = canvas.getContext('2d');
  let W = window.innerWidth;
  let H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
  let fontSize = 18;  // 少し小さく密度を増やす
  let columns = Math.floor(W / fontSize) + 2;
  let drops = [];
  for (let i = 0; i < columns; i++) drops[i] = Math.random() * H / fontSize;

  // 文字セット（カタカナ・ひらがな・英数大文字・英数小文字・数字）
  const chars = [
    ..."アイウエオカキクケコサシスセソタチツテトナニヌネノマミムメモヤユヨラリルレロワヲン",
    ..."あいうえおかきくけこさしすせそたちつてとなにぬねのまみむめもやゆよらりるれろわをん",
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  ];

  matrixStopFlag = false;

  function draw() {
    ctx.fillStyle = 'rgba(25,30,44,0.23)';
    ctx.fillRect(0, 0, W, H);

    ctx.font = fontSize + "px monospace";
    ctx.fillStyle = "#47f7ff";
    // 列ごとに複数行ドロップして密度UP
    for (let i = 0; i < columns; i++) {
      for (let d = 0; d < 2; d++) { // 1列あたり2個
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, (drops[i] - d) * fontSize);
      }
      if (Math.random() > 0.975) drops[i] = 0;
      drops[i] += Math.random() * 1.3 + 0.7; // 速さランダム
    }
    if (!matrixStopFlag) matrixInterval = requestAnimationFrame(draw);
  }

  draw();
}

function stopMatrixEffect() {
  matrixStopFlag = true;
  if (matrixInterval) cancelAnimationFrame(matrixInterval);
  const canvas = document.getElementById('matrixCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/* ============================================================
   110万 Over ぷちゅん演出（target未定義対策・完全版）
   - #totalAmount が出現するまで待機してから初期化
   - 変数はローカルに閉じ込め、グローバル汚染を防止
   ============================================================ */

window.CONGRATS_SFX_URL = './seven-flash.m4a?v=2';

(function(){
  const THRESHOLD = 1100000,
        TARGET_SEL = '#totalAmount',
        IDLE_MS = 400,
        AUTO_CLOSE_MS = 4200;

  /* ========= 設定（音源URL） ========= */
  const SFX_URLS = [
    window.CONGRATS_SFX_URL      || './seven-flash.m4a',
    window.CONGRATS_SFX_FALLBACK || ''
  ].filter(Boolean);

  /* ========= オーディオ（WebAudio優先 / HTMLAudioフォールバック） ========= */
  let interacted = false;
  let audioCtx = null;     // WebAudio
  let audioBuf = null;     // デコード済みバッファ
  let htmlAudio = null;    // フォールバック

  // 初回ユーザー操作で解錠 & WebAudio 準備
  const userGestureGate = (() => {
    let resolveOnce;
    const p = new Promise(r => (resolveOnce = r));

    const unlock = async () => {
      interacted = true;
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);

      try {
        // WebAudio context
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        // 事前デコード（先頭のURLで試行→失敗なら次）
        for (const u of SFX_URLS) {
          try {
            const res = await fetch(cacheBust(u));
            const buf = await res.arrayBuffer();
            audioBuf = await audioCtx.decodeAudioData(buf);
            console.info('[SFX] WebAudio decoded:', u);
            break;
          } catch (e) { /* 次の候補へ */ }
        }
      } catch (e) {
        console.warn('[SFX] WebAudio init failed, fallback to <audio>', e?.message);
      }

      // 失敗していたら <audio> 準備
      if (!audioBuf) {
        htmlAudio = await prepareHtmlAudio(SFX_URLS);
      }
      resolveOnce();
    };

    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown',    unlock, true);
    window.addEventListener('touchstart', unlock, true);
    return () => p;
  })();

  const cacheBust = (u) => u + (u.includes('?') ? '&' : '?') + 'v=' + Date.now();

  async function prepareHtmlAudio(urls) {
    for (const u of urls) {
      try {
        const el = new Audio();
        el.preload = 'auto';
        el.src = u;
        await onceCanPlay(el, 3500);
        el.id = 'congratsSfx';
        el.style.display = 'none';
        document.body.appendChild(el);
        console.info('[SFX] HTMLAudio ready:', u);
        return el;
      } catch { /* 次の候補 */ }
    }
    console.warn('[SFX] no playable HTMLAudio source');
    return null;
  }

  function onceCanPlay(el, timeout=3500){
    return new Promise((res, rej) => {
      const ok = () => { cleanup(); res(); };
      const ng = () => { cleanup(); rej(new Error('load-failed')); };
      const to = setTimeout(ng, timeout);
      const cleanup = () => {
        clearTimeout(to);
        el.removeEventListener('canplaythrough', ok);
        el.removeEventListener('canplay', ok);
        el.removeEventListener('error', ng);
      };
      el.addEventListener('canplaythrough', ok, {once:true});
      el.addEventListener('canplay', ok, {once:true});
      el.addEventListener('error', ng, {once:true});
      try { el.load(); } catch {}
    });
  }

  // ★ T0で発音：overlayを見せる直前に呼ぶ
  async function playSfxNow(){
    // ユーザー操作待ち（ロック解除）
    await userGestureGate();

    try {
      if (audioBuf && audioCtx) {
        const src = audioCtx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(audioCtx.destination);
        src.start(0); // ← ゼロ起動
        return;
      }
      if (htmlAudio) {
        htmlAudio.currentTime = 0;
        await htmlAudio.play();
        return;
      }
      // どちらも準備できてない場合の最後のあがき
      htmlAudio = await prepareHtmlAudio(SFX_URLS);
      await htmlAudio?.play();
    } catch (e) {
      console.warn('[SFX] play failed:', e?.message);
    }
  }

  /* ========= スタイル（CRT消灯→滲み上がり） ========= */
  (function ensureStyle(){
    if (document.getElementById('crtCongratsStyle')) return;
    const st = document.createElement('style'); st.id='crtCongratsStyle';
    st.textContent = `
#crtCongratsOverlay{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;flex-direction:column;background:#000;color:#fff;text-align:center;font-family:'Orbitron',system-ui,ui-sans-serif,sans-serif;}
#crtCongratsOverlay.show{display:flex;}
#crtCongratsOverlay .crt-line{position:absolute;left:0;right:0;top:50%;height:2px;background:#fff;box-shadow:0 0 20px #fff,0 0 40px rgba(255,255,255,.6);transform-origin:center center;animation:tubeOff .9s ease-in forwards;}
@keyframes tubeOff{0%{transform:scaleY(1) scaleX(1);opacity:1}60%{transform:scaleY(.06) scaleX(1);opacity:1}100%{transform:scaleY(.06) scaleX(0);opacity:0}}
#crtCongratsOverlay .msg{position:relative;z-index:2;opacity:0;filter:blur(12px);transform:translateY(8px);animation:msgGlowIn .9s cubic-bezier(.2,.65,.2,1) .95s forwards;}
#crtCongratsOverlay .msg .title{font-size:clamp(28px,6vw,56px);letter-spacing:.06em;margin-bottom:.25em;color:#bfffe9;text-shadow:0 0 18px rgba(0,245,255,.35),0 0 36px rgba(0,245,255,.2);}
#crtCongratsOverlay .msg .sub{font-size:clamp(16px,3.5vw,28px);letter-spacing:.04em;color:#eaffff;text-shadow:0 0 12px rgba(0,245,255,.25),0 0 26px rgba(0,245,255,.18);}
@keyframes msgGlowIn{0%{opacity:0;filter:blur(12px);transform:translateY(8px)}60%{opacity:1;filter:blur(5px);transform:translateY(2px)}100%{opacity:1;filter:blur(0);transform:translateY(0)}}
#crtCongratsOverlay.hide{animation:ovFade .3s ease-out forwards;}
@keyframes ovFade{to{opacity:0}}
`;
    document.head.appendChild(st);
  })();

  function ensureOverlay(){
    let ov = document.getElementById('crtCongratsOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'crtCongratsOverlay';
    ov.innerHTML = `
      <div class="crt-line"></div>
      <div class="msg"><div class="title">Congratulations</div><div class="sub">1,100,000 yen Over</div></div>`;
    ov.addEventListener('click', ()=>{ ov.classList.add('hide'); setTimeout(()=>ov.remove(),320); });
    document.body.appendChild(ov);
    return ov;
  }

  // ★ 音→overlay表示（同時スタート）
  async function showOverlayT0(){
    const ov = ensureOverlay();
    // 1) 先に音を鳴らす（ゼロ起動）
    playSfxNow();
    // 2) 見せる（CSSアニメ発火）
    ov.classList.remove('hide');
    ov.classList.add('show');
    // 3) 自動クローズ
    setTimeout(()=>{ if(!ov.isConnected) return; ov.classList.add('hide'); setTimeout(()=>ov.remove(),320); }, AUTO_CLOSE_MS);
  }

  /* ========= #totalAmount 監視（超えた“瞬間”＋入力アイドル待ち） ========= */
  const parseAmount = (txt) => {
    const n = parseInt((txt||'').toString().replace(/[^\d\-]/g,''),10);
    return Number.isNaN(n) ? 0 : n;
  };

  function initWith(amtEl){
    let fired=false, lastVal=parseAmount(amtEl.textContent), timer=null;

    const isEditing = () => {
      const ae = document.activeElement;
      return ae && (/^(INPUT|TEXTAREA|SELECT)$/i.test(ae.tagName) || ae.isContentEditable);
    };

    const reset = () => { if(timer){ clearTimeout(timer); timer=setTimeout(tryFire, IDLE_MS); } };
    function tryFire(){
      if (isEditing()){ timer = setTimeout(tryFire, 200); return; }
      document.removeEventListener('input',  reset, true);
      document.removeEventListener('keydown', reset, true);
      fired = true;
      showOverlayT0();   // ← ここで音とアニメ同時
    }
    function schedule(){
      if (fired) return;
      if (timer) clearTimeout(timer);
      document.addEventListener('input',  reset, true);
      document.addEventListener('keydown', reset, true);
      timer = setTimeout(tryFire, IDLE_MS);
    }

    const mo = new MutationObserver(() => {
      const v = parseAmount(amtEl.textContent);
      if (!fired && v > THRESHOLD && lastVal <= THRESHOLD) schedule();
      lastVal = v;
    });
    mo.observe(amtEl, {childList:true, characterData:true, subtree:true});

    if (lastVal > THRESHOLD) setTimeout(schedule, 200);
  }

  function waitForAmountEl(){
    const el = document.querySelector(TARGET_SEL);
    if (el){ initWith(el); return; }
    const mo = new MutationObserver(()=>{
      const x = document.querySelector(TARGET_SEL);
      if (x){ mo.disconnect(); initWith(x); }
    });
    mo.observe(document.documentElement||document.body, {childList:true, subtree:true});
    setTimeout(()=>mo.disconnect(), 10000);
  }

  // 起動
  waitForAmountEl();

  // デバッグ：手動同時発火（コンソールで）
  window.__congratsTest = () => showOverlayT0();
})();



