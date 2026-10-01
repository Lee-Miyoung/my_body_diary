import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, query, orderByKey, limitToLast
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";

const TZ = "Asia/Seoul";
const OWNER_UID = "yBts8Gp1QjX7rU6P7auwsU524xp1";
const MAX_PHOTOS_PER_DAY = 3;
const IMAGE_MAX_SIDE = 520;
const IMAGE_QUALITY = 0.52;

const config = window.BODY_DIARY_FIREBASE_CONFIG || {};
const ALLOWED_EMAILS = (window.BODY_DIARY_ALLOWED_EMAILS || [])
  .map(v => String(v || "").trim().toLowerCase())
  .filter(v => v && !v.startsWith("USER"));

const isConfigured =
  config.apiKey &&
  config.databaseURL &&
  !String(config.apiKey).startsWith("PUT_") &&
  !String(config.databaseURL).startsWith("PUT_");

const $ = id => document.getElementById(id);

const els = {
  heroUserName:$("heroUserName"), todayText:$("todayText"), ageText:$("ageText"), birthDateText:$("birthDateText"),
  condition:$("condition"), conditionOutput:$("conditionOutput"),
  sleep:$("sleep"), pain:$("pain"), digestion:$("digestion"), movement:$("movement"),
  food:$("food"), mood:$("mood"), bodyNote:$("bodyNote"),
  photoInput:$("photoInput"), photoPreview:$("photoPreview"), photoCountText:$("photoCountText"),
  saveBtn:$("saveBtn"), clearBtn:$("clearBtn"), pdfBtn:$("pdfBtn"), galleryBtn:$("galleryBtn"),
  loginLayer:$("loginLayer"), setupLayer:$("setupLayer"), profileLayer:$("profileLayer"),
  googleLoginBtn:$("googleLoginBtn"), loginMessage:$("loginMessage"),
  previewBtn:$("previewBtn"), previewBanner:$("previewBanner"), exitPreviewBtn:$("exitPreviewBtn"),
  logoutBtn:$("logoutBtn"), profileBtn:$("profileBtn"), saveState:$("saveState"),
  recentEntries:$("recentEntries"), archiveDate:$("archiveDate"), loadDateBtn:$("loadDateBtn"),
  profileName:$("profileName"), profileBirthDate:$("profileBirthDate"),
  profileSaveBtn:$("profileSaveBtn"), profileCancelBtn:$("profileCancelBtn"),
  profileTitle:$("profileTitle"), profileDescription:$("profileDescription"), profileEyebrow:$("profileEyebrow"),
  profileMessage:$("profileMessage"),
  galleryModal:$("galleryModal"), galleryCloseBtn:$("galleryCloseBtn"),
  galleryPrevBtn:$("galleryPrevBtn"), galleryNextBtn:$("galleryNextBtn"),
  galleryImage:$("galleryImage"), galleryDate:$("galleryDate"),
  galleryAge:$("galleryAge"), galleryCounter:$("galleryCounter"), galleryMemo:$("galleryMemo")
};

let auth, db, currentUser = null;
let userProfile = null;
let currentBirth = null;
let selectedDateKey = "";
let currentPhotos = [];
let galleryItems = [];
let galleryIndex = 0;
let previewMode = false;

