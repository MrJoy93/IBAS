/***  Firebase v10 ESM（CDN） ***/
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, enableIndexedDbPersistence,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let isApplyingRemote = false;

/*** ←ここをコンソールの値で置き換え ***/
const firebaseConfig = {
  apiKey: "AIzaSyAvTWoZRREx4ywOsXjNLJs3Bb06Ul_K8EE",
  authDomain: "ibasdbeta.firebaseapp.com",
  projectId: "ibasdbeta",
  storageBucket: "ibasdbeta.firebasestorage.app",
  messagingSenderId: "317393843615",
  appId: "1:317393843615:web:a88b926baf5b1f283c39aa",
  measurementId: "G-TBDKMD0WQ0"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
enableIndexedDbPersistence(db).catch((err) => {
  console.warn("[Firebase] IndexedDB persistence failed:", err?.code, err);
});

/*** Firestore パス設計 ***/
const COLLECTION = "IBAS";
const CLIENT_ID = (() => {
  const k="ibas-client-id";
  return localStorage.getItem(k) || (localStorage.setItem(k,crypto.randomUUID()), localStorage.getItem(k));
})();

const monthKey = (d=new Date()) => d.toISOString().slice(0,7);
const docRefFor = (key = monthKey()) => doc(db, COLLECTION, key);

/*** 画面右上のオートセーブ表示 ***/
function ensureIndicator(){
  if(document.getElementById("syncIndicator")) return;
  const el = document.createElement("div");
  el.id = "syncIndicator";
  el.style.cssText = `
    position:fixed; top:8px; right:10px; z-index:3000;
    background:rgba(0,34,43,.95); color:#00f5ff; border:1px solid #00f5ff55;
    padding:6px 10px; border-radius:8px; font:14px/1.2 system-ui, sans-serif;
    box-shadow:0 2px 10px rgba(0,245,255,.2); display:none;`;
  el.textContent = "保存中…";
  document.body.appendChild(el);
}
function _showSaving(){ ensureIndicator(); const el=document.getElementById("syncIndicator"); el.style.display="block"; el.textContent="保存中…"; }
function _saved(){ const el=document.getElementById("syncIndicator"); if(!el) return; el.textContent="保存済み"; setTimeout(()=>{el.style.display="none"}, 900); }

/*** ==== 読み込み・保存・購読 ==== ***/
async function loadAllApps(key = monthKey()){
  const snap = await getDoc(docRefFor(key));
  const data = snap.exists() ? snap.data() : {};

  if (typeof window.applyApp1State === "function") {
    window.applyApp1State(data.app1);
  }
  if (typeof window.applyApp2State === "function") {
    window.applyApp2State(data.app2);
  }
  if (typeof window.applyApp3State === "function") {
    window.applyApp3State(data.app3);
  }
}

async function saveAllApps(key = monthKey()){
  _showSaving();

  try {
    const payload = {
      app1: (typeof window.collectApp1State === "function") ? window.collectApp1State() : {},
      app2: (typeof window.collectApp2State === "function") ? window.collectApp2State() : {},
      app3: (typeof window.collectApp3State === "function") ? window.collectApp3State() : {},
      updatedAt: serverTimestamp(),
      lastAuthor: CLIENT_ID
    };

    await setDoc(docRefFor(key), payload, { merge:true });
    _saved();
  } catch (err) {
    console.error("[Firebase saveAllApps] 保存失敗:", err);

    ensureIndicator();
    const el = document.getElementById("syncIndicator");
    if (el) {
      el.style.display = "block";
      el.textContent = "保存失敗";
      setTimeout(() => {
        el.style.display = "none";
      }, 2000);
    }
  }
}



/* 他端末からの更新を受け取り反映（自端末の直後の書き込みはスキップ） */
function subscribeRemote(key = monthKey()) {
  return onSnapshot(docRefFor(key), async snap => {
    if (!snap.exists()) return;

    const data = snap.data();
    if (data?.lastAuthor === CLIENT_ID) return;

    isApplyingRemote = true;

    try {
      if (typeof window.applyApp1State === "function") {
        await window.applyApp1State(data.app1 || {});
      }

      if (typeof window.applyApp2State === "function") {
        await window.applyApp2State(data.app2 || {});
      }

      if (typeof window.applyApp3State === "function") {
        await window.applyApp3State(data.app3 || {});
      }
    } finally {
      requestAnimationFrame(() => {
        isApplyingRemote = false;
      });
    }
  });
}

/*** ==== オートセーブ（デバウンス） ==== ***/
let _saveTimer = null;
function scheduleAutosave(){
  if (isApplyingRemote) return;
  if (window._isApplyingBulkGridSync) return;

  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveAllApps(monthKey()), 800);
}

// ===== 同期ヘルパ =====
function saveNow(reason=""){ 
  try{ console.debug("[SYNC] now:", reason); }catch(_){}
  return saveAllApps(monthKey());
}

