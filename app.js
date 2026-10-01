import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, collection, query, orderBy, limit, getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";

const BIRTH = { y: 1976, m: 11, d: 30 };
const TZ = "Asia/Seoul";
const config = window.BODY_DIARY_FIREBASE_CONFIG || {};
const isConfigured = config.apiKey && !config.apiKey.startsWith("PUT_");

const $ = (id) => document.getElementById(id);
const els = {
  todayText: $("todayText"), ageText: $("ageText"), condition: $("condition"),
  conditionOutput: $("conditionOutput"), sleep: $("sleep"), pain: $("pain"),
  digestion: $("digestion"), movement: $("movement"), food: $("food"),
  mood: $("mood"), bodyNote: $("bodyNote"), photoInput: $("photoInput"),
  photoPreview: $("photoPreview"), saveBtn: $("saveBtn"), clearBtn: $("clearBtn"),
  pdfBtn: $("pdfBtn"), loginLayer: $("loginLayer"), setupLayer: $("setupLayer"),
  loginForm: $("loginForm"), email: $("email"), password: $("password"),
  loginMessage: $("loginMessage"), logoutBtn: $("logoutBtn"), saveState: $("saveState"),
  recentEntries: $("recentEntries"), archiveDate: $("archiveDate"), loadDateBtn: $("loadDateBtn")
};

let auth, db, storage, currentUser = null;
let pendingFiles = [];
let existingPhotos = [];
let selectedDateKey = "";

function seoulYMD(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { y: +map.year, m: +map.month, d: +map.day };
}

function ymdKey(v) {
  return `${v.y}-${String(v.m).padStart(2,"0")}-${String(v.d).padStart(2,"0")}`;
}

function toUTCDate(v) {
  return new Date(Date.UTC(v.y, v.m - 1, v.d));
}

function clampDay(y, m, d) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.min(d, last);
}

function addYears(v, years) {
  const y = v.y + years;
  return { y, m: v.m, d: clampDay(y, v.m, v.d) };
}

function addMonths(v, months) {
  const base = v.m - 1 + months;
  const y = v.y + Math.floor(base / 12);
  const m = ((base % 12) + 12) % 12 + 1;
  return { y, m, d: clampDay(y, m, v.d) };
}

function compareYMD(a, b) {
  return toUTCDate(a) - toUTCDate(b);
}

function diffDays(a, b) {
  return Math.floor((toUTCDate(b) - toUTCDate(a)) / 86400000);
}

// 생년월일에서 오늘까지를 "년 + 개월 + 일" 달력 기준으로 계산.
// 단순 365일 나눗셈이 아니므로 윤년과 월 길이를 반영합니다.
function calendarAge(birth, today) {
  let years = today.y - birth.y;
  let yearAnchor = addYears(birth, years);
  if (compareYMD(yearAnchor, today) > 0) {
    years -= 1;
    yearAnchor = addYears(birth, years);
  }

  let months = 0;
  for (let i = 1; i <= 11; i++) {
    const candidate = addMonths(yearAnchor, i);
    if (compareYMD(candidate, today) <= 0) months = i;
    else break;
  }

  const monthAnchor = addMonths(yearAnchor, months);
  const days = diffDays(monthAnchor, today);
  return { years, months, days };
}

function koreanDate(v) {
  const dt = new Date(Date.UTC(v.y, v.m - 1, v.d, 12));
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "UTC", year: "numeric", month: "long", day: "numeric", weekday: "long"
  }).format(dt);
}

function updateHeader(target = seoulYMD()) {
  const age = calendarAge(BIRTH, target);
  els.todayText.textContent = koreanDate(target);
  els.ageText.textContent = `${age.years}년 ${age.months}개월 ${age.days}일째`;
  selectedDateKey = ymdKey(target);
  els.archiveDate.value = selectedDateKey;
}

function conditionLabel(v) {
  return ({1:"매우 힘듦",2:"조금 힘듦",3:"보통",4:"좋음",5:"아주 좋음"})[v] || "";
}

function setSaveState(text, ok=false) {
  els.saveState.textContent = text;
  els.saveState.style.color = ok ? "#4f5c4b" : "";
}

function sanitizeText(v, max=5000) {
  return String(v || "").trim().slice(0, max);
}