function seoulYMD(date = new Date()){
  const parts = new Intl.DateTimeFormat("en-CA",{
    timeZone:TZ, year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return {y:+map.year,m:+map.month,d:+map.day};
}
function ymdKey(v){ return `${v.y}-${String(v.m).padStart(2,"0")}-${String(v.d).padStart(2,"0")}`; }
function toUTCDate(v){ return new Date(Date.UTC(v.y,v.m-1,v.d)); }
function clampDay(y,m,d){ return Math.min(d,new Date(Date.UTC(y,m,0)).getUTCDate()); }
function addYears(v,years){ const y=v.y+years; return {y,m:v.m,d:clampDay(y,v.m,v.d)}; }
function addMonths(v,months){
  const base=v.m-1+months;
  const y=v.y+Math.floor(base/12);
  const m=((base%12)+12)%12+1;
  return {y,m,d:clampDay(y,m,v.d)};
}
function compareYMD(a,b){ return toUTCDate(a)-toUTCDate(b); }
function diffDays(a,b){ return Math.floor((toUTCDate(b)-toUTCDate(a))/86400000); }

function parseBirthDate(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||""))) return null;
  const [y,m,d]=s.split("-").map(Number);
  if(!y||!m||!d) return null;
  return {y,m,d};
}
function birthText(s){
  const p=parseBirthDate(s);
  if(!p) return "비공개";
  return `${p.y}. ${String(p.m).padStart(2,"0")}. ${String(p.d).padStart(2,"0")}`;
}
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
  if(!currentBirth) return "";
  const [y,m,d]=dateKey.split("-").map(Number);
  const age=calendarAge(currentBirth,{y,m,d});
  return `${age.years}년 ${age.months}개월 ${age.days}일째`;
}
function updateHeader(target=seoulYMD()){
  if(!currentBirth || !userProfile) return;
  const age=calendarAge(currentBirth,target);
  els.todayText.textContent=koreanDate(target);
  els.ageText.textContent=`${age.years}년 ${age.months}개월 ${age.days}일째`;
  els.birthDateText.textContent=birthText(userProfile.birthDate);
  els.heroUserName.textContent=`${userProfile.name || "나"}의 몸이 기억하는 시간`;
  selectedDateKey=ymdKey(target);
  els.archiveDate.value=selectedDateKey;
}
function conditionLabel(v){
  return ({1:"매우 힘듦",2:"조금 힘듦",3:"보통",4:"좋음",5:"아주 좋음"})[v]||"";
}
function setSaveState(text,ok=false){
  els.saveState.textContent=text;
  els.saveState.style.color=ok?"#587365":"";
}
function clean(v,max=5000){ return String(v||"").trim().slice(0,max); }

function resetUserScreen(){
  selectedDateKey="";
  currentPhotos=[];
  galleryItems=[];
  galleryIndex=0;
  userProfile=null;
  currentBirth=null;

  ["sleep","pain","digestion","movement","food","mood","bodyNote"].forEach(key=>{
    if(els[key]) els[key].value="";
  });
  els.condition.value="3";
  els.conditionOutput.value="3 · 보통";
  els.photoPreview.innerHTML="";
  els.photoCountText.textContent="0장";
  els.recentEntries.innerHTML='<p class="muted">기록을 불러오는 중입니다.</p>';
  els.heroUserName.textContent="몸이 기억하는 시간";
  els.birthDateText.textContent="비공개";
  els.ageText.textContent="—";
  els.todayText.textContent="";
  setSaveState("저장 전");
}

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
        const ctx=canvas.getContext("2d",{alpha:false});
        ctx.fillStyle="#fff";
        ctx.fillRect(0,0,w,h);
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
  if(!keepHeader && userProfile) updateHeader();
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
    birthDate:userProfile.birthDate,
    updatedAt:Date.now()
  };
}
function entryRef(uid,dateKey){ return ref(db,`users/${uid}/diary/${dateKey}`); }

async function saveEntry(){
  if(previewMode){
    alert("미리보기 모드에서는 저장되지 않습니다. 실제 사용은 Google 로그인 후 가능합니다.");
    return;
  }
  if(!currentUser || !userProfile) return;

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
  if(!currentUser || !userProfile) return;

  // 상단 배너는 항상 '오늘'을 유지합니다.
  // 과거 일기를 열어도 오늘 날짜/오늘 나이는 바뀌지 않습니다.
  const snap=await get(entryRef(currentUser.uid,dateKey));

  selectedDateKey=dateKey;
  els.archiveDate.value=dateKey;

  clearForm(true);

  if(!snap.exists()){
    setSaveState(`${formatArchiveDate(dateKey)} · 새 기록`);
    return;
  }

  const v=snap.val()||{};
  els.condition.value=String(v.condition||3);
  els.conditionOutput.value=`${els.condition.value} · ${conditionLabel(els.condition.value)}`;
  ["sleep","pain","digestion","movement","food","mood","bodyNote"].forEach(k=>els[k].value=v[k]||"");
  currentPhotos=Array.isArray(v.photos)?v.photos:[];
  renderPhotos();

  const todayKey=ymdKey(seoulYMD());
  if(dateKey===todayKey){
    setSaveState("오늘 기록",true);
  }else{
    setSaveState(`${formatArchiveDate(dateKey)} 기록 보는 중`,true);
  }

  window.scrollTo({top:0,behavior:"smooth"});
}

