import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, query, orderByKey, limitToLast
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";

const BIRTH = { y: 1976, m: 11, d: 30 };
const TZ = "Asia/Seoul";
const MAX_PHOTOS_PER_DAY = 3;
const IMAGE_MAX_SIDE = 520;
const IMAGE_QUALITY = 0.52;

const config = window.BODY_DIARY_FIREBASE_CONFIG || {};
const isConfigured =
  config.apiKey &&
  config.databaseURL &&
  !String(config.apiKey).startsWith("PUT_") &&
  !String(config.databaseURL).startsWith("PUT_");

const $ = id => document.getElementById(id);

const els = {
  todayText:$("todayText"), ageText:$("ageText"),
  condition:$("condition"), conditionOutput:$("conditionOutput"),
  sleep:$("sleep"), pain:$("pain"), digestion:$("digestion"),
  movement:$("movement"), food:$("food"), mood:$("mood"),
  bodyNote:$("bodyNote"), photoInput:$("photoInput"),
  photoPreview:$("photoPreview"), photoCountText:$("photoCountText"),
  saveBtn:$("saveBtn"), clearBtn:$("clearBtn"),
  pdfBtn:$("pdfBtn"), galleryBtn:$("galleryBtn"),
  loginLayer:$("loginLayer"), setupLayer:$("setupLayer"),
  googleLoginBtn:$("googleLoginBtn"), loginMessage:$("loginMessage"),
  logoutBtn:$("logoutBtn"), saveState:$("saveState"),
  recentEntries:$("recentEntries"), archiveDate:$("archiveDate"),
  loadDateBtn:$("loadDateBtn"),
  galleryModal:$("galleryModal"), galleryCloseBtn:$("galleryCloseBtn"),
  galleryPrevBtn:$("galleryPrevBtn"), galleryNextBtn:$("galleryNextBtn"),
  galleryImage:$("galleryImage"), galleryDate:$("galleryDate"),
  galleryAge:$("galleryAge"), galleryCounter:$("galleryCounter"),
  galleryMemo:$("galleryMemo")
};

let auth, db, currentUser = null;
let selectedDateKey = "";
let currentPhotos = [];
let galleryItems = [];
let galleryIndex = 0;