function renderPhotos() {
  els.photoPreview.innerHTML = "";

  existingPhotos.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = "photo-item";
    const img = document.createElement("img");
    img.src = p.url;
    img.alt = "몸의 일기 사진";
    const btn = document.createElement("button");
    btn.className = "photo-remove";
    btn.type = "button";
    btn.textContent = "×";
    btn.dataset.existingIndex = idx;
    div.append(img, btn);
    els.photoPreview.appendChild(div);
  });

  pendingFiles.forEach((f, idx) => {
    const div = document.createElement("div");
    div.className = "photo-item";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    img.alt = "업로드 예정 사진";
    const btn = document.createElement("button");
    btn.className = "photo-remove";
    btn.type = "button";
    btn.textContent = "×";
    btn.dataset.pendingIndex = idx;
    div.append(img, btn);
    els.photoPreview.appendChild(div);
  });
}

function clearForm(keepHeader=true) {
  ["sleep","pain","digestion","movement","food","mood","bodyNote"].forEach(k => els[k].value = "");
  els.condition.value = "3";
  els.conditionOutput.value = "3 · 보통";
  pendingFiles = [];
  existingPhotos = [];
  renderPhotos();
  setSaveState("저장 전");
  if (!keepHeader) updateHeader();
}

function buildEntryPayload() {
  return {
    date: selectedDateKey,
    condition: Number(els.condition.value),
    sleep: sanitizeText(els.sleep.value, 500),
    pain: sanitizeText(els.pain.value, 500),
    digestion: sanitizeText(els.digestion.value, 500),
    movement: sanitizeText(els.movement.value, 500),
    food: sanitizeText(els.food.value, 2500),
    mood: sanitizeText(els.mood.value, 500),
    bodyNote: sanitizeText(els.bodyNote.value, 8000),
    photos: existingPhotos,
    birthDate: "1976-11-30",
    updatedAt: serverTimestamp()
  };
}

async function uploadNewPhotos(uid, dateKey) {
  const uploaded = [];
  for (const file of pendingFiles) {
    if (file.size > 8 * 1024 * 1024) throw new Error("사진 한 장은 8MB 이하여야 합니다.");
    if (!["image/jpeg","image/png","image/webp"].includes(file.type)) throw new Error("JPG, PNG, WEBP 사진만 올릴 수 있습니다.");
    const safeName = `${Date.now()}-${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const path = `users/${uid}/diary/${dateKey}/${safeName}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file, { contentType: file.type });
    const url = await getDownloadURL(fileRef);
    uploaded.push({ url, path, name: file.name, type: file.type, size: file.size });
  }
  return uploaded;
}

async function saveEntry() {
  if (!currentUser) return;
  els.saveBtn.disabled = true;
  setSaveState("저장 중…");
  try {
    const uploaded = await uploadNewPhotos(currentUser.uid, selectedDateKey);
    existingPhotos = [...existingPhotos, ...uploaded];
    pendingFiles = [];
    const payload = buildEntryPayload();
    const entryRef = doc(db, "users", currentUser.uid, "diary", selectedDateKey);
    const old = await getDoc(entryRef);
    payload.createdAt = old.exists() && old.data().createdAt ? old.data().createdAt : serverTimestamp();
    await setDoc(entryRef, payload, { merge: true });
    renderPhotos();
    setSaveState("저장됨", true);
    await loadRecentEntries();
  } catch (err) {
    console.error(err);
    setSaveState("저장 실패");
    alert(err.message || "저장 중 문제가 생겼습니다.");
  } finally {
    els.saveBtn.disabled = false;
  }
}