// 関数をラップして「実行後」に同期するユーティリティ
function wrapAndSync(name, {immediate=false} = {}){
  const fn = window[name];
  if(typeof fn !== "function") return;
  window[name] = async function(...args){
    const ret = fn.apply(this, args);
    try { if (ret && typeof ret.then === "function") await ret; } catch(e){}
    if (immediate) { await saveNow(name); } else { scheduleAutosave(); }
    return ret;
  };
}

// 各APPのクリア系関数（存在するものだけ動く）
["clearApp1","clearApp2","clearApp3","resetAllApps","clearAll"].forEach(n=>{
  wrapAndSync(n, { immediate:true });
});

// APP2 計算実行（フォーム onsubmit から呼ばれる想定）
wrapAndSync("confirmAndCalculate", { immediate:true });

// APP1 伝票フィルタ
wrapAndSync("filterCategory",      { immediate:false });
wrapAndSync("filterCashOnlyRows",  { immediate:false });
wrapAndSync("filterCardInputRows", { immediate:false });
wrapAndSync("resetSearch",         { immediate:false });

(function observeApp2History(){
  const historySection = document.getElementById("app2-historySection");
  if (!historySection) return;

  let debounceTimer = null;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    // 100ms デバウンスで両方の処理を安全に呼ぶ
    debounceTimer = setTimeout(() => {
      scheduleAutosave();
      createHistoryIndex();
    }, 100);
  });

  observer.observe(historySection, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();

function attachAutosave() {
  ['input', 'change'].forEach(evt => {
    document.body.addEventListener(evt, (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (!t.closest('#app1, #app2, #app3')) return;

      if (isApplyingRemote) return;
      if (window._isApplyingBulkGridSync) return;

      scheduleAutosave();
    }, { capture: true });
  });
}

/*** ==== ユーティリティ（エラーで出ていた clearAllRemote も定義） ==== ***/
async function clearAllRemote(key = monthKey()){
  await setDoc(docRefFor(key), {
    app1: {}, app2: {}, app3: {},
    updatedAt: serverTimestamp(),
    lastAuthor: CLIENT_ID
  }, { merge:true });
}
window.clearAllRemote = clearAllRemote;
window.saveAllApps   = saveAllApps;   // 手動保存したい時用
window.loadAllApps   = loadAllApps;   // 手動読込したい時用

/*** ==== 起動 ==== ***/
window.addEventListener('DOMContentLoaded', async ()=>{
  ensureIndicator();
  await loadAllApps(monthKey());  // ①ページを開いたら即読み込み
  attachAutosave();               // ②入力のたびに自動保存（800msデバウンス）
  subscribeRemote(monthKey());    // ③他端末の更新を即時反映
});

// Firebase へ履歴を保存（saveRemote があればそれを使う）
async function persistApp2History(){
  // ① 既存の saveRemote(appId, stateObj) がある場合
  if (typeof saveRemote === 'function'){
    await saveRemote('app2', { history: app2History });
    return;
  }
  // ② ない場合のフォールバック（useFirebase を使う前提）
  if (typeof useFirebase === 'function'){
    const fb = await useFirebase();
    if(!fb) return;
    const { db, doc, setDoc, serverTimestamp } = fb;
    await setDoc(
      doc(db, 'apps', 'app2'),              // ← コレクション/ドキュメントは環境に合わせて
      { history: app2History, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }
}

// リアルタイム購読（他端末の更新を即反映）
async function startApp2Realtime(){
  if (typeof useFirebase !== 'function') return;
  const fb = await useFirebase();
  if(!fb) return;
  const { db, doc, onSnapshot } = fb;
  const ref = doc(db, 'apps', 'app2');      // ← 保存先に合わせて同じ参照にする
  onSnapshot(ref, (snap) => {
    const data = snap.data();
    if (!data || !Array.isArray(data.history)) return;
    // 自分の直後保存で重複しにくいよう簡単な等価チェック
    const jsonLocal  = JSON.stringify(app2History);
    const jsonRemote = JSON.stringify(data.history);
    if (jsonLocal !== jsonRemote){
      app2History = data.history;
      renderApp2History();
    }
  });
}

// 初期ロード（ページ表示時に一度だけ取り込み）
async function loadApp2HistoryOnce(){
  if (typeof useFirebase !== 'function') return renderApp2History();
  const fb = await useFirebase();
  if(!fb) return renderApp2History();
  const { db, doc, getDoc } = fb;
  const ref = doc(db, 'apps', 'app2');      // ← 保存先に合わせる
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : null;
  app2History = Array.isArray(data?.history) ? data.history : [];
  renderApp2History();
}

document.addEventListener('DOMContentLoaded', () => {
  loadApp2HistoryOnce();  // 一度だけ読み込む
  startApp2Realtime();    // 以後はリアルタイム反映
});