function seoulYMD(date = new Date()){
  const parts = new Intl.DateTimeFormat("en-CA",{
    timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return {y:+map.year,m:+map.month,d:+map.day};
}
function ymdKey(v){
  return `${v.y}-${String(v.m).padStart(2,"0")}-${String(v.d).padStart(2,"0")}`;
}
function toUTCDate(v){ return new Date(Date.UTC(v.y,v.m-1,v.d)); }
function clampDay(y,m,d){ return Math.min(d,new Date(Date.UTC(y,m,0)).getUTCDate()); }
function addYears(v,years){
  const y=v.y+years; return {y,m:v.m,d:clampDay(y,v.m,v.d)};
}
function addMonths(v,months){
  const base=v.m-1+months;
  const y=v.y+Math.floor(base/12);
  const m=((base%12)+12)%12+1;
  return {y,m,d:clampDay(y,m,v.d)};
}
function compareYMD(a,b){ return toUTCDate(a)-toUTCDate(b); }
function diffDays(a,b){ return Math.floor((toUTCDate(b)-toUTCDate(a))/86400000); }
function calendarAge(birth,today){
  let years=today.y-birth.y;
  let yearAnchor=addYears(birth,years);
  if(compareYMD(yearAnchor,today)>0){ years--; yearAnchor=addYears(birth,years); }
  let months=0;
  for(let i=1;i<=11;i++){
    const c=addMonths(yearAnchor,i);
    if(compareYMD(c,today)<=0) months=i; else break;
  }
  const monthAnchor=addMonths(yearAnchor,months);
  return {years,months,days:diffDays(monthAnchor,today)};
}
function koreanDate(v){
  const dt=new Date(Date.UTC(v.y,v.m-1,v.d,12));
  return new Intl.DateTimeFormat("ko-KR",{
    timeZone:"UTC",year:"numeric",month:"long",day:"numeric",weekday:"long"
  }).format(dt);
}
function ageTextForKey(dateKey){
  const [y,m,d]=dateKey.split("-").map(Number);
  const age=calendarAge(BIRTH,{y,m,d});
  return `${age.years}년 ${age.months}개월 ${age.days}일째`;
}
function updateHeader(target=seoulYMD()){
  const age=calendarAge(BIRTH,target);
  els.todayText.textContent=koreanDate(target);
  els.ageText.textContent=`${age.years}년 ${age.months}개월 ${age.days}일째`;
  selectedDateKey=ymdKey(target);
  els.archiveDate.value=selectedDateKey;
}

function conditionLabel(v){
  return ({1:"매우 힘듦",2:"조금 힘듦",3:"보통",4:"좋음",5:"아주 좋음"})[v]||"";
}
function setSaveState(text,ok=false){
  els.saveState.textContent=text;
  els.saveState.style.color=ok?"#4f5c4b":"";
}
function clean(v,max=5000){ return String(v||"").trim().slice(0,max); }

function renderPhotos(){
  els.photoPreview.innerHTML="";
  currentPhotos.forEach((src,index)=>{
    const item=document.createElement("div");
    item.className="photo-item";

    const img=document.createElement("img");
    img.src=src;
    img.alt="몸의 일기 사진";
    img.addEventListener("click",()=>openCurrentDayGallery(index));

    const del=document.createElement("button");
    del.className="photo-remove";
    del.type="button";
    del.textContent="×";
    del.addEventListener("click",e=>{
      e.stopPropagation();
      currentPhotos.splice(index,1);
      renderPhotos();
      setSaveState("변경 있음");
    });

    item.append(img,del);
    els.photoPreview.appendChild(item);
  });
  els.photoCountText.textContent=`${currentPhotos.length}장`;
}

function resizeToBase64(file){
  return new Promise((resolve,reject)=>{
    if(!file.type.startsWith("image/")) return reject(new Error("이미지 파일만 선택할 수 있습니다."));
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("사진을 읽지 못했습니다."));
    reader.onload=e=>{
      const img=new Image();
      img.onerror=()=>reject(new Error("사진을 처리하지 못했습니다."));
      img.onload=()=>{
        let w=img.width,h=img.height;
        const max=Math.max(w,h);
        if(max>IMAGE_MAX_SIDE){
          const ratio=IMAGE_MAX_SIDE/max;
          w=Math.round(w*ratio); h=Math.round(h*ratio);
        }
        const canvas=document.createElement("canvas");
        canvas.width=w; canvas.height=h;
        const ctx=canvas.getContext("2d");
        ctx.drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL("image/jpeg",IMAGE_QUALITY));
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function clearForm(keepHeader=true){
  ["sleep","pain","digestion","movement","food","mood","bodyNote"].forEach(k=>els[k].value="");
  els.condition.value="3";
  els.conditionOutput.value="3 · 보통";
  currentPhotos=[];
  renderPhotos();
  setSaveState("저장 전");
  if(!keepHeader) updateHeader();
}

function payload(){
  return {
    date:selectedDateKey,
    condition:Number(els.condition.value),
    sleep:clean(els.sleep.value,500),
    pain:clean(els.pain.value,500),
    digestion:clean(els.digestion.value,500),
    movement:clean(els.movement.value,500),
    food:clean(els.food.value,2500),
    mood:clean(els.mood.value,500),
    bodyNote:clean(els.bodyNote.value,8000),
    photos:currentPhotos,
    birthDate:"1976-11-30",
    updatedAt:Date.now()
  };
}

function entryRef(uid,dateKey){
  return ref(db,`users/${uid}/diary/${dateKey}`);
}

async function saveEntry(){
  if(!currentUser) return;
  els.saveBtn.disabled=true;
  setSaveState("저장 중…");
  try{
    const target=entryRef(currentUser.uid,selectedDateKey);
    const old=await get(target);
    const data=payload();
    data.createdAt=old.exists() && old.val().createdAt ? old.val().createdAt : Date.now();
    await set(target,data);
    setSaveState("저장됨",true);
    await loadRecentEntries();
  }catch(err){
    console.error(err);
    setSaveState("저장 실패");
    alert(err.message||"저장 중 문제가 생겼습니다.");
  }finally{
    els.saveBtn.disabled=false;
  }
}

async function loadEntry(dateKey){
  if(!currentUser) return;
  const snap=await get(entryRef(currentUser.uid,dateKey));
  const [y,m,d]=dateKey.split("-").map(Number);
  updateHeader({y,m,d});
  clearForm(true);

  if(!snap.exists()){
    setSaveState("새 기록");
    return;
  }

  const v=snap.val()||{};
  els.condition.value=String(v.condition||3);
  els.conditionOutput.value=`${els.condition.value} · ${conditionLabel(els.condition.value)}`;
  ["sleep","pain","digestion","movement","food","mood","bodyNote"].forEach(k=>els[k].value=v[k]||"");
  currentPhotos=Array.isArray(v.photos) ? v.photos : [];
  renderPhotos();
  setSaveState("불러옴",true);
  window.scrollTo({top:0,behavior:"smooth"});
}

async function loadRecentEntries(){
  if(!currentUser) return;
  els.recentEntries.innerHTML='<p class="muted">불러오는 중…</p>';
  try{
    const q=query(ref(db,`users/${currentUser.uid}/diary`),orderByKey(),limitToLast(12));
    const snap=await get(q);
    const rows=[];
    snap.forEach(child=>rows.push({key:child.key,value:child.val()}));
    rows.reverse();

    els.recentEntries.innerHTML="";
    if(!rows.length){
      els.recentEntries.innerHTML='<p class="muted">아직 저장된 몸의 일기가 없습니다.</p>';
      return;
    }

    rows.forEach(({key,value})=>{
      const row=document.createElement("div");
      row.className="entry-item";
      const btn=document.createElement("button");
      btn.type="button";
      btn.dataset.date=key;

      const date=document.createElement("span");
      date.className="entry-date";
      date.textContent=key.replaceAll("-",". ");

      const preview=document.createElement("span");
      preview.className="entry-preview";
      preview.textContent=value.bodyNote||value.pain||value.mood||((value.photos||[]).length?`사진 ${(value.photos||[]).length}장`:"기록 있음");

      btn.append(date,preview);
      row.append(btn);
      els.recentEntries.append(row);
    });
  }catch(err){
    console.error(err);
    els.recentEntries.innerHTML='<p class="muted">기록을 불러오지 못했습니다.</p>';
  }
}

async function buildGalleryItems(){
  if(!currentUser) return [];
  const snap=await get(ref(db,`users/${currentUser.uid}/diary`));
  const items=[];
  snap.forEach(child=>{
    const v=child.val()||{};
    const photos=Array.isArray(v.photos)?v.photos:[];
    photos.forEach((src,photoIndex)=>{
      items.push({
        date:child.key,
        src,
        memo:v.bodyNote||v.pain||v.mood||"",
        photoIndex
      });
    });
  });
  items.sort((a,b)=>a.date.localeCompare(b.date)||a.photoIndex-b.photoIndex);
  return items;
}

function showGalleryItem(){
  const item=galleryItems[galleryIndex];
  if(!item) return;
  els.galleryImage.src=item.src;
  els.galleryDate.textContent=item.date.replaceAll("-",". ");
  els.galleryAge.textContent=ageTextForKey(item.date);
  els.galleryCounter.textContent=`${galleryIndex+1} / ${galleryItems.length}`;
  els.galleryMemo.textContent=item.memo||"";
}

async function openGalleryAt(matchFn){
  galleryItems=await buildGalleryItems();
  if(!galleryItems.length){
    alert("아직 저장된 사진이 없습니다.");
    return;
  }
  const idx=galleryItems.findIndex(matchFn);
  galleryIndex=idx>=0?idx:galleryItems.length-1;
  showGalleryItem();
  els.galleryModal.classList.remove("hidden");
  els.galleryModal.setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden";
}
function openCurrentDayGallery(photoIndex){
  openGalleryAt(x=>x.date===selectedDateKey && x.photoIndex===photoIndex);
}
function closeGallery(){
  els.galleryModal.classList.add("hidden");
  els.galleryModal.setAttribute("aria-hidden","true");
  document.body.style.overflow="";
}
function moveGallery(delta){
  if(!galleryItems.length) return;
  galleryIndex=(galleryIndex+delta+galleryItems.length)%galleryItems.length;
  showGalleryItem();
}

let touchStartX=null;
els.galleryModal.addEventListener("touchstart",e=>{
  touchStartX=e.changedTouches[0].clientX;
},{passive:true});
els.galleryModal.addEventListener("touchend",e=>{
  if(touchStartX===null) return;
  const dx=e.changedTouches[0].clientX-touchStartX;
  if(Math.abs(dx)>45) moveGallery(dx<0?1:-1);
  touchStartX=null;
},{passive:true});

function setupEvents(){
  els.condition.addEventListener("input",()=>{
    els.conditionOutput.value=`${els.condition.value} · ${conditionLabel(els.condition.value)}`;
    setSaveState("변경 있음");
  });

  document.querySelectorAll("input,textarea").forEach(el=>{
    if(!["archiveDate","photoInput","condition"].includes(el.id)){
      el.addEventListener("input",()=>setSaveState("변경 있음"));
    }
  });

  els.photoInput.addEventListener("change",async()=>{
    const files=[...els.photoInput.files];
    els.photoInput.value="";
    const remaining=MAX_PHOTOS_PER_DAY-currentPhotos.length;
    if(remaining<=0){
      alert(`하루 사진은 최대 ${MAX_PHOTOS_PER_DAY}장까지 저장할 수 있습니다.`);
      return;
    }
    const selected=files.slice(0,remaining);
    if(files.length>remaining){
      alert(`하루 최대 ${MAX_PHOTOS_PER_DAY}장까지만 저장됩니다.`);
    }
    for(const file of selected){
      try{
        currentPhotos.push(await resizeToBase64(file));
      }catch(err){
        alert(err.message);
      }
    }
    renderPhotos();
    setSaveState("변경 있음");
  });

  els.saveBtn.addEventListener("click",saveEntry);
  els.clearBtn.addEventListener("click",()=>{
    if(confirm("화면에 입력한 내용을 지울까요? 이미 저장된 기록은 삭제되지 않습니다.")) clearForm(true);
  });
  els.pdfBtn.addEventListener("click",()=>window.print());
  els.galleryBtn.addEventListener("click",()=>openGalleryAt(()=>false));
  els.logoutBtn.addEventListener("click",()=>signOut(auth));
  els.loadDateBtn.addEventListener("click",()=>els.archiveDate.value&&loadEntry(els.archiveDate.value));
  els.recentEntries.addEventListener("click",e=>{
    const btn=e.target.closest("button[data-date]");
    if(btn) loadEntry(btn.dataset.date);
  });

  els.galleryCloseBtn.addEventListener("click",closeGallery);
  els.galleryPrevBtn.addEventListener("click",()=>moveGallery(-1));
  els.galleryNextBtn.addEventListener("click",()=>moveGallery(1));
  document.addEventListener("keydown",e=>{
    if(els.galleryModal.classList.contains("hidden")) return;
    if(e.key==="Escape") closeGallery();
    if(e.key==="ArrowLeft") moveGallery(-1);
    if(e.key==="ArrowRight") moveGallery(1);
  });
}

updateHeader();
setupEvents();

if(!isConfigured){
  els.loginLayer.classList.add("hidden");
  els.setupLayer.classList.remove("hidden");
}else{
  const app=initializeApp(config);
  auth=getAuth(app);
  db=getDatabase(app);

  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});

  getRedirectResult(auth).catch(err=>{
    console.error(err);
    els.loginMessage.textContent="Google 로그인 처리 중 문제가 생겼습니다.";
  });

  els.googleLoginBtn.addEventListener("click",async()=>{
    els.loginMessage.textContent="";
    els.googleLoginBtn.disabled=true;
    try{
      await signInWithPopup(auth,provider);
    }catch(err){
      console.error(err);
      if(["auth/popup-blocked","auth/popup-closed-by-user","auth/cancelled-popup-request"].includes(err.code)){
        try{
          await signInWithRedirect(auth,provider);
          return;
        }catch(e){ console.error(e); }
      }
      els.loginMessage.textContent="Google 로그인에 실패했습니다. 다시 시도해주세요.";
    }finally{
      els.googleLoginBtn.disabled=false;
    }
  });

  onAuthStateChanged(auth,async user=>{
    currentUser=user;
    if(user){
      els.loginLayer.classList.add("hidden");
      els.logoutBtn.classList.remove("hidden");
      const today=ymdKey(seoulYMD());
      await loadEntry(today);
      await loadRecentEntries();
    }else{
      els.loginLayer.classList.remove("hidden");
      els.logoutBtn.classList.add("hidden");
      clearForm(false);
    }
  });
}