async function loadEntry(dateKey) {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid, "diary", dateKey));
  const [y,m,d] = dateKey.split("-").map(Number);
  updateHeader({y,m,d});
  clearForm(true);
  if (!snap.exists()) {
    setSaveState("새 기록");
    return;
  }
  const v = snap.data();
  els.condition.value = String(v.condition || 3);
  els.conditionOutput.value = `${els.condition.value} · ${conditionLabel(els.condition.value)}`;
  ["sleep","pain","digestion","movement","food","mood","bodyNote"].forEach(k => els[k].value = v[k] || "");
  existingPhotos = Array.isArray(v.photos) ? v.photos : [];
  renderPhotos();
  setSaveState("불러옴", true);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadRecentEntries() {
  if (!currentUser) return;
  els.recentEntries.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    const q = query(
      collection(db, "users", currentUser.uid, "diary"),
      orderBy("date", "desc"),
      limit(12)
    );
    const snap = await getDocs(q);
    els.recentEntries.innerHTML = "";
    if (snap.empty) {
      els.recentEntries.innerHTML = '<p class="muted">아직 저장된 몸의 일기가 없습니다.</p>';
      return;
    }
    snap.forEach(ds => {
      const v = ds.data();
      const row = document.createElement("div");
      row.className = "entry-item";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.date = ds.id;

      const date = document.createElement("span");
      date.className = "entry-date";
      date.textContent = ds.id.replaceAll("-", ". ");

      const preview = document.createElement("span");
      preview.className = "entry-preview";
      preview.textContent = v.bodyNote || v.pain || v.mood || "기록 있음";

      btn.append(date, preview);
      row.appendChild(btn);
      els.recentEntries.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    els.recentEntries.innerHTML = '<p class="muted">기록을 불러오지 못했습니다.</p>';
  }
}

async function removeExistingPhoto(index) {
  const target = existingPhotos[index];
  if (!target) return;
  const ok = confirm("이 사진을 일기에서 삭제할까요? 저장 버튼을 누르면 기록에 반영됩니다.");
  if (!ok) return;
  try {
    if (target.path) await deleteObject(ref(storage, target.path));
  } catch (e) {
    console.warn("Storage 파일 삭제 실패:", e);
  }
  existingPhotos.splice(index,1);
  renderPhotos();
  setSaveState("변경 있음");
}

function setupEvents() {
  els.condition.addEventListener("input", () => {
    const v = els.condition.value;
    els.conditionOutput.value = `${v} · ${conditionLabel(v)}`;
    setSaveState("변경 있음");
  });

  document.querySelectorAll("input, textarea").forEach(el => {
    if (!["email","password","archiveDate","photoInput","condition"].includes(el.id)) {
      el.addEventListener("input", () => setSaveState("변경 있음"));
    }
  });

  els.photoInput.addEventListener("change", () => {
    const incoming = [...els.photoInput.files];
    const valid = incoming.filter(f => f.size <= 8*1024*1024 && ["image/jpeg","image/png","image/webp"].includes(f.type));
    if (valid.length !== incoming.length) alert("8MB 이하의 JPG, PNG, WEBP 사진만 추가됩니다.");
    pendingFiles.push(...valid);
    els.photoInput.value = "";
    renderPhotos();
    setSaveState("변경 있음");
  });

  els.photoPreview.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("photo-remove")) return;
    if (e.target.dataset.pendingIndex !== undefined) {
      pendingFiles.splice(Number(e.target.dataset.pendingIndex), 1);
      renderPhotos();
      setSaveState("변경 있음");
    } else if (e.target.dataset.existingIndex !== undefined) {
      await removeExistingPhoto(Number(e.target.dataset.existingIndex));
    }
  });

  els.saveBtn.addEventListener("click", saveEntry);
  els.clearBtn.addEventListener("click", () => {
    if (confirm("화면에 입력한 내용을 지울까요? 이미 Firebase에 저장된 기록은 삭제되지 않습니다.")) clearForm(true);
  });
  els.pdfBtn.addEventListener("click", () => window.print());
  els.logoutBtn.addEventListener("click", () => signOut(auth));

  els.loadDateBtn.addEventListener("click", () => {
    if (els.archiveDate.value) loadEntry(els.archiveDate.value);
  });

  els.recentEntries.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-date]");
    if (btn) loadEntry(btn.dataset.date);
  });
}

updateHeader();
setupEvents();

if (!isConfigured) {
  els.loginLayer.classList.add("hidden");
  els.setupLayer.classList.remove("hidden");
} else {
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);

  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.loginMessage.textContent = "";
    try {
      await signInWithEmailAndPassword(auth, els.email.value.trim(), els.password.value);
      els.password.value = "";
    } catch (err) {
      console.error(err);
      els.loginMessage.textContent = "로그인 정보를 확인해주세요.";
    }
  });

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      els.loginLayer.classList.add("hidden");
      els.logoutBtn.classList.remove("hidden");
      const today = ymdKey(seoulYMD());
      await loadEntry(today);
      await loadRecentEntries();
    } else {
      els.loginLayer.classList.remove("hidden");
      els.logoutBtn.classList.add("hidden");
      clearForm(false);
    }
  });
}