function formatArchiveDate(dateKey){
  const [y,m,d]=dateKey.split("-");
  return `${y}. ${m}. ${d}`;
}
function conditionTextFromValue(v){
  return ({1:"매우 힘듦",2:"조금 힘듦",3:"보통",4:"좋음",5:"아주 좋음"})[Number(v)]||"보통";
}
function buildEntryPreview(value){
  return value.bodyNote||value.food||value.pain||value.mood||value.movement||"기록이 저장되어 있습니다.";
}
async function loadRecentEntries(){
  if(!currentUser || !userProfile) return;
  els.recentEntries.innerHTML='<p class="muted">불러오는 중…</p>';

  try{
    const q=query(ref(db,`users/${currentUser.uid}/diary`),orderByKey(),limitToLast(12));
    const snap=await get(q);
    const rows=[];
    snap.forEach(child=>rows.push({key:child.key,value:child.val()}));
    rows.reverse();
    els.recentEntries.innerHTML="";

    if(!rows.length){
      els.recentEntries.innerHTML='<div class="empty-archive"><strong>아직 저장된 몸의 일기가 없습니다.</strong><span>첫 기록을 남기면 이곳에 차곡차곡 쌓입니다.</span></div>';
      return;
    }

    rows.forEach(({key,value})=>{
      const row=document.createElement("div");
      row.className="entry-item";

      const accent=document.createElement("div");
      accent.className=`entry-accent accent-${Math.min(5,Math.max(1,Number(value.condition||3)))}`;

      const btn=document.createElement("button");
      btn.type="button";
      btn.dataset.date=key;

      const top=document.createElement("div");
      top.className="entry-top";

      const heading=document.createElement("div");
      heading.className="entry-heading";

      const date=document.createElement("span");
      date.className="entry-date";
      date.textContent=formatArchiveDate(key);

      const age=document.createElement("span");
      age.className="entry-age";
      age.textContent=ageTextForKey(key);

      heading.append(date,age);

      const chips=document.createElement("div");
      chips.className="entry-chips";

      const conditionChip=document.createElement("span");
      conditionChip.className="entry-chip";
      conditionChip.textContent=`컨디션 ${conditionTextFromValue(value.condition)}`;
      chips.appendChild(conditionChip);

      const photoCount=Array.isArray(value.photos)?value.photos.length:0;
      if(photoCount>0){
        const photoChip=document.createElement("span");
        photoChip.className="entry-chip photo-chip";
        photoChip.textContent=`사진 ${photoCount}장`;
        chips.appendChild(photoChip);
      }

      top.append(heading,chips);

      const preview=document.createElement("span");
      preview.className="entry-preview";
      preview.textContent=buildEntryPreview(value);

      const meta=document.createElement("span");
      meta.className="entry-meta";
      meta.textContent=value.mood?`오늘의 기분 · ${String(value.mood).slice(0,28)}`:"기록 자세히 보기";

      btn.append(top,preview,meta);

      const arrow=document.createElement("span");
      arrow.className="entry-arrow";
      arrow.textContent="›";

      row.append(accent,btn,arrow);
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
      items.push({date:child.key,src,memo:v.bodyNote||v.pain||v.mood||"",photoIndex});
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
  if(!galleryItems.length){ alert("아직 저장된 사진이 없습니다."); return; }
  const idx=galleryItems.findIndex(matchFn);
  galleryIndex=idx>=0?idx:galleryItems.length-1;
  showGalleryItem();
  els.galleryModal.classList.remove("hidden");
  document.body.style.overflow="hidden";
}
function openCurrentDayGallery(photoIndex){
  if(previewMode){ alert("미리보기에서는 실제 사진 갤러리를 열지 않습니다."); return; }
  openGalleryAt(x=>x.date===selectedDateKey&&x.photoIndex===photoIndex);
}
function closeGallery(){ els.galleryModal.classList.add("hidden"); document.body.style.overflow=""; }
function moveGallery(delta){
  if(!galleryItems.length) return;
  galleryIndex=(galleryIndex+delta+galleryItems.length)%galleryItems.length;
  showGalleryItem();
}

async function inferLegacyProfile(uid){
  // 기존 일기에서 생년월일을 가져오는 것은 기존 소유자 계정에게만 허용
  if(uid!==OWNER_UID) return null;

  try{
    const snap=await get(query(ref(db,`users/${uid}/diary`),orderByKey(),limitToLast(1)));
    let last=null;
    snap.forEach(child=>{ last=child.val(); });

    if(last && parseBirthDate(last.birthDate)){
      return {
        name: currentUser.displayName || "미영",
        birthDate:last.birthDate,
        email:String(currentUser.email||"").toLowerCase(),
        createdAt:Date.now(),
        migratedFromDiary:true
      };
    }
  }catch(err){
    console.warn("legacy profile infer failed",err);
  }
  return null;
}

async function loadProfile(uid){
  const profileRef=ref(db,`users/${uid}/profile`);
  const snap=await get(profileRef);
  if(snap.exists()) return snap.val();

  if(uid===OWNER_UID){
    const legacy=await inferLegacyProfile(uid);
    if(legacy){
      await set(profileRef,legacy);
      return legacy;
    }
  }
  return null;
}

function isAllowedEmail(email){
  if(!ALLOWED_EMAILS.length) return false;
  return ALLOWED_EMAILS.includes(String(email||"").trim().toLowerCase());
}

function openFirstProfileSetup(){
  els.profileEyebrow.textContent="FIRST RECORD";
  els.profileTitle.textContent="나의 시작일을 알려주세요";
  els.profileDescription.textContent="생년월일은 나의 몸의 시간을 계산하기 위해 사용합니다. 처음 한 번만 입력하면 됩니다.";
  els.profileName.value=currentUser?.displayName||"";
  els.profileBirthDate.value="";
  els.profileMessage.textContent="";
  els.profileCancelBtn.classList.add("hidden");
  els.profileLayer.classList.remove("hidden");
}

function openProfileEditor(){
  if(!currentUser || !userProfile) return;

  els.profileEyebrow.textContent="MY PROFILE";
  els.profileTitle.textContent="내 정보 수정";
  els.profileDescription.textContent="이름과 생년월일을 수정할 수 있습니다. 변경된 생년월일을 기준으로 나이가 다시 계산됩니다.";
  els.profileName.value=userProfile.name||"";
  els.profileBirthDate.value=userProfile.birthDate||"";
  els.profileMessage.textContent="";
  els.profileCancelBtn.classList.remove("hidden");
  els.profileLayer.classList.remove("hidden");
}

async function saveProfile(){
  if(!currentUser) return;

  const name=clean(els.profileName.value,30);
  const birthDate=els.profileBirthDate.value;

  if(!name){
    els.profileMessage.textContent="이름 또는 별칭을 입력해주세요.";
    return;
  }
  if(!parseBirthDate(birthDate)){
    els.profileMessage.textContent="생년월일을 정확히 선택해주세요.";
    return;
  }

  const profile={
    name,
    birthDate,
    email:String(currentUser.email||"").toLowerCase(),
    createdAt:userProfile?.createdAt||Date.now(),
    updatedAt:Date.now()
  };

  try{
    await set(ref(db,`users/${currentUser.uid}/profile`),profile);
    userProfile=profile;
    currentBirth=parseBirthDate(profile.birthDate);
    els.profileLayer.classList.add("hidden");
    els.profileCancelBtn.classList.add("hidden");

    // 내 정보를 수정해도 상단 배너는 항상 오늘 날짜/오늘 나이를 표시
    updateHeader(seoulYMD());

    // 과거 기록을 보고 있던 중이었다면 저장 대상 날짜는 그대로 유지
    if(selectedDateKey){
      els.archiveDate.value=selectedDateKey;
    }

    await loadRecentEntries();
    setSaveState("내 정보 저장됨",true);
  }catch(err){
    console.error(err);
    els.profileMessage.textContent="정보를 저장하지 못했습니다.";
  }
}

async function startDiary(){
  if(!userProfile) return;
  currentBirth=parseBirthDate(userProfile.birthDate);

  // 상단 배너는 로그인 시점의 '오늘' 날짜/나이로 고정
  updateHeader(seoulYMD());

  const today=ymdKey(seoulYMD());
  await loadEntry(today);
  await loadRecentEntries();
}

function renderPreviewEntries(){
  const demos=[
    {key:"2026-09-28",value:{condition:4,bodyNote:"오후 산책을 하고 나니 몸이 한결 가벼워졌다.",mood:"차분하고 편안함",photos:["demo1"]}},
    {key:"2026-09-20",value:{condition:2,bodyNote:"잠이 부족해 몸이 무거웠다. 따뜻한 차를 마시고 일찍 쉬었다.",mood:"조금 지침",photos:[]}},
    {key:"2026-09-07",value:{condition:5,bodyNote:"아침 공기가 좋아 오래 걷고 싶었던 날. 몸도 마음도 가벼웠다.",mood:"상쾌함",photos:["demo1","demo2"]}}
  ];

  els.recentEntries.innerHTML="";
  demos.forEach(({key,value})=>{
    const row=document.createElement("div");
    row.className="entry-item";
    const accent=document.createElement("div");
    accent.className=`entry-accent accent-${value.condition}`;
    const btn=document.createElement("button");
    btn.type="button";
    const top=document.createElement("div");
    top.className="entry-top";
    const heading=document.createElement("div");
    heading.className="entry-heading";
    const date=document.createElement("span");
    date.className="entry-date"; date.textContent=formatArchiveDate(key);
    const age=document.createElement("span");
    age.className="entry-age"; age.textContent=ageTextForKey(key);
    heading.append(date,age);
    const chips=document.createElement("div");
    chips.className="entry-chips";
    const c=document.createElement("span");
    c.className="entry-chip"; c.textContent=`컨디션 ${conditionTextFromValue(value.condition)}`;
    chips.appendChild(c);
    if(value.photos.length){
      const p=document.createElement("span");
      p.className="entry-chip photo-chip"; p.textContent=`사진 ${value.photos.length}장`;
      chips.appendChild(p);
    }
    top.append(heading,chips);
    const preview=document.createElement("span");
    preview.className="entry-preview"; preview.textContent=value.bodyNote;
    const meta=document.createElement("span");
    meta.className="entry-meta"; meta.textContent=`오늘의 기분 · ${value.mood}`;
    btn.append(top,preview,meta);
    const arrow=document.createElement("span");
    arrow.className="entry-arrow"; arrow.textContent="›";
    row.append(accent,btn,arrow);
    els.recentEntries.appendChild(row);
  });
}

function enterPreviewMode(){
  previewMode=true;
  userProfile={name:"샘플",birthDate:"1990-01-01",email:"preview@example.invalid"};
  currentBirth=parseBirthDate(userProfile.birthDate);

  els.loginLayer.classList.add("hidden");
  els.profileLayer.classList.add("hidden");
  els.logoutBtn.classList.add("hidden");
  els.profileBtn.classList.add("hidden");
  els.previewBanner.classList.remove("hidden");

  updateHeader({y:2026,m:10,d:1});
  els.heroUserName.textContent="샘플 기록 · 몸이 기억하는 시간";
  els.birthDateText.textContent="비공개";

  els.sleep.value="7시간";
  els.pain.value="목과 어깨가 조금 뻐근함";
  els.digestion.value="대체로 편안함";
  els.movement.value="가볍게 30분 걷기";
  els.food.value="평소보다 천천히 먹었더니 속이 편안했다.";
  els.mood.value="차분함";
  els.bodyNote.value="오늘은 몸의 작은 변화를 천천히 살펴본 날. 무리하지 않고 일찍 쉬기로 했다.";
  els.condition.value="3";
  els.conditionOutput.value="3 · 보통";
  currentPhotos=[];
  renderPhotos();
  renderPreviewEntries();
  setSaveState("미리보기");
  window.scrollTo({top:0,behavior:"smooth"});
}

function exitPreviewMode(){
  previewMode=false;
  resetUserScreen();
  els.previewBanner.classList.add("hidden");
  els.loginLayer.classList.remove("hidden");
  window.scrollTo({top:0,behavior:"smooth"});
}

let touchStartX=null;
els.galleryModal.addEventListener("touchstart",e=>{ touchStartX=e.changedTouches[0].clientX; },{passive:true});
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
    if(!["archiveDate","photoInput","condition","profileName","profileBirthDate"].includes(el.id)){
      el.addEventListener("input",()=>setSaveState("변경 있음"));
    }
  });

  els.photoInput.addEventListener("change",async()=>{
    if(previewMode){
      alert("미리보기에서는 사진을 저장하지 않습니다.");
      els.photoInput.value="";
      return;
    }
    const files=[...els.photoInput.files];
    els.photoInput.value="";
    const remaining=MAX_PHOTOS_PER_DAY-currentPhotos.length;
    if(remaining<=0){ alert(`하루 사진은 최대 ${MAX_PHOTOS_PER_DAY}장까지 저장할 수 있습니다.`); return; }
    const selected=files.slice(0,remaining);
    if(files.length>remaining) alert(`하루 최대 ${MAX_PHOTOS_PER_DAY}장까지만 저장됩니다.`);

    for(const file of selected){
      try{ currentPhotos.push(await resizeToBase64(file)); }
      catch(err){ alert(err.message); }
    }
    renderPhotos();
    setSaveState("변경 있음");
  });

  els.saveBtn.addEventListener("click",saveEntry);
  els.clearBtn.addEventListener("click",()=>{
    if(confirm("화면에 입력한 내용을 지울까요? 이미 저장된 기록은 삭제되지 않습니다.")) clearForm(true);
  });
  els.pdfBtn.addEventListener("click",()=>window.print());
  els.galleryBtn.addEventListener("click",()=>previewMode ? alert("미리보기에서는 실제 사진 갤러리를 열지 않습니다.") : openGalleryAt(()=>false));
  els.logoutBtn.addEventListener("click",()=>signOut(auth));
  els.profileBtn.addEventListener("click",openProfileEditor);
  els.profileCancelBtn.addEventListener("click",()=>els.profileLayer.classList.add("hidden"));
  els.profileSaveBtn.addEventListener("click",saveProfile);
  els.previewBtn.addEventListener("click",enterPreviewMode);
  els.exitPreviewBtn.addEventListener("click",exitPreviewMode);

  els.loadDateBtn.addEventListener("click",()=>{
    if(previewMode){ alert("미리보기에서는 날짜별 실제 기록을 불러오지 않습니다."); return; }
    if(els.archiveDate.value) loadEntry(els.archiveDate.value);
  });
  els.recentEntries.addEventListener("click",e=>{
    if(previewMode) return;
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
        try{ await signInWithRedirect(auth,provider); return; }catch(e){ console.error(e); }
      }
      els.loginMessage.textContent="Google 로그인에 실패했습니다. 다시 시도해주세요.";
    }finally{
      els.googleLoginBtn.disabled=false;
    }
  });

  onAuthStateChanged(auth,async user=>{
    resetUserScreen();
    currentUser=user;

    if(!user){
      els.loginLayer.classList.remove("hidden");
      els.profileLayer.classList.add("hidden");
      els.logoutBtn.classList.add("hidden");
      els.profileBtn.classList.add("hidden");
      return;
    }

    const email=String(user.email||"").trim().toLowerCase();

    if(!isAllowedEmail(email)){
      els.loginMessage.textContent="초대된 계정이 아닙니다.";
      await signOut(auth);
      return;
    }

    els.loginLayer.classList.add("hidden");
    els.logoutBtn.classList.remove("hidden");
    els.profileBtn.classList.remove("hidden");

    userProfile=await loadProfile(user.uid);

    if(!userProfile){
      openFirstProfileSetup();
      return;
    }

    await startDiary();
  });
}
