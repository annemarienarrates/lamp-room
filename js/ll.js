/* The Lamp Room — the business side: Ledger & Lamp's almanac, scheduler, titles, pipeline, work log, ledger and key,
   brought in whole and running on the shared Library instead of a hosted database. */
(function () {
"use strict";
/* ============ basics ============ */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const D=s=>{const [y,m,dd]=s.split('-').map(Number);return new Date(y,m-1,dd,12);};
const addDays=(s,n)=>{const d=D(s);d.setDate(d.getDate()+n);return iso(d);};
const dow=s=>D(s).getDay();
const TODAY=iso(new Date());
const money=n=>(n<0?'−':'')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US');
const money2=n=>'$'+(+n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const hrs=n=>(Math.round(n*10)/10).toLocaleString('en-US')+'h';
const MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
const fmt=s=>{if(!s)return '—';const d=D(s);return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]} ${MON[d.getMonth()].slice(0,3)} ${d.getDate()}`;};
const fmtShort=s=>{if(!s)return '—';const d=D(s);return `${MON[d.getMonth()].slice(0,3)} ${d.getDate()}`;};
const roman=n=>{const m=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];let r='';for(const [v,s] of m)while(n>=v){r+=s;n-=v;}return r;};
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const maxDate=a=>a.reduce((m,x)=>x>m?x:m,'0000-00-00');
const PEOPLE=['anne','jack'];
const PNAME={anne:'Anne',jack:'Jack'};
const partnerOf=p=>p==='anne'?'jack':'anne';
const INKS=['#2f4b7c','#3e8e7e','#3d6b4f','#6d3f6e','#56677a','#5f7a3a','#2c6f8f','#7a5230','#7d6f9e','#8a8a3a','#1f6e6e','#9c6b8e'];
const INK_NAMES=['Indigo','Verdigris','Bottle','Plum','Slate','Moss','Teal','Umber','Heather','Olive','Peacock','Mauve'];
const STAGE_LABEL={record:'Record',ext:'Partner records',edit:'Edit',deliver:'Deliver & invoice',pickups:'Pickups',
  outline:'Outline',draft:'Draft',revise:'Revise',aedit:'Edit',format:'Cover & format',publish:'Publish',market:'Market'};
const STAGE_SHORT={record:'rec',ext:'partner',edit:'edit',deliver:'deliver',pickups:'pickups',outline:'outline',draft:'draft',revise:'revise',aedit:'edit',format:'format',publish:'publish',market:'market'};
const AUTHOR_KEYS=['outline','draft','revise','aedit','format','publish','market'];
const CAT={S:'Solo',A:'A · Jack & Anne',B:'B · Outside partner, 50/50',C:'C · Outside partner, per word',D:'D · Characters only'};

const DEFAULTS={
  wordsPerFH:9300, clearDays:7, pickupDelay:5, editorDays:5, editorRate:50, headStart:2, editLag:2, tailIn:2, tailOut:4, weekEarly:5, comfortDays:2,
  goals:{fh:480,revenue:96000},
  baseline:{year:2026,fh:156.51,revenue:31302},
  skipHolidays:[],
  people:{
    anne:{hours:6,days:[1,2,3,4,5],wph:4035,editPerFH:1.5,pickupsPerFH:0.15,adminPerTitle:1,writeWph:1000},
    jack:{hours:6,days:[1,2,3,4,5],wph:2000,editPerFH:2.5,pickupsPerFH:0.2,adminPerTitle:1,writeWph:800}
  },
  authorHours:{outline:8,revise:20,aedit:15,format:6,publish:3,market:10}
};
const S={db:null,user:null,sample:null,dict:null,dl:null,uid:null,me:null,
  titles:[],logs:[],fh:[],bills:[],daysoff:[],pipeline:[],members:[],deposits:[],cfgDoc:null,cfg:structuredClone(DEFAULTS),
  tab:'almanac',month:TODAY.slice(0,7),showPartner:false,loaded:false,offline:false,sim:null};
try{S.showPartner=localStorage.getItem('ll-partner')==='1';}catch(e){}

function mergeCfg(doc){
  const c=structuredClone(DEFAULTS);
  if(doc){for(const k of Object.keys(doc)){ if(k==='people'){for(const p of PEOPLE)c.people[p]={...c.people[p],...(doc.people?.[p]||{})};}
    else if(k==='authorHours'||k==='goals'||k==='baseline'){c[k]={...c[k],...doc[k]};} else c[k]=doc[k]; }}
  return c;
}

/* ============ holidays & workdays ============ */
const holCache={};
function nthDow(y,m,wd,n){const d=new Date(y,m,1,12);let c=0;while(true){if(d.getDay()===wd&&++c===n)return iso(d);d.setDate(d.getDate()+1);}}
function lastDow(y,m,wd){const d=new Date(y,m+1,0,12);while(d.getDay()!==wd)d.setDate(d.getDate()-1);return iso(d);}
function observed(s){const w=dow(s);return w===6?addDays(s,-1):w===0?addDays(s,1):s;}
function holidays(y){
  if(holCache[y])return holCache[y];
  const h={};
  const add=(d,n)=>{h[d]=n;};
  add(observed(`${y}-01-01`),"New Year's Day");
  add(nthDow(y,0,1,3),'MLK Day');
  add(nthDow(y,1,1,3),"Presidents' Day");
  add(lastDow(y,4,1),'Memorial Day');
  add(observed(`${y}-06-19`),'Juneteenth');
  add(observed(`${y}-07-04`),'Independence Day');
  add(nthDow(y,8,1,1),'Labor Day');
  add(nthDow(y,9,1,2),'Columbus Day');
  add(observed(`${y}-11-11`),'Veterans Day');
  add(nthDow(y,10,4,4),'Thanksgiving');
  add(observed(`${y}-12-25`),'Christmas');
  return holCache[y]=h;
}
function holidayName(s){const n=holidays(+s.slice(0,4))[s];return n&&!S.cfg.skipHolidays.includes(n)?n:null;}
let offSet=new Map();
function rebuildOff(){offSet=new Map();for(const o of S.daysoff){const k=o.date+'|'+o.person;offSet.set(k,o);}}
function dayOff(p,s){return offSet.get(s+'|'+p)||offSet.get(s+'|both')||null;}
function isWorkday(p,s){return S.cfg.people[p].days.includes(dow(s))&&!holidayName(s)&&!dayOff(p,s);}
function capacity(p,s){return isWorkday(p,s)?(+S.cfg.people[p].hours||0):0;}
function isBizDay(s){const w=dow(s);return w>0&&w<6&&!holidayName(s);}
function addBD(s,n){let d=s,c=0;while(c<n){d=addDays(d,1);if(isBizDay(d))c++;}return d;}

/* ============ derived figures ============ */
let IDX={};
function buildIndex(){
  const stageHours={},personDay={},fhWords={},fhBooth={},fhDay={};
  for(const l of S.logs){for(const e of (l.entries||[])){const h=+e.hours||0;
    if(e.titleId&&e.stageId){const k=e.titleId+'|'+e.stageId;stageHours[k]=(stageHours[k]||0)+h;}
    const pk=e.person+'|'+l.date;personDay[pk]=(personDay[pk]||0)+h;}}
  for(const f of S.fh){const k=f.titleId+'|'+f.person;fhWords[k]=(fhWords[k]||0)+(+f.words||0);fhBooth[k]=(fhBooth[k]||0)+(+f.boothHours||0);
    const dk=f.person+'|'+f.date;fhDay[dk]=(fhDay[dk]||0)+(+f.boothHours||0);}
  IDX={stageHours,personDay,fhWords,fhBooth,fhDay};
}
const tById=id=>S.titles.find(t=>t.id===id);
const hardDue=t=>!!(t&&t.kind!=='author'&&!t.ownProject&&t.due);
function liveWph(p){const since=addDays(TODAY,-30);let w=0,h=0;for(const f of S.fh)if(f.person===p&&f.date>=since&&f.date<=TODAY){w+=+f.words||0;h+=+f.boothHours||0;}return h>=3&&w>0?Math.round(w/h):null;}
function wphOf(p){return liveWph(p)||+S.cfg.people[p]?.wph||4000;}
function partWords(t){return (t.stages||[]).filter(s=>s.type==='record'||s.type==='ext').reduce((a,s)=>a+(+s.words||0),0);}
function titleFH(t){return +t.actualFH||+t.estFH||(partWords(t)/S.cfg.wordsPerFH)||0;}
function editorCost(t){const ed=(t.stages||[]).find(s=>s.type==='edit'&&s.owner==='outsourced');if(!ed)return 0;return +ed.cost>0?+ed.cost:(+S.cfg.editorRate||50)*titleFH(t);}
function payMode(t){return t.partnerPayMode||(t.category==='B'?'pct':'perword');}
function partnerPay(mode,v,gross,words){v=+v||0;return mode==='flat'?v:mode==='pct'?gross*v/100:words*v;}
function moneyOf(t){
  if(t.kind==='author')return {gross:0,partner:0,software:0,editor:0,net:0};
  const words=partWords(t);
  const gross=t.rateModel==='per2k'?(+t.rate||0)*words/2000:(+t.rate||0)*titleFH(t);
  const ext=(t.stages||[]).find(s=>s.type==='ext');
  let partner=0;
  if(t.category==='B'||t.category==='C')partner=partnerPay(payMode(t),t.category==='B'?(+t.partnerPct||50):payMode(t)==='flat'?+t.partnerFlat:payMode(t)==='pct'?+t.partnerPct:+t.partnerPerWord,gross,+ext?.words||0);
  const editor=editorCost(t), software=+t.software||0;
  return {gross,partner,software,editor,net:gross-partner-software-editor};
}
function loggedStage(t,s){return IDX.stageHours[t.id+'|'+s.id]||0;}
function estHours(t,s){
  const P=S.cfg.people[s.owner]||S.cfg.people.anne, fh=titleFH(t);
  switch(s.type){
    case 'record':return (+s.words||0)/wphOf(s.owner);
    case 'edit':return fh*(+P.editPerFH||1.5);
    case 'deliver':return +P.adminPerTitle||1;
    case 'pickups':return Math.max(1,fh*(+P.pickupsPerFH||.15));
    default:
      if(s.estHours!=null&&s.estHours!=='')return +s.estHours;
      if(s.type==='draft')return (+t.targetWords||0)/(+P.writeWph||1000)||20;
      return +S.cfg.authorHours[s.type]||8;
  }
}
function remainingHours(t,s){
  if(s.done)return 0;
  const est=estHours(t,s), logged=loggedStage(t,s);
  let rem;
  if(s.type==='record'){
    const wd=IDX.fhWords[t.id+'|'+s.owner]||0;
    const wph=wphOf(s.owner);
    rem=wd>0?Math.max(0,(+s.words||0)-wd)/wph:est-logged;
  } else rem=est-logged;
  if(rem<=0.01)rem=Math.max(est*.15,.5);
  return rem;
}
function isStarted(t){return (t.stages||[]).some(s=>s.done||loggedStage(t,s)>0||(s.type==='record'&&(IDX.fhWords[t.id+'|'+s.owner]||0)>0));}
function hoursOn(p,s){return IDX.personDay?.[p+'|'+s]||0;}

/* ============ scheduler ============ */
function subBD(s,n){let d=s,c=0;while(c<n){d=addDays(d,-1);if(isBizDay(d))c++;}return d;}
function targetOf(t){return hardDue(t)?subBD(t.due,+S.cfg.weekEarly||5):null;}
function simulate(extra,opts={}){
  const cfg=S.cfg;
  const titles=S.titles.filter(t=>t.status==='active');
  if(extra)titles.push(extra);
  const star=opts.noStar?null:(titles.find(t=>t.starred&&t.kind!=='author')||null);
  const protect=opts.protect||{};
  const st=[],byKey={};
  for(const t of titles){(t.stages||[]).forEach((s,i)=>{
    const o={t,s,i,k:t.id+'|'+s.id,cap:(s.owner==='anne'||s.owner==='jack')&&s.type!=='ext',rem:0,est:0,finish:null,start:null,workDone:null,pre:false};
    if(s.done)o.finish=s.doneDate||addDays(TODAY,-1);
    else if(o.cap){o.rem=remainingHours(t,s);o.est=Math.max(estHours(t,s),o.rem);}
    o.pre=!!(s.done||loggedStage(t,s)>0||(s.type==='record'&&(IDX.fhWords[t.id+'|'+s.owner]||0)>0));
    st.push(o);byKey[o.k]=o;});}
  const deps=o=>(o.s.after||[]).map(id=>byKey[o.t.id+'|'+id]).filter(Boolean);
  // tandem layout for audio projects: fewer-words narrator starts first, editing rides along behind
  const tand={};
  for(const t of titles){if(t.kind==='author')continue;
    const recs=st.filter(o=>o.t===t&&(o.s.type==='record'||o.s.type==='ext'));
    const sorted=recs.slice().sort((a,b)=>(+a.s.words||0)-(+b.s.words||0));
    tand[t.id]={recs,minor:sorted.length>1?sorted[0]:null,main:sorted.at(-1)||null,head:(t.headStart===''||t.headStart==null)?(+cfg.headStart||0):+t.headStart};}
  let curD=TODAY;
  const recFrac=t=>{const T=tand[t.id];let tw=0,dw=0;for(const o of T.recs){const w=+o.s.words||0;tw+=w;
      if(o.finish&&o.finish<=curD)dw+=w;else if(o.cap&&o.est>0)dw+=w*Math.max(0,1-o.rem/o.est);}return tw?dw/tw:1;};
  const lastRec=t=>{const T=tand[t.id];if(!T||!T.recs.length)return TODAY;if(T.recs.some(o=>!o.finish))return null;return maxDate(T.recs.map(o=>o.finish));};
  const secondStart=t=>{const m=tand[t.id]?.main;if(!m)return '0000-00-00';if(m.pre)return '0000-00-00';return m.start;};
  const isTandemEdit=o=>o.s.type==='edit'&&o.t.kind!=='author'&&!!tand[o.t.id];
  const editAvail=(o,d)=>{const lr=lastRec(o.t);if(lr&&lr<=d)return o.rem;return o.est*recFrac(o.t)-(o.est-o.rem);};
  const started={};titles.forEach(t=>started[t.id]=isStarted(t));
  const tier=(t,d)=>protect[t.id]&&d>=protect[t.id]?-2:(star&&t.id===star.id?-1:(t.kind==='author'?2:(t.ownProject?1:0)));
  const cmpFor=d=>{const key=o=>[tier(o.t,d),started[o.t.id]?0:1,o.t.due||'9999-12-31',o.s.type==='pickups'?0:1,o.i];
    return (a,b)=>{const A=key(a),B=key(b);for(let i=0;i<A.length;i++){if(A[i]<B[i])return -1;if(A[i]>B[i])return 1;}return 0;};};
  const ready=(o,d)=>{
    if(isTandemEdit(o)){const T=tand[o.t.id];const own=T.recs.find(r=>r.s.type==='record'&&r.s.owner===o.s.owner);
      if(own){if(!own.finish||own.finish>d)return false;}
      else{const ss=secondStart(o.t);if(!ss)return false;if(ss!=='0000-00-00'&&addBD(ss,+cfg.editLag||2)>d)return false;}
      const lr=lastRec(o.t);if(lr&&lr<=d)return o.rem>0.001;return editAvail(o,d)>0.24;}
    if(o.s.type==='record'&&tand[o.t.id]){const T=tand[o.t.id];
      if(o===T.main&&T.minor&&T.minor.cap&&!T.minor.pre&&T.head>0){if(!T.minor.start)return false;if(addBD(T.minor.start,T.head)>d)return false;}
      return true;}
    const ds=deps(o);if(ds.some(x=>!x.finish||x.finish>d))return false;
    if(o.s.type==='pickups'){const del=ds[0];if(del&&addBD(del.finish,cfg.pickupDelay)>d)return false;}return true;};
  const alloc={};const loggedToday=p=>S.logs.some(l=>l.date===TODAY&&(l.entries||[]).some(e=>e.person===p));const logged={anne:loggedToday('anne'),jack:loggedToday('jack')};
  let d=TODAY;const horizon=addDays(TODAY,450);
  while(st.some(o=>!o.finish)&&d<=horizon){
    curD=d;
    let ch=true;while(ch){ch=false;for(const o of st){if(o.finish)continue;
      if(o.cap){if(o.workDone&&isTandemEdit(o)){const lr=lastRec(o.t);if(lr){o.finish=maxDate([o.workDone,addBD(lr,+cfg.tailIn||2)]);ch=true;}}continue;}
      if(isTandemEdit(o)){const lr=lastRec(o.t);if(!lr)continue;let f=addBD(lr,+cfg.tailOut||4);if(f<TODAY)f=TODAY;o.finish=f;ch=true;continue;}
      const ds=deps(o);if(ds.some(x=>!x.finish))continue;
      let f;if(o.s.type==='ext'){f=o.s.extDate||addBD(TODAY,10);}else{const sd=ds.length?maxDate(ds.map(x=>x.finish)):TODAY;o.start=sd;f=addBD(sd,+o.s.turnaround||cfg.editorDays);}
      if(f<TODAY)f=TODAY;o.finish=f;ch=true;}}
    const cmp=cmpFor(d);
    const cmpRest=(a,b)=>((a.t.kind==='author'?0:1)-(b.t.kind==='author'?0:1))||cmp(a,b);
    // One title in the booth per person per day. When that recording wraps early,
    // the rest of the day goes to writing first, then other non-booth work.
    for(const p of PEOPLE){let cap=capacity(p,d);if(d===TODAY&&logged[p])cap=0;let g=0,booth=null,boothDone=false;
      while(cap>0.01&&g++<60){const r=st.filter(o=>o.cap&&!o.finish&&!o.workDone&&o.rem>0.001&&o.s.owner===p&&ready(o,d)&&!(o.s.type==='record'&&(boothDone||(booth&&booth!==o.t.id)))).sort(boothDone?cmpRest:cmp);if(!r.length)break;
        const o=r[0];let h=Math.min(cap,o.rem);if(isTandemEdit(o))h=Math.min(h,Math.max(0,editAvail(o,d)));if(h<=0.01)break;
        (alloc[d]=alloc[d]||[]).push({p,tid:o.t.id,sid:o.s.id,type:o.s.type,h});
        o.rem-=h;cap-=h;if(!o.start)o.start=d;
        if(o.rem<=0.001){if(isTandemEdit(o)){o.workDone=d;const lr=lastRec(o.t);if(lr)o.finish=maxDate([d,addBD(lr,+cfg.tailIn||2)]);}else o.finish=d;}
        if(o.s.type==='record'){booth=o.t.id;if(o.finish)boothDone=true;}}}
    d=addDays(d,1);
  }
  const out={};
  for(const t of titles){
    const sts=st.filter(o=>o.t===t);
    const del=sts.find(o=>o.s.type==='deliver');
    const finish=t.kind==='author'?maxDate(sts.filter(o=>o.s.type!=='market').map(o=>o.finish||'9999-12-31')):(del?.finish||null);
    const target=targetOf(t);
    const hoursAfter=lim=>{let h=0;if(!lim)return 0;for(const [day,list] of Object.entries(alloc))if(day>lim)for(const a of list)if(a.tid===t.id&&a.type!=='pickups'&&a.type!=='market')h+=a.h;return h;};
    const late=!!(hardDue(t)&&finish&&finish>t.due), amber=!!(hardDue(t)&&finish&&!late&&finish>target);
    const invoice=t.invoiceDate||(del?.s.done?del.s.doneDate:null)||del?.finish||null;
    out[t.id]={finish,target,late,amber,ot:hoursAfter(t.due),otTarget:hoursAfter(target),check:t.kind==='author'?null:(t.checkDate||(invoice?addBD(invoice,clearDaysFor(t.client)):null)),checkActual:!!t.checkDate,started:started[t.id]};
  }
  return {alloc,byKey,out,st,star};
}
// The star gets every whole day it can use, except the days another title needs to hit its target.
function plan(){
  let res=simulate();
  const star=res.star;res.protections=[];if(!star)return res;
  const free=simulate(null,{noStar:true});
  let protect={};const goals={};
  for(let guard=0;guard<8;guard++){
    // only titles the star actually pushes back: past their aim now, and later than they'd be without the star
    const victims=S.titles.filter(t=>{if(t.status!=='active'||t.id===star.id||!hardDue(t)||protect[t.id])return false;
      const now=res.out[t.id]?.finish,was=free.out[t.id]?.finish,tg=targetOf(t);
      return now&&was&&now>tg&&now>was;}).sort((a,b)=>a.due.localeCompare(b.due));
    if(!victims.length)break;
    const v=victims[0],tg=targetOf(v),was=free.out[v.id].finish,goal=was<=tg?tg:was;goals[v.id]=goal;
    const tryK=k=>{const p={...protect,[v.id]:k?addBD(TODAY,k):TODAY};const r=simulate(null,{protect:p});return {r,p,ok:!!(r.out[v.id]?.finish&&r.out[v.id].finish<=goal)};};
    let best=tryK(0);
    if(best.ok){let L=0,H=Math.max(0,bdBetween(TODAY,goal));while(L<H){const m=Math.ceil((L+H)/2);const r=tryK(m);if(r.ok){L=m;best=r;}else H=m-1;}}
    protect=best.p;res=best.r;
  }
  res.protections=Object.entries(protect).map(([tid,from])=>({tid,from,aim:goals[tid]===targetOf(tById(tid))}));
  res.star=star;return res;
}

/* ============ data access ============ */
// The Lamp Room keeps these as files in the shared Library (one per record), not in a hosted database.
async function put(coll,id,data){if(coll==='members')return true;try{await Store.llPut(coll,id,data);syncS();afterSave(coll,id);rerender();return true;}catch(e){toast("Couldn't save: "+e.message);return false;}}
async function patch(coll,id,data){try{await Store.llPatch(coll,id,data);syncS();afterSave(coll,id);rerender();return true;}catch(e){toast("Couldn't save: "+e.message);return false;}}
async function del(coll,id){try{await Store.llDel(coll,id);syncS();rerender();}catch(e){toast("Couldn't delete: "+e.message);}}
function errMsg(e){const c=e?.code;if(c==='invalid_argument')return "That change wasn't saved: your access to this page may be view-only.";
  if(c==='quota_exceeded')return 'The ledger is full. Delete some old log entries.';if(c==='resource_exhausted')return 'Too many changes at once. Try again in a moment.';
  return "Couldn't save just now. Try again.";}
async function saveCfg(partial){if(await Store.refreshRecord('config'))syncS();const next={...(S.cfgDoc||{}),...partial};S.cfgDoc=next;S.cfg=mergeCfg(next);rerender();await put('config','main',next);}
const toast=m=>window.toast(m);

/* ============ learning ============ */
async function learnFromStage(t,s,doneDate){
  const P=structuredClone(S.cfgDoc?.people||{});const blend=(o,n)=>o==null?n:Math.round((o*.5+n*.5)*100)/100;
  const fh=titleFH(t);const h=loggedStage(t,s);const p=s.owner;const cur=S.cfg.people[p]||{};
  P[p]=P[p]||{};let changed=false;
  if(s.type==='record'&&(p==='anne'||p==='jack')){const booth=IDX.fhBooth[t.id+'|'+p]||h;if(booth>=1&&s.words){P[p].wph=Math.round(blend(cur.wph,s.words/booth));changed=true;}}
  if(s.type==='edit'&&(p==='anne'||p==='jack')&&h>=1&&fh>0){P[p].editPerFH=blend(cur.editPerFH,h/fh);changed=true;}
  if(s.type==='pickups'&&(p==='anne'||p==='jack')&&h>0&&fh>0){P[p].pickupsPerFH=blend(cur.pickupsPerFH,h/fh);changed=true;}
  if(s.type==='deliver'&&(p==='anne'||p==='jack')&&h>0){P[p].adminPerTitle=blend(cur.adminPerTitle,h);changed=true;}
  let extra={};
  if(s.type==='edit'&&s.owner==='outsourced'){const deps=(s.after||[]).map(id=>t.stages.find(x=>x.id===id)).filter(x=>x?.doneDate);
    if(deps.length){const st=maxDate(deps.map(x=>x.doneDate));let n=0,d=st;while(d<doneDate){d=addDays(d,1);if(isBizDay(d))n++;}if(n>0)extra.editorDays=Math.max(1,Math.round(blend(S.cfg.editorDays,n)));}}
  if(t.kind==='author'&&h>0&&s.type!=='draft'){extra.authorHours={...(S.cfgDoc?.authorHours||{}),[s.type]:blend(S.cfg.authorHours[s.type],h)};}
  if(t.kind==='author'&&s.type==='draft'&&h>=1&&t.targetWords){P[p].writeWph=Math.round(blend(cur.writeWph,t.targetWords/h));changed=true;}
  if(changed||Object.keys(extra).length)await saveCfg({...(changed?{people:P}:{}),...extra});
}
async function setStageDone(tid,sid,done,date){
  if(await Store.refreshRecord('titles',tid))syncS(); // the Writing Desk may have ticked a stage since we read it
  const t=tById(tid);if(!t)return;const date2=date||TODAY;
  const up=new Set([sid]);
  if(done){const walk=id=>{const x=t.stages.find(y=>y.id===id);for(const a of (x?.after||[]))if(!up.has(a)){up.add(a);walk(a);}};walk(sid);}
  const stages=t.stages.map(s=>s.id===sid?{...s,done,doneDate:done?date2:null}:(done&&up.has(s.id)&&!s.done?{...s,done:true,doneDate:date2}:s));
  const upd={stages};
  const s=stages.find(x=>x.id===sid);
  if(s.type==='deliver'&&done&&!t.invoiceDate)upd.invoiceDate=date2;
  if(s.type==='deliver'&&!done)upd.invoiceDate=null;
  await patch('titles',tid,upd);
  if(done)await learnFromStage({...t,...upd},s,date2);
}

/* ============ render plumbing ============ */
let rq=0;function rerender(){if(rq)return;rq=requestAnimationFrame(()=>{rq=0;render();});}
function compute(){rebuildOff();buildIndex();try{S.sim=plan();}catch(e){console.error(e);S.sim={alloc:{},byKey:{},out:{},st:[]};}}
function render(){
  compute();
  if(!LLV.el||!document.body.contains(LLV.el)){LLV.onChange&&LLV.onChange();return;}
  const body={almanac:viewAlmanac,titles:()=>viewTitles()+'<div style="margin-top:34px">'+viewPipeline()+'</div>',pipeline:viewPipeline,worklog:viewLog,ledger:viewLedger,guide:viewGuide,setup:viewSettings}[S.tab]();
  LLV.el.innerHTML=body;
  afterRender();LLV.decorate&&LLV.decorate(LLV.el);
}
function bannerHTML(){
  if(S.offline)return `<div class="banner">The shared ledger can't be reached from this view. Open the page on claude.ai while signed in to see and save your data.</div>`;
  if(!S.loaded)return `<div class="banner">Fetching the ledger…</div>`;
  return '';
}
function renderWho(){
  const w=$('#who');
  if(!S.me){w.innerHTML='';return;}
  w.innerHTML=`<span class="muted">At the desk:</span> <b>${PNAME[S.me]}</b> <button class="lnk" data-act="switch-me">switch</button>`;
}
function titleColor(t){return t?.color||INKS[0];}
function shortOf(t){return t?.short||t?.name||'?';}

/* ============ ALMANAC ============ */
function viewAlmanac(){
  return `<div class="alm"><div class="side">${todayHTML()}${alertsHTML()}${quickLogHTML()}<div class="panel"><h3>The Year's Reckoning</h3><div class="muted" style="font-size:13px">Now on the <a href="#/goals">Goals</a> page, with your targets and charts.</div></div></div><div>${calendarHTML()}</div></div>`;
}
function nextAlloc(p){
  const days=Object.keys(S.sim.alloc).filter(d=>d>=TODAY).sort();
  for(const d of days){const l=S.sim.alloc[d].filter(a=>a.p===p);if(l.length)return {d,l};}
  return null;
}
function todayHTML(){
  const order=S.me?[S.me,partnerOf(S.me)]:PEOPLE;
  return order.map(p=>{
    const na=nextAlloc(p);const off=dayOff(p,TODAY);const hol=holidayName(TODAY);
    let head=na?(na.d===TODAY?'Today':'Next up · '+fmt(na.d)):'Nothing scheduled';
    let note='';
    if(na&&na.d!==TODAY){note=off?`<div class="muted">Day off today${off.reason?': '+esc(off.reason):''}.</div>`:hol?`<div class="muted">${esc(hol)}. Lamp's out.</div>`:!isWorkday(p,TODAY)?`<div class="muted">Not a workday.</div>`:''}
    const spent={};S.logs.filter(l=>l.date===TODAY).forEach(l=>(l.entries||[]).forEach(e=>{if(e.person!==p||!(+e.hours))return;
      const t=tById(e.titleId);const st=t?.stages.find(x=>x.id===e.stageId);const k=t?`${shortOf(t)} ${st?STAGE_SHORT[st.type]:''}`.trim():(e.kind==='admin'?'admin':e.kind==='other'?'no project work':(e.note||'other'));spent[k]=(spent[k]||0)+(+e.hours);}));
    const spentTxt=Object.entries(spent).map(([k,h])=>`${esc(k)} ${hrs(h)}`).join(' · ');
    const done=spentTxt?`<div class="spent"><span class="lbl">Today's work · ${hrs(hoursOn(p,TODAY))}</span>${spentTxt}</div>`:'';
    const grouped={};if(na)for(const a of na.l){const k=a.tid+'|'+a.sid;grouped[k]=(grouped[k]||0)+a.h;}
    const tasks=Object.entries(grouped).map(([k,h],i)=>{const [tid,sid]=k.split('|');const t=tById(tid);const s=t?.stages.find(x=>x.id===sid);if(!t||!s)return '';
      const o=S.sim.out[tid];const why=t.kind==='author'?'Filling a gap between paychecks':t.ownProject?`Our own project${t.due?' · target '+fmtShort(t.due):''} · forecast ${fmtShort(o?.finish)}`:`${t.starred?'⭐ Starred · ':''}Due ${fmtShort(t.due)} · aim ${fmtShort(o?.target)} · forecast ${fmtShort(o?.finish)}${o?.late?' · <b style="color:var(--overdue)">late</b>':o?.amber?' · <b style="color:var(--amber)">into the week</b>':''}`;
      return `<div class="task" style="border-color:${titleColor(t)}">${i===0?'<b>':''}${esc(t.name)}: ${esc(stageLabel(s))}${i===0?'</b>':''} <span class="muted num">~${hrs(h)}</span><div class="muted" style="font-size:13px">${why}</div></div>`;}).join('');
    const waits=waitingFor(p).map(w=>`<div class="muted" style="font-size:14px">⏳ ${w}</div>`).join('');
    const isMe=p===S.me;
    return `<div class="panel today-card" ${isMe?'':'style="opacity:.85"'}><div class="who-h"><h3>${PNAME[p]}${isMe?'':' <span style="font-size:13px">(partner)</span>'}</h3></div>${done}${note}<div class="focus">Focus on${na?' · '+(na.d===TODAY?'today':fmt(na.d)):''}</div>${tasks||'<div class="muted">Nothing scheduled. A clear desk.</div>'}${waits}</div>`;
  }).join('');
}
function entryChip(l,e,i){const t=tById(e.titleId);const s=t?.stages.find(x=>x.id===e.stageId);
  return `<span class="chip">${t?`<span class="swatch" style="background:${titleColor(t)}"></span>${esc(shortOf(t))} ${s?esc(STAGE_SHORT[s.type]):''}`:esc(e.note&&e.kind!=='work'?e.note.slice(0,28):(e.kind||'other'))} · ${PNAME[e.person]?.[0]||''} ${hrs(+e.hours||0)}${e.auto?'*':''}${e.finished?' ✓':''}</span>`;}
function stageLabel(s){return s.type==='record'?`Record (${PNAME[s.owner]||''})`:STAGE_LABEL[s.type]||s.type;}
function waitingFor(p){
  const res=[];
  for(const o of S.sim.st){if(o.finish&&o.finish<=TODAY&&o.s.done)continue;if(!o.cap||o.s.owner!==p||o.s.done||o.pre||(o.start&&o.start<=TODAY))continue;
    const ownRec=o.s.type==='edit'&&o.t.kind!=='author'&&(o.t.stages||[]).some(x=>x.type==='record'&&x.owner===o.s.owner);
    for(const id of (o.s.after||[])){const dep=S.sim.byKey[o.t.id+'|'+id];if(!dep||dep.s.done)continue;if(ownRec&&dep.s.owner!==o.s.owner)continue;
      if(dep.s.owner!==p){const whoTxt=dep.s.owner==='outsourced'?'the editor':dep.s.owner==='ext'?esc(o.t.partnerName||'the outside partner'):`${PNAME[dep.s.owner]}'s ${dep.s.type==='record'?'recording':STAGE_LABEL[dep.s.type].toLowerCase()}`;
        res.push(`${esc(shortOf(o.t))} ${STAGE_LABEL[o.s.type].toLowerCase()} waits on ${whoTxt}, forecast ${fmtShort(dep.finish)}`);}}
  }
  return [...new Set(res)].slice(0,3);
}
function alertsHTML(){
  const items=[];const dis=S.cfg.dismissed||{};
  const add=(key,cls,html)=>{if(!dis[key])items.push(`<div class="alert ${cls}"><button class="x" data-act="dismiss" data-k="${esc(key)}" aria-label="Dismiss" title="Dismiss">×</button>${html}</div>`);};
  for(const t of S.titles.filter(t=>t.status==='active'&&t.kind!=='author')){const o=S.sim.out[t.id];if(!o)continue;
    if(o.late){const daysLeft=Math.round((D(t.due)-D(TODAY))/864e5);
      add(`late:${t.id}:${o.finish}`,'',`<b>${esc(t.name)}</b> forecasts ${fmtShort(o.finish)}, past its ${fmtShort(t.due)} due date. ${daysLeft>=0?`About <b>${hrs(o.ot)}</b> of overtime makes the due date; <b>${hrs(o.otTarget)}</b> gets it back to the ${fmtShort(o.target)} aim.`:`Past due by ${-daysLeft} days.`}
      <div style="margin-top:4px"><button class="btn small" data-act="notice" data-id="${t.id}">Draft a client notice</button></div>`);}
    else if(o.amber)add(`amber:${t.id}:${o.finish}`,'amber',`<b>${esc(t.name)}</b> forecasts ${fmtShort(o.finish)}, past the ${fmtShort(o.target)} aim but still before its ${fmtShort(t.due)} due date. About <b>${hrs(o.otTarget)}</b> of overtime gets the week back.`);
    const ext=t.stages.find(s=>s.type==='ext'&&!s.done&&s.extDate&&s.extDate<TODAY);
    if(ext)add(`ext:${t.id}:${ext.extDate}`,'info',`${esc(t.partnerName||'Outside partner')}'s part of <b>${esc(shortOf(t))}</b> was expected ${fmtShort(ext.extDate)}.`);
  }
  for(const pr of (S.sim.protections||[])){const v=tById(pr.tid),st=S.sim.star;if(!v||!st)continue;
    add(`prot:${pr.tid}:${pr.from}`,'info',pr.aim?`⭐ <b>${esc(shortOf(st))}</b> is starred. <b>${esc(shortOf(v))}</b> gets whole days from ${fmtShort(pr.from)} so it still makes its ${fmtShort(targetOf(v))} aim.`:`⭐ <b>${esc(shortOf(st))}</b> is starred. <b>${esc(shortOf(v))}</b> gets whole days from ${fmtShort(pr.from)} so the star doesn't make it any later.`);}
  for(const o of billsOverdue())add(`billlate:${o.b.id}:${o.ym}:${TODAY}`,'',`🧾 <b>${esc(o.b.name)}</b> for ${monthName(o.ym)} is <b>${o.days} days late</b> (${money(o.amt)}, due ${fmtShort(o.due)}). <button class="lnk" data-act="bill-pop" data-id="${o.b.id}" data-ym="${o.ym}">Mark paid</button>`);
  if(S.me){
    let d=addDays(TODAY,-1),n=0;while(!isWorkday(S.me,d)&&n++<7)d=addDays(d,-1);
    if(isWorkday(S.me,d)&&!S.logs.some(l=>l.date===d&&(l.person===S.me||(l.entries||[]).some(e=>e.person===S.me)))&&d>='2026-11-12')
      add(`nolog:${S.me}:${d}`,'info',`No log for ${fmt(d)}. <button class="lnk" data-act="log-for" data-date="${d}">Add one</button>`);
  }
  for(const l of S.logs){const f=logFlag(l);if(f&&l.ot!=='confirmed'&&l.date>=addDays(TODAY,-14))
    add(`ot:${l.id}:${f.total}`,'info',`${fmt(l.date)}, ${PNAME[f.p]}: ${hrs(f.total)} logged against ${hrs(f.cap)} scheduled. Overtime, or is something generous?
    <div class="row" style="margin-top:4px"><button class="btn small" data-act="ot-ok" data-id="${l.id}">It was overtime</button><button class="btn small" data-act="log-edit" data-id="${l.id}">Let me fix it</button></div>`);}
  return items.length?`<div class="panel"><h3>Notices</h3>${items.join('')}</div>`:'';
}
function logFlag(l){
  const per={};for(const e of (l.entries||[])){per[e.person]=(per[e.person]||0)+(+e.hours||0);}
  for(const p of Object.keys(per)){const total=hoursOn(p,l.date)+0;const cap=capacity(p,l.date);if(total>cap+0.25)return {p,total,cap};}
  return null;
}
function quickLogHTML(){
  return `<div class="panel"><h3>Today I…</h3>
  <textarea id="qlog" class="in" rows="3" style="width:100%" placeholder="Edited MGIS9 ch 4–9, two hours of pickups on SAB1, finished EoD2 edits…"></textarea>
  <div class="row" style="margin-top:6px"><button class="btn mic" id="micbtn" data-act="mic" title="Dictate" aria-label="Dictate" ${S.dict?'':'hidden'}>🎙</button>
  <input type="date" id="qdate" class="in" value="${TODAY}" aria-label="Date of this log">
  <button class="btn" data-act="log-hand" style="margin-left:auto" title="Pick title, stage and hours yourself (today's booth time is filled in)">Log by hand</button><button class="btn primary" data-act="read-log">Read my note</button></div>
  <div class="muted" style="font-size:13px;margin-top:4px">Leave out hours and I'll split the day for you. Say "finished" and I'll check the stage off.</div></div>`;
}
function goalsHTML(){
  const y=+TODAY.slice(0,4);const g=yearTotals(y);const G=S.cfg.goals;
  const bar=(v,p,goal)=>`<div class="bar"><u style="width:${Math.min(100,(v+p)/goal*100)}%"></u><i style="width:${Math.min(100,v/goal*100)}%"></i></div>`;
  return `<div class="panel"><h3>The Year's Reckoning</h3>
  <div class="goal"><div class="row" style="justify-content:space-between"><span>Finished hours</span><span class="num">${g.fh.toFixed(1)} / ${G.fh}</span></div>${bar(g.fh,g.fhProj,G.fh)}</div>
  <div class="goal"><div class="row" style="justify-content:space-between"><span>Revenue (net)</span><span class="num">${money(g.rev)} / ${money(G.revenue)}</span></div>${bar(g.rev,g.revProj,G.revenue)}</div>
  <div class="muted" style="font-size:13px">Solid: received. Hatched: forecast by Dec 31 (+${g.fhProj.toFixed(1)} FH, +${money(g.revProj)}).</div>
  ${(()=>{const fh=g.fh+g.fhProj,rev=g.rev+g.revProj,gapF=G.fh-fh,gapR=G.revenue-rev;
    return `<div class="yearend"><span class="lbl">${y} forecast by Dec 31</span>
    <div class="row" style="justify-content:space-between"><span>Finished hours</span><b class="num">${fh.toFixed(1)} <span class="muted">(${Math.round(fh/G.fh*100)}% of goal)</span></b></div>
    <div class="row" style="justify-content:space-between"><span>Net revenue</span><b class="num">${money(rev)} <span class="muted">(${Math.round(rev/G.revenue*100)}% of goal)</span></b></div>
    <div class="muted" style="font-size:13px;margin-top:2px">${gapR>0?`${money(gapR)} and ${Math.max(0,gapF).toFixed(1)} FH short of this year's goals. Signed work only; pipeline titles aren't counted until committed.`:'On pace to meet this year\'s revenue goal.'}</div></div>`;})()}</div>`;
}
function yearTotals(y){
  const b=S.cfg.baseline?.year===y?S.cfg.baseline:{fh:0,revenue:0};
  let fh=+b.fh||0,rev=+b.revenue||0,fhProj=0,revProj=0;
  for(const t of S.titles){if(t.kind==='author')continue;const o=S.sim.out[t.id];const m=moneyOf(t);
    if(t.checkDate&&+t.checkDate.slice(0,4)===y){fh+=titleFH(t);rev+=ourCheck(t)-m.software-m.editor;}
    else if(!t.checkDate&&checkDateOf(t)&&+checkDateOf(t).slice(0,4)===y){fhProj+=titleFH(t);revProj+=m.net;}}
  for(const dp of S.deposits)if(dp.date&&+dp.date.slice(0,4)===y)rev+=+dp.amount||0;
  for(const f of royaltyForecasts(`${y}-01-01`,`${y}-12-31`))revProj+=f.amount;
  return {fh,rev,fhProj,revProj};
}

/* calendar */
function monthEvents(start,end){
  const ev={};const push=(d,x)=>{(ev[d]=ev[d]||[]).push(x);};
  for(const t of S.titles){if(t.kind==='author'||t.status==='pipeline')continue;const o=S.sim.out[t.id];const m=moneyOf(t);
    const cd=checkDateOf(t);
    if(t.due&&t.status==='active'&&t.due>=start&&t.due<=end)push(t.due,{k:'due',t});
    const tgt=t.status==='active'?targetOf(t):null;if(tgt&&tgt>=start&&tgt<=end)push(tgt,{k:'target',t});
    if(cd&&cd>=start&&cd<=end){push(cd,{k:'check',t,amt:netCheck(t),actual:!!t.checkDate});
      if(m.partner>0&&!t.partnerPaidByClient)push(t.partnerPaidDate||cd,{k:'payout',t,amt:m.partner,actual:!!t.partnerPaidDate});}}
  for(const dp of S.deposits)if(dp.date>=start&&dp.date<=end)push(dp.date,{k:'roy',dp,amt:+dp.amount||0,actual:true});
  for(const f of royaltyForecasts(start,end))push(f.date,{k:'roy',amt:f.amount,actual:false});
  for(const b of S.bills){if(b.active===false)continue;
    for(let ym=ymAdd(start.slice(0,7),-6);ym<=end.slice(0,7);ym=ymAdd(ym,1)){const p=b.paid?.[ym],due=billDue(b,ym),amt=billAmount(b,ym);
      if(p){const late=billLateDays(b,ym);if(p.date>=start&&p.date<=end)push(p.date,{k:'bill',b,ym,amt,paid:true,late});
        if(late&&due>=start&&due<=end&&due!==p.date)push(due,{k:'billghost',b,ym,paidOn:p.date});continue;}
      const over=due<TODAY&&ym>=trackFrom(b)&&billLateDays(b,ym);
      if(over){if(TODAY>=start&&TODAY<=end)push(TODAY,{k:'bill',b,ym,amt,paid:false,owed:true,late:billLateDays(b,ym)});
        if(due>=start&&due<=end)push(due,{k:'billghost',b,ym,late:billLateDays(b,ym)});continue;}
      if(due>=start&&due<=end)push(due,{k:'bill',b,ym,amt,paid:false});}}
  return ev;
}
function billMonthFor(b,date,named){
  if(named&&/^\d{4}-\d{2}$/.test(named))return named;
  const old=billsOverdue().filter(x=>x.b.id===b.id&&x.due<=date);if(old.length)return old[0].ym;
  // otherwise the unpaid one whose due date is nearest
  const ym=date.slice(0,7);const [y,m]=ym.split('-').map(Number);
  const cands=[-1,0,1].map(k=>iso(new Date(y,m-1+k,1,12)).slice(0,7));
  const exp=c=>{const last=new Date(+c.slice(0,4),+c.slice(5,7),0).getDate();return `${c}-${pad(Math.min(billExpectedDay(b),last))}`;};
  const open=cands.filter(c=>!b.paid?.[c]);const pool=open.length?open:cands;
  return pool.sort((a,c)=>Math.abs(D(exp(a))-D(date))-Math.abs(D(exp(c))-D(date)))[0];
}

const BILL_TRACK_FROM='2026-11';const LATE_GRACE=5;
function trackFrom(b){return b.trackFrom||BILL_TRACK_FROM;}
function ymAdd(ym,k){const [y,m]=ym.split('-').map(Number);return iso(new Date(y,m-1+k,1,12)).slice(0,7);}
function billDue(b,ym){const [y,m]=ym.split('-').map(Number);const last=new Date(y,m,0).getDate();return `${ym}-${pad(Math.min(billExpectedDay(b),last))}`;}
function billLateDays(b,ym){const p=b.paid?.[ym];const due=billDue(b,ym);const on=p?.date||(D(due)<D(TODAY)?TODAY:null);if(!on)return 0;const n=Math.round((D(on)-D(due))/864e5);return n>LATE_GRACE?n:0;}
// unpaid months, oldest first, from the month the bill is tracked from, whose due date has passed
function billsOverdue(){const out=[];for(const b of S.bills){if(b.active===false)continue;
  for(let ym=trackFrom(b);ym<=TODAY.slice(0,7);ym=ymAdd(ym,1)){if(b.paid?.[ym])continue;const due=billDue(b,ym);if(due<TODAY&&billLateDays(b,ym))out.push({b,ym,due,days:billLateDays(b,ym),amt:billAmount(b,ym)});}}
  return out.sort((a,c)=>a.due.localeCompare(c.due));}
function monthName(ym){return MON[+ym.slice(5,7)-1];}
function bdBetween(a,b){let n=0,d=a;while(d<b){d=addDays(d,1);if(isBizDay(d))n++;}return n;}
function clearDaysFor(client){
  // learned per client from checks marked received: invoice -> cleared, in business days (last 3)
  const xs=S.titles.filter(t=>t.client===client&&t.checkDate&&t.invoiceDate&&t.checkDate>=t.invoiceDate)
    .sort((a,b)=>a.checkDate.localeCompare(b.checkDate)).slice(-3).map(t=>bdBetween(t.invoiceDate,t.checkDate));
  return xs.length>=2?Math.round(xs.reduce((a,c)=>a+c,0)/xs.length):S.cfg.clearDays;
}
function invoiceOf(t){return t.invoiceDate||(t.stages||[]).find(s=>s.type==='deliver'&&s.done)?.doneDate||null;}
function ourCheck(t){
  // what we keep from the client's check, before software/editor costs; partner money is pass-through
  const m=moneyOf(t);const direct=!!t.partnerPaidByClient;
  if(t.checkDate&&+t.checkAmount)return direct?+t.checkAmount:(+t.checkAmount)-m.partner;
  return m.gross-m.partner;
}
function netCheck(t){const m=moneyOf(t);return ourCheck(t)-m.software-m.editor;}
function checkDateOf(t){if(t.kind==='author')return null;if(!t.checkDate&&moneyOf(t).gross<=0)return null;if(t.checkDate)return t.checkDate;const inv=invoiceOf(t);if(inv)return addBD(inv,clearDaysFor(t.client));return S.sim?.out?.[t.id]?.check||null;}
function royaltyModel(){
  // needs 3 deposits; amount = average of the last 3 months with royalties, day = average day of the last 3 deposits
  const ds=S.deposits.filter(d=>d.kind==='royalty'&&+d.amount>0&&d.date).sort((a,b)=>a.date.localeCompare(b.date));
  if(ds.length<3)return null;
  const byM={};ds.forEach(d=>{const m=d.date.slice(0,7);byM[m]=(byM[m]||0)+(+d.amount);});
  const months=Object.keys(byM).sort();const l3=months.slice(-3);
  const days=ds.slice(-3).map(d=>+d.date.slice(8,10));
  return {amount:Math.round(l3.reduce((a,m)=>a+byM[m],0)/l3.length),day:Math.round(days.reduce((a,c)=>a+c,0)/days.length),lastYm:months.at(-1)};
}
function royaltyForecasts(start,end){
  const m=royaltyModel();if(!m)return [];const out=[];
  let ym=start.slice(0,7);const endYm=end.slice(0,7);const cap=iso(new Date(+TODAY.slice(0,4),+TODAY.slice(5,7)+11,1,12)).slice(0,7);
  while(ym<=endYm&&ym<=cap){if(ym>m.lastYm){const [y,mo]=ym.split('-').map(Number);const d=`${ym}-${pad(Math.min(m.day,new Date(y,mo,0).getDate()))}`;
    if(d>=TODAY&&d>=start&&d<=end)out.push({date:d,amount:m.amount});}
    const [y,mo]=ym.split('-').map(Number);ym=iso(new Date(y,mo,1,12)).slice(0,7);}
  return out;
}
function billExpectedAmount(b){const xs=Object.keys(b.paid||{}).sort().slice(-3).map(k=>+b.paid[k].amount).filter(x=>x>0);return xs.length>=2?Math.round(xs.reduce((a,c)=>a+c,0)/xs.length*100)/100:+b.amount||0;}
function billExpectedDay(b){const ds=Object.entries(b.paid||{}).sort().filter(([k,x])=>x.date&&x.date.slice(0,7)===k&&!x.late).map(([k,x])=>+x.date.slice(8,10)).filter(Boolean).slice(-3);return ds.length>=2?Math.round(ds.reduce((a,c)=>a+c,0)/ds.length):+b.day;}
function billDate(b,ym){const p=b.paid?.[ym];if(p?.date)return p.date;return billDue(b,ym);}
function billAmount(b,ym){return +(b.paid?.[ym]?.amount??billExpectedAmount(b))||0;}
function unitsFor(start,end){
  // {date: {person: {tid: stageType}}}
  const u={};const set=(d,p,tid,type)=>{u[d]=u[d]||{};u[d][p]=u[d][p]||{};if(!u[d][p][tid])u[d][p][tid]=type;};
  for(const l of S.logs){if(l.date<start||l.date>end||l.date>=TODAY)continue;for(const e of (l.entries||[]))if(e.titleId&&tById(e.titleId))set(l.date,e.person,e.titleId,tById(e.titleId).stages.find(s=>s.id===e.stageId)?.type||'');}
  for(const [d,list] of Object.entries(S.sim.alloc)){if(d<start||d>end)continue;for(const a of list)set(d,a.p,a.tid,a.type);}
  if(TODAY>=start&&TODAY<=end)for(const l of S.logs.filter(l=>l.date===TODAY))for(const e of (l.entries||[]))if(e.titleId&&tById(e.titleId))set(TODAY,e.person,e.titleId,'');
  return u;
}
function calendarHTML(){
  const [y,m]=S.month.split('-').map(Number);
  const first=`${S.month}-01`;const lastD=iso(new Date(y,m,0,12));
  let gs=first;while(dow(gs)!==0)gs=addDays(gs,-1);
  let ge=lastD;while(dow(ge)!==6)ge=addDays(ge,1);
  const ev=monthEvents(gs,ge);const units=unitsFor(gs,ge);
  const me=S.me||'anne';const people=S.showPartner?[me,partnerOf(me)]:[me];
  // month sums
  let cin=0,cout=0;for(const [d,l] of Object.entries(ev)){if(d<first||d>lastD)continue;for(const x of l){if(x.k==='check'||x.k==='roy')cin+=x.amt;if(x.k==='bill')cout+=x.amt;}}
  const weeks=[];let ws=gs;while(ws<=ge){weeks.push(ws);ws=addDays(ws,7);}
  const legendTitles=S.titles.filter(t=>t.status==='active');
  let html=`<div class="cal-head"><button class="btn" data-act="mon" data-d="-1" aria-label="Previous month">‹</button><h2>${MON[m-1]} ${y}</h2><button class="btn" data-act="mon" data-d="1" aria-label="Next month">›</button>
  <button class="btn small" data-act="mon" data-d="0">This month</button>
  <label class="row" style="gap:4px;font-size:15px"><input type="checkbox" id="tgl-partner" ${S.showPartner?'checked':''}> Show ${PNAME[partnerOf(me)]}</label>
  <span class="cal-sum num">💰 in ${money(cin)} · 🧾 out ${money(cout)} · <b style="color:${cin-cout>=0?'var(--good)':'var(--overdue)'}">net ${money(cin-cout)}</b></span></div>
  <div class="legend">${legendTitles.map(t=>`<button class="chip" data-act="title-pop" data-id="${t.id}"><span class="swatch" style="background:${titleColor(t)}"></span>${t.starred?'⭐ ':''}${esc(shortOf(t))}</button>`).join('')}
  <span class="chip"><span class="swatch" style="background:repeating-linear-gradient(135deg,var(--amber) 0 3px,#9a5f12 3px 6px)"></span>Past the aim (week early)</span><span class="chip"><span class="swatch" style="background:var(--overdue)"></span>Past the due date</span>
  ${S.showPartner?`<span class="chip"><span class="swatch" style="background:#888;opacity:.35;outline:1px dashed #000"></span>${PNAME[partnerOf(me)]}</span>`:''}</div>
  <div class="cal"><div class="dows">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>`<div>${x}</div>`).join('')}</div>`;
  for(const w of weeks){
    const days=[...Array(7)].map((_,i)=>addDays(w,i));
    // runs
    const runs=[];
    for(const p of people){const tids=new Set();days.forEach(d=>Object.keys(units[d]?.[p]||{}).forEach(t=>tids.add(t)));
      for(const tid of tids){const t=tById(tid);if(!t)continue;let i=0;
        while(i<7){if(!units[days[i]]?.[p]?.[tid]){i++;continue;}let j=i;while(j+1<7&&units[days[j+1]]?.[p]?.[tid])j++;
          runs.push({p,t,c0:i,c1:j,kind:t.kind==='author'?'author':'narr',ghost:p!==me,first:units[days[i]][p][tid]});i=j+1;}}}
    const lanes={narr:[],author:[]};
    runs.sort((a,b)=>(a.ghost-b.ghost)||(a.c0-b.c0));
    for(const r of runs){const L=lanes[r.kind];let li=L.findIndex(end=>end<r.c0);if(li<0){li=L.length;L.push(-1);}L[li]=r.c1;r.lane=li;}
    const nH=lanes.narr.length*18,aH=lanes.author.length?lanes.author.length*18+12:0;
    const segs=[];
    for(const r of runs){const top=r.kind==='narr'?r.lane*18:nH+12+r.lane*18;
      // split by red
      const tg=targetOf(r.t);const zone=c=>(r.kind!=='narr'||!hardDue(r.t)||units[days[c]][r.p][r.t.id]==='pickups')?'':days[c]>r.t.due?'red':days[c]>tg?'amber':'';
      let c=r.c0;while(c<=r.c1){const z=zone(c),red=z==='red';let e=c;while(e+1<=r.c1&&zone(e+1)===z)e++;
        const label=c===r.c0?`${r.ghost?PNAME[r.p]+': ':''}${shortOf(r.t)}${r.first?' · '+(STAGE_SHORT[r.first]||''):''}`:(red?'past due':z==='amber'?'past target':'');
        segs.push(`<button class="bar-seg ${r.ghost?'ghost':''} ${z} ${r.kind==='author'?'author':''}" data-act="title-pop" data-id="${r.t.id}" style="left:calc(${c}*100%/7 + 3px);width:calc(${e-c+1}*100%/7 - 6px);top:${top}px;background:${titleColor(r.t)}" title="${esc(r.t.name)}">${esc(label)}</button>`);c=e+1;}}
    const spacer=nH+aH+(nH+aH?4:0);
    html+=`<div class="week">`;
    for(const d of days){
      const out=d.slice(0,7)!==S.month;const off=dayOff(me,d);const hol=holidayName(d);const we=!S.cfg.people[me].days.includes(dow(d));
      const marks=(ev[d]||[]).map(x=>{
        if(x.k==='target')return `<button class="mk tgt" data-act="title-pop" data-id="${x.t.id}" title="Aim to deliver by here, a week before it's due">◇ ${esc(shortOf(x.t))} aim</button>`;
        if(x.k==='due')return `<button class="mk due" data-act="title-pop" data-id="${x.t.id}" style="color:${S.sim.out[x.t.id]?.late?'var(--overdue)':titleColor(x.t)}">⚑ ${esc(shortOf(x.t))} ${hardDue(x.t)?'due':'target'}</button>`;
        if(x.k==='check')return `<button class="mk num ${x.actual?'paid':''}" data-act="check-pop" data-id="${x.t.id}" title="Net: the check minus partner share, software and editor. Click for the breakdown.">💰 <span class="amt">${money(x.amt)}</span>${x.actual?' <span class="pstamp">In</span>':''}</button>`;
        if(x.k==='roy')return x.actual?`<button class="mk num paid" data-act="roy-pop" data-id="${x.dp.id}">💰 <span class="amt">${money(x.amt)}</span> <span class="pstamp">R</span></button>`:`<button class="mk num" data-act="roy-pop" style="font-style:italic;opacity:.8" title="Forecast from recent royalties">💰 ~${money(x.amt)} royalties</button>`;
        if(x.k==='payout')return `<button class="mk num ${x.actual?'paid':''}" data-act="check-pop" data-id="${x.t.id}" style="opacity:.7;font-style:italic" title="Partner's share passes through; not counted in totals">↪ <span class="amt">${esc(x.t.partnerName||'Partner')} ${money(x.amt)}</span>${x.actual?' <span class="pstamp">Paid</span>':''}</button>`;
        if(x.k==='bill'){const lbl=x.owed||x.late?' <span class="muted">('+monthName(x.ym)+')</span>':'';return `<button class="mk num ${x.paid?'paid':''} ${x.owed?'billlate':''}" data-act="bill-pop" data-id="${x.b.id}" data-ym="${x.ym}" title="${x.owed?monthName(x.ym)+"'s bill, "+x.late+' days late. Click to mark paid.':x.paid?(x.late?'Paid '+x.late+' days late. ':'Paid. ')+'Click to undo.':'Click to mark paid'}">🧾 <span class="amt">${esc(x.b.name)}${lbl} ${money(x.amt)}</span>${x.owed?' <span class="pstamp late">Late</span>':x.paid?` <span class="pstamp">${x.late?'Paid late':'Paid'}</span>`:''}</button>`;}
        if(x.k==='billghost')return `<button class="mk ghost" data-act="bill-pop" data-id="${x.b.id}" data-ym="${x.ym}" title="${x.paidOn?'Paid late, on '+fmt(x.paidOn):'Not paid yet: '+x.late+' days late'}">🧾 ${esc(x.b.name)} ${x.paidOn?'→ paid '+fmtShort(x.paidOn):'<span class="late">late</span>'}</button>`;
        return '';}).join('');
      html+=`<div class="day ${out?'out':''} ${(off||hol||we)?'off':''} ${d===TODAY?'today':''}"><div class="dn"><b>${+d.slice(8)}</b>${hol?`<span class="hol">${esc(hol)}</span>`:off?`<span class="hol">${off.person==='both'?'Both off':PNAME[off.person]+' off'}</span>`:''}</div><div style="height:${spacer}px;flex:none"></div><div class="marks">${marks}</div></div>`;
    }
    html+=`<div class="bars">${lanes.author.length?`<span class="band-label" style="top:${nH}px">author work</span>`:''}${segs.join('')}</div></div>`;
  }
  html+=`</div>`;
  return html;
}

/* ============ TITLES ============ */
function viewTitles(){
  const act=S.titles.filter(t=>t.status==='active').sort((a,b)=>(a.kind===b.kind?0:a.kind==='author'?1:-1)||(a.due||'9999').localeCompare(b.due||'9999'));
  const done=S.titles.filter(t=>t.status==='done').sort((a,b)=>(b.invoiceDate||'').localeCompare(a.invoiceDate||''));
  return `<div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>The Catalog</h2><div class="row"><button class="btn primary" data-act="new-title" data-kind="narration">New audio project</button><button class="btn" data-act="new-title" data-kind="author">New book</button></div></div>
  ${(()=>{const au=act.filter(t=>t.kind!=='author'),wr=act.filter(t=>t.kind==='author');
    if(!act.length)return '<p class="muted">No signed titles yet. Add one, or commit one from the Pipeline.</p>';
    return `<h3 class="kind-h">🎙 Audio projects <span>${au.length}</span></h3><div class="cards">${au.map(cardHTML).join('')||'<p class="muted">None in progress.</p>'}</div>`+
      (wr.length?`<h3 class="kind-h" style="margin-top:26px">✒ Writing projects <span>${wr.length}</span></h3><div class="cards">${wr.map(cardHTML).join('')}</div>`:'');})()}
  ${done.length?`<h3 style="margin-top:24px">Finished titles</h3><table class="led"><thead><tr><th>Title</th><th>Delivered</th><th class="r">FH</th><th class="r">Hours</th><th class="r">Real ratio</th><th class="r">Net</th><th class="r">Per hour</th><th>Check</th></tr></thead><tbody>
  ${done.map(t=>{const r=titleReal(t);return `<tr><td><span class="swatch" style="background:${titleColor(t)}"></span> ${esc(t.name)}</td><td>${fmtShort(t.invoiceDate)}</td><td class="r num">${titleFH(t).toFixed(2)}</td><td class="r num">${hrs(r.hours)}</td><td class="r num">${r.ratio?r.ratio.toFixed(1)+':1':'—'}</td><td class="r num">${money(r.net)}</td><td class="r num">${r.hourly?money2(r.hourly):'—'}</td><td style="white-space:nowrap">${t.kind!=='author'?(t.checkDate?'<span class="pstamp">In</span> ':`<button class="lnk" data-act="check-pop" data-id="${t.id}">💰 ${fmtShort(checkDateOf(t))}</button> `):''}<button class="lnk" data-act="edit-title" data-id="${t.id}">open</button> · <button class="lnk" data-act="reopen" data-id="${t.id}">reopen</button></td></tr>`;}).join('')}</tbody></table>`:''}`;
}
function titleReal(t){let a=0,j=0;for(const l of S.logs)for(const e of (l.entries||[]))if(e.titleId===t.id){if(e.person==='anne')a+=+e.hours||0;else j+=+e.hours||0;}
  const pa=+t.priorHours?.anne||0,pj=+t.priorHours?.jack||0;a+=pa;j+=pj;
  const hours=a+j;const fh=titleFH(t);const net=t.kind==='author'?0:(t.checkDate||moneyOf(t).gross>0?netCheck(t):0);
  return {anne:a,jack:j,prior:pa+pj,hours,ratio:fh&&hours?hours/fh:0,hourly:hours?net/hours:0,net};}
function cardHTML(t){
  const o=S.sim.out[t.id]||{};const m=moneyOf(t);const r=titleReal(t);
  const stamp=!hardDue(t)?(o.finish&&o.finish<'9999'?`<span class="stamp wait">${t.kind==='author'?'ready':'done'} ~${fmtShort(o.finish)}</span>`:''):o.late?`<span class="stamp over">Overdue · ${fmtShort(o.finish)}</span>`:o.amber?`<span class="stamp amb">Into the week · ${fmtShort(o.finish)}</span>`:`<span class="stamp ok">On aim · ${fmtShort(o.finish)}</span>`;
  const stg=(t.stages||[]).map(s=>{const lg=loggedStage(t,s);const est=s.owner==='anne'||s.owner==='jack'?estHours(t,s):null;
    const who=s.owner==='outsourced'?'editor':s.owner==='ext'?(t.partnerName||'partner'):PNAME[s.owner]||'';
    const end=S.sim.byKey[t.id+'|'+s.id]?.finish;
    return `<button class="stg ${s.done?'done':''}" data-act="stage" data-id="${t.id}" data-sid="${s.id}" title="${s.done?'Done '+fmtShort(s.doneDate)+'. Click to reopen.':'Forecast '+fmtShort(end)+'. Click to mark done.'}">${esc(s.type==='record'?'Rec':STAGE_LABEL[s.type])} <span class="h">${esc(who)}${est!=null?` ${lg?hrs(lg)+'/':''}${hrs(est)}`:''}${s.type==='record'&&s.words?' · '+Math.round(s.words/1000)+'k':''}</span></button>`;}).join('');
  return `<div class="ccard"><div class="row" style="justify-content:space-between"><h4>${t.kind!=='author'?`<button class="starbtn ${t.starred?'on':''}" data-act="star" data-id="${t.id}" title="${t.starred?'Unstar':'Star: work this first, deadlines permitting'}" aria-label="${t.starred?'Unstar':'Star'} this title">${t.starred?'★':'☆'}</button>`:''}<span class="swatch" style="background:${titleColor(t)};width:16px;height:16px"></span>${esc(t.name)}</h4>${stamp}</div>
  <div class="meta">${t.kind==='author'?(t.series?esc(t.series)+(t.seriesNo!=null?' #'+t.seriesNo:'')+' · ':'')+'Author work · '+(t.publisher&&t.publisher!==t.writer?`${PNAME[t.writer]} writes, ${PNAME[t.publisher]} publishes`:esc(PNAME[t.writer]||'')):esc(t.client||'')+' · '+esc(CAT[t.category]||'')}${t.due?` · ${hardDue(t)?'due':'target'} <span style="font-family:var(--f-type)">${fmtShort(t.due)}</span>${hardDue(t)?` · aim <span style="font-family:var(--f-type)">${fmtShort(targetOf(t))}</span>`:''}`:''}</div>
  <div class="stages">${stg}</div>
  ${t.kind==='author'?`<div class="muted" style="font-size:14px">${t.targetWords?Number(t.targetWords).toLocaleString()+' words target · ':''}${hrs(r.hours)} logged</div>`:
  (m.gross<=0&&!t.checkDate)?`<div class="muted" style="font-size:14px">No check: paid in royalties.${m.software||m.editor?` Costs ${money(m.software+m.editor)}.`:''}</div><div class="muted" style="font-size:13px;margin-top:4px">Logged: Anne ${hrs(r.anne)}, Jack ${hrs(r.jack)}</div>`:
  `<table class="money num"><tr><td>Check (${t.rateModel==='per2k'?money(t.rate)+' / 2k words':money(t.rate)+'/FH × '+titleFH(t).toFixed(2)+' FH'})</td><td>${money(m.gross)}</td></tr>
  ${m.partner?`<tr><td>${esc(t.partnerName||'Partner')}'s share${t.partnerPaidByClient?' (client pays them)':' (passed on)'}</td><td>−${money(m.partner)}</td></tr>`:''}
  ${m.software?`<tr><td>Software</td><td>−${money(m.software)}</td></tr>`:''}${m.editor?`<tr><td>Editor</td><td>−${money(m.editor)}</td></tr>`:''}
  <tr class="tot"><td>Net · 💰 ${t.checkDate?'received '+fmtShort(t.checkDate):'expected '+fmtShort(checkDateOf(t))}</td><td>${money(m.net)}</td></tr></table>
  <div class="muted" style="font-size:13px;margin-top:4px">Logged: Anne ${hrs(r.anne)}, Jack ${hrs(r.jack)}${r.prior?` (incl. ${hrs(r.prior)} before tracking)`:''}${r.ratio?` · running ${r.ratio.toFixed(1)}:1`:''}</div>`}
  <div class="row" style="margin-top:8px"><button class="btn small" data-act="edit-title" data-id="${t.id}">Edit</button>
  ${(()=>{const x=(t.stages||[]).find(s=>s.type==='ext'&&!s.done);return x?`<button class="btn small" data-act="stage" data-id="${t.id}" data-sid="${x.id}">${esc(t.partnerName||'Partner')}'s lines are in</button>`:'';})()}
  ${t.kind!=='author'&&!t.checkDate&&m.gross>0?`<button class="btn small" data-act="check-recv" data-id="${t.id}">Check received</button>`:''}
  ${m.partner&&!t.partnerPaidByClient&&t.checkDate&&!t.partnerPaidDate?`<button class="btn small" data-act="partner-paid" data-id="${t.id}">Partner paid</button>`:''}
  <button class="btn small" data-act="archive" data-id="${t.id}" style="margin-left:auto">${t.kind==='author'?'Mark published':'File as finished'}</button></div><div class="hole"></div></div>`;
}

/* title form */
function nextInk(){const used=new Set(S.titles.filter(t=>t.status==='active').map(t=>t.color));return INKS.find(c=>!used.has(c))||INKS[S.titles.length%INKS.length];}
function titleForm(t,kind){
  t=t||{kind,status:'active',color:nextInk()};kind=t.kind||kind;
  const st=id=>(t.stages||[]).find(s=>s.id===id);
  const edit=st('edit');
  if(kind==='author'){
    const cur=(t.stages||[]).find(s=>!s.done)?.type||'outline';
    return modal(`<h2>${t.id?'Edit':'New'} book</h2>
    <div class="grid2"><label class="f">Title<input id="f-name" value="${esc(t.name||'')}"></label><label class="f">Short name<input id="f-short" value="${esc(t.short||'')}" placeholder="e.g. PD2"></label></div>
    ${(()=>{const own=k=>(t.stages||[]).find(x=>x.id==='a-'+k)?.owner;const w=t.writer||own('draft')||S.me||'anne';const ed=own('aedit')||w;const pub=t.publisher||own('publish')||w;const edS=(t.stages||[]).find(x=>x.id==='a-aedit');
      const sel=(id,v,opts)=>`<select id="${id}">${opts.map(p=>`<option value="${p}" ${v===p?'selected':''}>${p==='outsourced'?'Outsourced editor':PNAME[p]}</option>`).join('')}</select>`;
      return `<div class="grid4" style="margin-top:8px"><label class="f">Writes (outline, draft, revise)${sel('f-writer',w,PEOPLE)}</label>
      <label class="f">Edits${sel('f-aed',ed,['anne','jack','outsourced'])}</label>
      <label class="f">Editor turnaround (workdays)<input id="f-aet" type="number" value="${esc(edS?.turnaround||'')}" placeholder="${S.cfg.editorDays}"></label>
      <label class="f">Publishes (cover, publish, market)${sel('f-pub',pub,PEOPLE)}</label></div>`;})()}
    <div class="grid4" style="margin-top:8px"><label class="f">Target words<input id="f-tw" type="number" value="${esc(t.targetWords||'')}"></label>
    <label class="f">Current stage<select id="f-cur">${AUTHOR_KEYS.map(k=>`<option value="${k}" ${cur===k?'selected':''}>${STAGE_LABEL[k]}</option>`).join('')}</select></label>
    <label class="f">Target publish date<input id="f-due" type="date" value="${esc(t.due||'')}"></label></div>
    <div class="grid3" style="margin-top:8px"><label class="f">Series<input id="f-series" value="${esc(t.series||'')}" list="series-list" placeholder="e.g. Dead Air Repo"></label>
    <label class="f">Book # in series<input id="f-seriesno" type="number" step="0.5" value="${esc(t.seriesNo??'')}"></label>
    <label class="f">Pen name (optional)<input id="f-pen" value="${esc(t.penName||'')}"></label></div>
    <fieldset style="border:1px solid var(--rule);margin-top:10px;padding:8px"><legend class="muted">Hours worked before tracking (added to logged hours for real ratio and hourly rate)</legend><div class="grid2">
   <label class="f">Anne<input id="f-pa" type="number" step="0.25" min="0" value="${esc(t.priorHours?.anne??'')}" placeholder="0"></label>
   <label class="f">Jack<input id="f-pj" type="number" step="0.25" min="0" value="${esc(t.priorHours?.jack??'')}" placeholder="0"></label></div></fieldset>
    <fieldset style="border:1px solid var(--rule);margin-top:10px;padding:8px"><legend class="muted">Hours per stage (blank uses the learned estimate)</legend><div class="grid4" style="grid-template-columns:repeat(7,1fr)">
    ${AUTHOR_KEYS.map(k=>{const st=(t.stages||[]).find(x=>x.id==='a-'+k);const ph=k==='draft'?(t.targetWords?Math.round(t.targetWords/(+S.cfg.people[t.writer||'anne'].writeWph||1000)):'from words'):(S.cfg.authorHours[k]??8);
      return `<label class="f">${STAGE_LABEL[k]}<input id="f-h-${k}" type="number" step="0.5" value="${esc(st?.estHours??'')}" placeholder="${ph}"></label>`;}).join('')}</div></fieldset>
    <datalist id="series-list">${[...new Set(S.titles.map(x=>x.series).filter(Boolean))].map(x=>`<option>${esc(x)}</option>`).join('')}</datalist>
    ${inkPicker(t.color)}
    <div class="foot">${t.id?`<button class="btn danger" data-act="del-title" data-id="${t.id}" style="margin-right:auto">Delete</button>`:''}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-title" data-id="${t.id||''}" data-kind="author" data-pid="${t._pipelineId||''}">Save</button></div>`);
  }
  return modal(`<h2>${t.id?'Edit':'New'} Audio Project</h2>
  <div class="grid3"><label class="f">Title<input id="f-name" value="${esc(t.name||'')}"></label><label class="f">Short name<input id="f-short" value="${esc(t.short||'')}" placeholder="MGIS9"></label><label class="f">Client<input id="f-client" value="${esc(t.client||'')}" list="clients"></label></div>
  <datalist id="clients">${clientOpts()}</datalist>
  <div class="duebox"><label for="f-due">Due date</label><input id="f-due" type="date" value="${esc(t.due||'')}">
   <button class="btn" data-act="suggest-due">Help me set a due date</button><span id="sugg" class="muted">${t.due?'':'No date yet? Fill in the word counts below, then ask.'}</span>
   <label class="row" style="gap:6px;font-size:15px;flex-basis:100%"><input type="checkbox" id="f-own" ${t.ownProject?'checked':''}> Our own project, no client deadline (never marked overdue; client work goes first)</label></div>
  <div class="grid4" style="margin-top:8px">
   <label class="f">Arrangement<select id="f-cat">${Object.entries(CAT).map(([k,v])=>`<option value="${k}" ${t.category===k?'selected':''}>${v}</option>`).join('')}</select></label>
   <label class="f">Paid<select id="f-rm"><option value="pfh" ${t.rateModel!=='per2k'?'selected':''}>per finished hour</option><option value="per2k" ${t.rateModel==='per2k'?'selected':''}>per 2k words</option></select></label>
   <label class="f">Rate $<input id="f-rate" type="number" step="0.01" value="${esc(t.rate??200)}"></label>
   <label class="f">Est. finished hours<input id="f-fh" type="number" step="0.01" value="${esc(t.estFH||'')}" placeholder="from words"></label></div>
  <div class="grid4" style="margin-top:8px">
   <label class="f">Software cost $<input id="f-sw" type="number" step="0.01" value="${esc(t.software||0)}"></label>
   <label class="f">Contract &amp; invoicing<select id="f-holder">${PEOPLE.map(p=>`<option value="${p}" ${(st('deliver')?.owner||'anne')===p?'selected':''}>${PNAME[p]}</option>`).join('')}</select></label>
   <label class="f">Anne's words<input id="f-wa" type="number" value="${esc(st('rec-anne')?.words||'')}"></label>
   <label class="f">Jack's words<input id="f-wj" type="number" value="${esc(st('rec-jack')?.words||'')}"></label></div>
  <fieldset style="border:1px solid var(--rule);margin-top:10px;padding:8px"><legend class="muted">Outside partner (B or C)</legend><div class="grid4">
   <label class="f">Name<input id="f-pn" value="${esc(t.partnerName||'')}" list="partners"></label>
   <label class="f">Their words<input id="f-pw" type="number" value="${esc(st('rec-ext')?.words||'')}"></label>
   <label class="f">They finish by<input id="f-pd" type="date" value="${esc(st('rec-ext')?.extDate||'')}"></label>
   <label class="f">Partner is paid<span class="row" style="gap:4px;flex-wrap:nowrap"><select id="f-pmode" style="width:auto;min-width:108px">${[['pct','% of check'],['perword','$ per word'],['flat','flat $']].map(([k,l])=>`<option value="${k}" ${payMode(t.category?t:{category:'B'})===k?'selected':''}>${l}</option>`).join('')}</select>
    <input id="f-pt" type="number" step="0.0001" value="${esc(payMode(t.category?t:{category:'B'})==='flat'?(t.partnerFlat??''):payMode(t.category?t:{category:'B'})==='perword'?(t.partnerPerWord??''):(t.partnerPct??50))}"></span></label></div>
   <label class="row" style="gap:6px;margin-top:6px;font-size:15px"><input type="checkbox" id="f-direct" ${t.partnerPaidByClient?'checked':''}> The client pays the partner directly</label></fieldset>
  <datalist id="partners"><option>Alaric Nyx</option><option>Evan Registrato</option><option>Marchand Steenkamp</option></datalist>
  <div class="grid3" style="margin-top:8px">
   <label class="f">Edits by<select id="f-ed">${['anne','jack','outsourced'].map(p=>`<option value="${p}" ${(edit?.owner||'anne')===p?'selected':''}>${p==='outsourced'?'Outsourced editor':PNAME[p]}</option>`).join('')}</select></label>
   <label class="f">Editor cost $ (blank = $${S.cfg.editorRate}/FH)<input id="f-ec" type="number" step="0.01" value="${+edit?.cost>0?esc(edit.cost):''}" placeholder="auto"></label>
   <label class="f">Head start for the narrator with fewer words (workdays)<input id="f-head" type="number" min="0" value="${esc(t.headStart??'')}" placeholder="${S.cfg.headStart}"></label></div>
  <fieldset style="border:1px solid var(--rule);margin-top:10px;padding:8px"><legend class="muted">Hours worked before tracking (added to logged hours for real ratio and hourly rate)</legend><div class="grid2">
   <label class="f">Anne<input id="f-pa" type="number" step="0.25" min="0" value="${esc(t.priorHours?.anne??'')}" placeholder="0"></label>
   <label class="f">Jack<input id="f-pj" type="number" step="0.25" min="0" value="${esc(t.priorHours?.jack??'')}" placeholder="0"></label></div></fieldset>
  ${inkPicker(t.color)}
  <div id="money-sum" class="moneysum num"></div>
  <div class="foot">${t.id?`<button class="btn danger" data-act="del-title" data-id="${t.id}" style="margin-right:auto">Delete</button>`:''}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-title" data-id="${t.id||''}" data-kind="narration" data-pid="${t._pipelineId||''}">Save</button></div>`);
}
function inkPicker(sel){return `<div class="row" style="margin-top:10px"><span class="muted">Ink:</span>${INKS.map((c,i)=>`<label title="${INK_NAMES[i]}" style="display:inline-flex"><input type="radio" name="ink" value="${c}" ${sel===c?'checked':''} style="position:absolute;opacity:0"><span class="swatch" style="background:${c};width:22px;height:22px;outline:${sel===c?'2px solid var(--ink)':'none'};outline-offset:2px;cursor:pointer"></span></label>`).join('')}</div>`;}
const val=id=>document.getElementById(id)?.value?.trim()??'';
function formToTitle(kind,id){
  const old=id?tById(id):null;const keep=sid=>old?.stages?.find(s=>s.id===sid)||{};
  const color=document.querySelector('input[name=ink]:checked')?.value||old?.color||nextInk();
  if(kind==='author'){
    const writer=val('f-writer'),aed=val('f-aed')||writer,pub=val('f-pub')||writer;const cur=val('f-cur');const ci=AUTHOR_KEYS.indexOf(cur);
    const ownerOf=k=>['outline','draft','revise'].includes(k)?writer:k==='aedit'?aed:pub;
    const stages=AUTHOR_KEYS.map((k,i)=>{const o=keep('a-'+k);const hv=val('f-h-'+k);
      return {id:'a-'+k,type:k,owner:ownerOf(k),after:i?['a-'+AUTHOR_KEYS[i-1]]:[],done:i<ci,doneDate:i<ci?(o.doneDate||TODAY):null,estHours:hv===''?null:+hv,
        ...(k==='aedit'&&aed==='outsourced'?{turnaround:+val('f-aet')||null}:{})};});
    return {...(old||{}),kind:'author',status:old?.status||'active',name:val('f-name')||'Untitled',short:val('f-short')||'',writer,publisher:pub,targetWords:+val('f-tw')||0,due:val('f-due')||null,penName:val('f-pen'),series:val('f-series'),seriesNo:val('f-seriesno')===''?null:+val('f-seriesno'),priorHours:{anne:+val('f-pa')||0,jack:+val('f-pj')||0},color,stages};
  }
  const cat=val('f-cat'),holder=val('f-holder'),ed=val('f-ed');
  const stages=[];const recIds=[];
  const wa=+val('f-wa')||0,wj=+val('f-wj')||0,pw=+val('f-pw')||0;
  if(wa){stages.push({...keep('rec-anne'),id:'rec-anne',type:'record',owner:'anne',words:wa,after:[]});recIds.push('rec-anne');}
  if(wj){stages.push({...keep('rec-jack'),id:'rec-jack',type:'record',owner:'jack',words:wj,after:[]});recIds.push('rec-jack');}
  if((cat==='B'||cat==='C')&&pw){stages.push({...keep('rec-ext'),id:'rec-ext',type:'ext',owner:'ext',words:pw,extDate:val('f-pd')||null,after:[]});recIds.push('rec-ext');}
  stages.push({...keep('edit'),id:'edit',type:'edit',owner:ed,cost:ed==='outsourced'?(+val('f-ec')||0):0,turnaround:null,after:recIds});
  stages.push({...keep('deliver'),id:'deliver',type:'deliver',owner:holder,after:['edit']});
  stages.push({...keep('pickups'),id:'pickups',type:'pickups',owner:ed==='outsourced'?holder:ed,after:['deliver']});
  stages.forEach(s=>{s.done=!!s.done;s.doneDate=s.doneDate||null;});
  const pt=+val('f-pt')||0;const pm=val('f-pmode')||(cat==='B'?'pct':'perword');
  return {...(old||{}),kind:'narration',status:old?.status||'active',name:val('f-name')||'Untitled',short:val('f-short')||'',client:val('f-client'),category:cat,rateModel:val('f-rm'),rate:+val('f-rate')||0,
    estFH:+val('f-fh')||null,software:+val('f-sw')||0,partnerName:(cat==='B'||cat==='C')?val('f-pn'):'',partnerPayMode:(cat==='B'||cat==='C')?pm:null,partnerPct:(cat==='B'||cat==='C')&&pm==='pct'?(pt||50):null,partnerPerWord:(cat==='B'||cat==='C')&&pm==='perword'?pt:null,partnerFlat:(cat==='B'||cat==='C')&&pm==='flat'?pt:null,priorHours:{anne:+val('f-pa')||0,jack:+val('f-pj')||0},ownProject:!!document.getElementById('f-own')?.checked,headStart:val('f-head')===''?null:+val('f-head'),partnerPaidByClient:(cat==='B'||cat==='C')&&!!document.getElementById('f-direct')?.checked,due:val('f-due')||null,color,stages};
}

/* ============ PIPELINE ============ */
function viewPipeline(){
  const items=S.pipeline.slice().sort((a,b)=>(a.order??99)-(b.order??99)||a.name.localeCompare(b.name));
  return `<div class="row" style="justify-content:space-between;margin-bottom:6px"><h2>Down the Pipe</h2><button class="btn" data-act="pipe-new">Add a maybe</button></div>
  <p class="muted" style="margin-top:0">Titles that might come. They stay off the calendar until you commit them.</p>
  <table class="led"><thead><tr><th>Title</th><th>Client</th><th>Narrator / partner</th><th class="r">Words</th><th class="r">Est. FH</th><th class="r">Est. net</th><th>Note</th><th></th></tr></thead><tbody>
  ${items.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.client||'')}</td><td>${esc([p.narrator,p.partner].filter(Boolean).join(' / '))}</td><td class="r num">${p.words?Number(p.words).toLocaleString():''}</td><td class="r num">${p.fh||''}</td><td class="r num">${p.net?money(p.net):''}</td><td style="font-size:14px">${esc(p.note||'')}</td>
  <td style="white-space:nowrap"><button class="btn small primary" data-act="commit" data-id="${p.id}">Commit</button> <button class="lnk" data-act="pipe-del" data-id="${p.id}">remove</button></td></tr>`).join('')||'<tr><td colspan="8" class="muted">Empty.</td></tr>'}</tbody></table>`;
}

/* ============ WORK LOG ============ */
let logFilter={q:'',p:''};
function viewLog(){
  const q=logFilter.q.toLowerCase();
  const logs=S.logs.filter(l=>(!logFilter.p||l.person===logFilter.p||(l.entries||[]).some(e=>e.person===logFilter.p))&&(!q||JSON.stringify([l.raw,(l.entries||[]).map(e=>tById(e.titleId)?.name)]).toLowerCase().includes(q)))
    .sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||''));
  return `<div class="grid2" style="grid-template-columns:1.2fr 1fr;align-items:start"><div>
  <h2>The Daybook</h2>
  <div class="row" style="margin-bottom:8px"><input class="in" id="log-q" placeholder="Search: a title, a word, a date" value="${esc(logFilter.q)}" style="flex:1">
  <select class="in" id="log-p"><option value="">Both of us</option>${PEOPLE.map(p=>`<option value="${p}" ${logFilter.p===p?'selected':''}>${PNAME[p]}</option>`).join('')}</select></div>
  ${logs.map(l=>`<div class="logcard"><div class="row" style="justify-content:space-between"><b>${fmt(l.date)}, ${l.date.slice(0,4)} · ${PNAME[l.person]||''}</b><span><button class="lnk" data-act="log-edit" data-id="${l.id}">edit</button> · <button class="lnk" data-act="log-del" data-id="${l.id}">delete</button></span></div>
   <div class="raw">${esc(l.raw||'')}</div>
   <div class="ents">${(l.entries||[]).map((e,i)=>entryChip(l,e,i)).join('')}</div></div>`).join('')||'<p class="muted">No entries yet.</p>'}
  <p class="muted" style="font-size:13px">* hours estimated from the rest of the day.</p></div>
  <div class="side">${quickLogHTML()}
  <div class="panel"><h3>Booth time</h3><p style="margin:0 0 6px;font-size:14px" class="muted">Filed by the Booth as you record: booth hours and words read, by title and day. Recording entries in the log fill themselves in from it.</p>
  <div style="font-size:14px">${fhSummary()}</div></div>
  <div class="panel"><h3>Days off</h3>${daysOffHTML()}</div></div></div>`;
}
function fhSummary(){
  const rows=S.fh.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  if(!rows.length)return '<span class="muted">No booth time yet. Until then, recording estimates use the paces in Settings.</span>';
  return `<table class="led" style="font-size:14px"><tr><th>Date</th><th>Who</th><th>Title</th><th class="r">Booth</th><th class="r">Words</th><th></th></tr>${rows.map(f=>`<tr><td>${fmtShort(f.date)}</td><td>${PNAME[f.person]}</td><td>${esc(shortOf(tById(f.titleId))||'')}</td><td class="r num">${hrs(+f.boothHours||0)}</td><td class="r num">${(+f.words||0).toLocaleString()}</td><td>${f.auto?'':`<button class="lnk" data-act="fh-del" data-id="${f.id}">×</button>`}</td></tr>`).join('')}</table>`;
}
function daysOffHTML(){
  const up=S.daysoff.filter(o=>o.date>=addDays(TODAY,-30)).sort((a,b)=>a.date.localeCompare(b.date));
  return `<div class="row"><input type="date" id="off-from" class="in" value="${TODAY}" aria-label="From"><input type="date" id="off-to" class="in" value="${TODAY}" aria-label="To">
  <select id="off-who" class="in"><option value="both">Both</option>${PEOPLE.map(p=>`<option value="${p}" ${p===S.me?'selected':''}>${PNAME[p]}</option>`).join('')}</select>
  <input id="off-why" class="in" placeholder="Reason (optional)" style="flex:1;min-width:120px"><button class="btn" data-act="off-add">Mark off</button></div>
  <div style="margin-top:6px;font-size:14px">${up.map(o=>`<div class="row" style="justify-content:space-between"><span>${fmt(o.date)} · ${o.person==='both'?'Both':PNAME[o.person]}${o.reason?' · '+esc(o.reason):''}</span><button class="lnk" data-act="off-del" data-id="${o.id}">remove</button></div>`).join('')||'<span class="muted">None planned.</span>'}</div>`;
}

/* log parsing */
function titleContext(){
  return S.titles.filter(t=>t.status==='active'||(t.status==='done'&&t.invoiceDate>=addDays(TODAY,-60))).map(t=>({id:t.id,name:t.name,short:t.short,kind:t.kind,
    stages:(t.stages||[]).map(s=>({id:s.id,stage:STAGE_LABEL[s.type],owner:s.owner,done:!!s.done}))}));
}
async function readLog(text,date,writer,existing){
  if(!text.trim()){toast('Write or dictate a note first.');return;}
  let parsed=null,reply='';
  const arr=x=>Array.isArray(x)?x.filter(e=>e&&typeof e==='object'):null;
  if(parsed){parsed.entries=arr(parsed.entries);parsed.payments=arr(parsed.payments)||[];parsed.billsPaid=arr(parsed.billsPaid)||[];parsed.royalties=arr(parsed.royalties)||[];parsed.daysOff=arr(parsed.daysOff)||[];}
  const resolveT=x=>{if(!x)return null;if(tById(x))return x;const q=String(x).toLowerCase();return S.titles.find(t=>(t.short||'').toLowerCase()===q||t.name.toLowerCase()===q)?.id||null;};
  let guessed=false;
  let src=parsed?.entries;
  if(!src||!src.length){const loc=localParse(text,date,writer);if(loc.length&&!((parsed?.royalties||[]).length||(parsed?.billsPaid||[]).length||(parsed?.payments||[]).length||(parsed?.daysOff||[]).length)){src=loc;guessed=true;}}
  const entries=(src||[{person:writer,titleId:null,stageId:null,kind:'other',hours:null,finished:false,note:text.slice(0,120)}])
    .map(e=>({person:PEOPLE.includes(e.person)?e.person:writer,titleId:resolveT(e.titleId),stageId:e.stageId||null,kind:e.kind||'work',hours:e.hours==null?null:+e.hours,finished:!!e.finished,finishedOn:/^\d{4}-\d{2}-\d{2}$/.test(e.finishedOn||'')?e.finishedOn:null,note:e.note||''}));
  let warn=guessed?"Read by the word-matcher on this computer. Check each line before saving.":'';if(!entries.length&&!(parsed?.royalties||[]).length&&!(parsed?.billsPaid||[]).length&&!(parsed?.payments||[]).length&&!(parsed?.daysOff||[]).length){warn="I couldn't match anything in that note. Fill in the lines below.";entries.push({person:writer,titleId:null,stageId:null,kind:'admin',hours:null,finished:false,note:text.slice(0,120)});}
  const billsPaid=(parsed?.billsPaid||[]).filter(x=>S.bills.some(b=>b.id===x.billId)&&/^\d{4}-\d{2}-\d{2}$/.test(x.date||''));
  const payments=(parsed?.payments||[]).filter(x=>tById(x.titleId)&&/^\d{4}-\d{2}-\d{2}$/.test(x.date||''));
  logPreview({id:existing?.id||null,date,person:writer,raw:text,reply,entries,warn,payments,billsPaid,royalties:(parsed?.royalties||[]).filter(r=>+r.amount>0).map(r=>({date:/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')?r.date:date,amount:+r.amount,note:r.note||''})),daysOff:parsed?.daysOff||[],ot:existing?.ot||null,createdAt:existing?.createdAt||null});
}
// Client suggestions come from your own titles, so no names live in the app's code.
function clientOpts(){return [...new Set(S.titles.map(t=>(t.client||'').trim()).filter(Boolean))].sort().map(c=>`<option>${esc(c)}</option>`).join('');}
function extractJSON(t){if(!t)return null;try{return JSON.parse(t);}catch(_){}
  const f=t.match(/```(?:json)?\s*([\s\S]*?)```/);if(f){try{return JSON.parse(f[1]);}catch(_){}}
  const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1));}catch(_){}}
  const c=t.indexOf('['),d=t.lastIndexOf(']');if(c>=0&&d>c){try{return JSON.parse(t.slice(c,d+1));}catch(_){}}
  return null;}
// A plain reading of the note (word-matching on this computer).
function localParse(text,date,writer){
  const NUM={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,half:.5,an:1,a:1};
  const norm=x=>' '+String(x).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+' ';
  const pool=S.titles.filter(t=>t.status==='active'||(t.status==='done'&&(t.invoiceDate||t.checkDate||'')>=addDays(TODAY,-60)));
  const skip=new Set(['the','of','in','and','a','book','vol','volume','part']);
  const findTitle=c=>{let best=null,bs=0;const n=norm(c);
    for(const t of pool){if(t.short&&n.includes(' '+t.short.toLowerCase()+' ')){return t;}
      const toks=norm(t.name).trim().split(' ').filter(w=>w&&!skip.has(w));if(!toks.length)continue;
      const sc=toks.filter(w=>n.includes(' '+w+' ')).length/toks.length;if(sc>bs){bs=sc;best=t;}}
    return bs>=.6?best:null;};
  const stageOf=(c,t,p)=>{const n=norm(c);if(!t)return null;const st=t.stages||[];const by=ty=>st.find(s=>s.type===ty);
    if(/ pickup/.test(n))return by('pickups');if(/ (invoice|deliver|submit)/.test(n))return by('deliver');if(/ edit/.test(n))return by('edit')||by('aedit');
    if(/ (record|booth|narrat|read )/.test(n))return st.find(s=>s.type==='record'&&s.owner===p)||by('record');
    if(/ outlin/.test(n))return by('outline');if(/ (draft|wrote|writing|write )/.test(n))return by('draft');if(/ revis/.test(n))return by('revise');
    if(/ (cover|format)/.test(n))return by('format');if(/ publish/.test(n))return by('publish');if(/ market/.test(n))return by('market');return null;};
  const out=[];let last=null;const hist=[];
  const parts=text.split(/[.;\n]+|,\s+(?=\S)|\s+and\s+(?=(?:i|jack|anne|we|he|she|spent|finished|recorded|edited|worked|did|sent|wrote)\b)/i).map(x=>x.trim()).filter(Boolean);
  for(const c of parts){const n=norm(c);
    if(/ (not|didn t|did not|no |never|nothing)/.test(n)&&!/ (finish|record|edit)/.test(n.replace(/ (not|didn t|did not) (work|record) more.*/,'')))continue;
    const p=/ jack /.test(n)?'jack':/ anne /.test(n)?'anne':writer;
    let t=findTitle(c),st=null;
    if(!t&&/ (same|that|those|it) /.test(n)&&hist.length){
      // "the same pickups": the most recent line with that kind of task, else the last line
      const want=[...hist].reverse().find(h=>h.s&&stageOf(c,h.t,p)?.type===h.s.type);const h=want||last;t=h.t;st=want?want.s:null;}
    if(!st)st=stageOf(c,t,p);if(!st&&t&&/ same /.test(n)&&last?.s)st=last.s;
    const hm=n.match(/ (\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|half|an|a) (?:h|hr|hrs|hour|hours) /);const hours=hm?(NUM[hm[1]]??+hm[1]):null;
    const finished=/ (finish|finished|done|complete|completed|wrapped|submitted|sent|delivered) /.test(n);
    if(t){out.push({person:p,titleId:t.id,stageId:st?.id||null,kind:t.kind==='author'?'author':'work',hours,finished:finished&&!!st,finishedOn:finished&&st?date:null,note:c.slice(0,80)});last={t,s:st};hist.push(last);}
    else if(hours!=null||/ (admin|email|invoice|account|meeting|call|tool)/.test(n))out.push({person:p,titleId:null,stageId:null,kind:'admin',hours,finished:false,finishedOn:null,note:c.slice(0,80)});
  }
  return out;
}
let PREV=null;
function logPreview(l){
  PREV=structuredClone(l);
  const titles=S.titles.filter(t=>t.status!=='pipeline');
  const rows=PREV.entries.map((e,i)=>{const t=tById(e.titleId);return `<div class="ent-row" data-i="${i}">
   <select class="in" data-f="person">${PEOPLE.map(p=>`<option value="${p}" ${e.person===p?'selected':''}>${PNAME[p]}</option>`).join('')}</select>
   <select class="in" data-f="titleId"><option value="">No title (admin/other)</option>${titles.map(x=>`<option value="${x.id}" ${x.id===e.titleId?'selected':''}>${esc(x.name)}</option>`).join('')}</select>
   <select class="in" data-f="stageId"><option value="">—</option>${(t?.stages||[]).map(s=>`<option value="${s.id}" ${s.id===e.stageId?'selected':''}>${esc(stageLabel(s))}</option>`).join('')}</select>
   <input class="in num" data-f="hours" type="number" step="0.25" placeholder="auto" value="${e.hours??''}" aria-label="Hours">
   <label class="row" style="gap:3px;font-size:13px" title="${e.finishedOn?'Finished '+fmt(e.finishedOn):''}"><input type="checkbox" data-f="finished" ${e.finished?'checked':''}>done${e.finished&&e.finishedOn&&e.finishedOn!==PREV.date?' '+fmtShort(e.finishedOn):''}</label>
   <input class="in" data-f="note" value="${esc(e.note||'')}" aria-label="Note">
   <button class="lnk" data-act="ent-del" data-i="${i}" aria-label="Remove">×</button></div>`;}).join('');
  const pays=(PREV.payments||[]).map(x=>`<div class="chip">💰 ${esc(shortOf(tById(x.titleId)))} paid ${fmtShort(x.date)}${x.amount?' · '+money(x.amount):''}</div>`).join(' ');
  const billChips=(PREV.billsPaid||[]).map(x=>{const b=S.bills.find(y=>y.id===x.billId);const ym=b?billMonthFor(b,x.date,x.month):null;return `<div class="chip">🧾 ${esc(b?.name||'Bill')}${ym?' for '+monthName(ym):''} paid ${fmtShort(x.date)} · ${money(x.amount??b?.amount??0)}</div>`;}).join(' ');
  const royChips=(PREV.royalties||[]).map(r=>`<div class="chip">💰 Royalties ${money(r.amount)} · ${fmtShort(r.date)}</div>`).join(' ');
  const offs=(PREV.daysOff||[]).map(o=>`<div class="chip">Day off · ${o.person==='both'?'Both':PNAME[o.person]||o.person} · ${fmt(o.date)}</div>`).join(' ');
  modal(`<h2>Here's how I read it</h2><p class="raw" style="font-style:italic;margin-top:0">"${esc(PREV.raw)}"</p>
  <div class="row muted" style="font-size:13px"><span style="width:90px">Who</span><span style="flex:1.4">Title</span><span style="flex:1.1">Stage</span><span>Hours</span></div>
  <div id="ent-rows">${rows}</div><button class="lnk" data-act="ent-add">+ add a line</button>
  ${PREV.warn?`<div class="alert info">${esc(PREV.warn)}${PREV.reply?`<details style="margin-top:4px"><summary style="cursor:pointer">What Claude sent back</summary><pre style="white-space:pre-wrap;font-size:12px;max-height:200px;overflow:auto">${esc(PREV.reply)}</pre></details>`:''}</div>`:''}${pays||offs||billChips||royChips?`<div style="margin-top:8px">${pays} ${royChips} ${billChips} ${offs}</div>`:''}
  <p class="muted" style="font-size:13px">Blank hours get the rest of the ${S.cfg.people[PREV.person].hours}-hour day, minus booth time, split evenly. Checking "done" closes that stage and teaches the forecast.</p>
  <div class="foot"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="log-save">Enter in the Ledger</button></div>`,true);
}
function syncPrevFromForm(){
  document.querySelectorAll('#ent-rows .ent-row').forEach(r=>{const i=+r.dataset.i;const e=PREV.entries[i];if(!e)return;
    r.querySelectorAll('[data-f]').forEach(el=>{const f=el.dataset.f;if(f==='finished')e[f]=el.checked;else if(f==='hours')e[f]=el.value===''?null:+el.value;else e[f]=el.value||(f==='note'?'':null);});
    if(!e.titleId){e.stageId=null;e.kind=e.kind==='work'?'admin':e.kind;}else if(tById(e.titleId)?.kind==='author')e.kind='author';else e.kind='work';});
}
async function saveLog(){
  syncPrevFromForm();const l=PREV;
  // auto hours per person
  for(const p of PEOPLE){
    const mine=l.entries.filter(e=>e.person===p);if(!mine.length)continue;
    const others=S.logs.filter(x=>x.date===l.date&&x.id!==l.id).reduce((a,x)=>a+(x.entries||[]).filter(e=>e.person===p).reduce((b,e)=>b+(+e.hours||0),0),0);
    // record entries without hours take FH booth time for that title that day
    for(const e of mine)if(e.hours==null&&e.titleId){const s=tById(e.titleId)?.stages.find(x=>x.id===e.stageId);
      if(s?.type==='record'){const b=S.fh.filter(f=>f.date===l.date&&f.person===p&&f.titleId===e.titleId).reduce((a,f)=>a+(+f.boothHours||0),0);if(b>0){e.hours=b;e.auto=true;}}}
    const stated=mine.filter(e=>e.hours!=null).reduce((a,e)=>a+e.hours,0);
    for(const e of mine)if(e.hours==null&&e.finishedOn&&e.finishedOn!==l.date)e.hours=0;
    const unk=mine.filter(e=>e.hours==null);
    if(unk.length){const cap=capacity(p,l.date)||0;let avail=Math.max(0,cap-stated-others);const each=avail>0?avail/unk.length:1;
      unk.forEach(e=>{e.hours=avail>0?(Math.round(each*4)/4||0.25):(e.kind==='other'?0:1);e.auto=true;});}
  }
  const doc={date:l.date,person:l.person,raw:l.raw,entries:l.entries.map(e=>({person:e.person,titleId:e.titleId||null,stageId:e.stageId||null,kind:e.kind||'work',hours:+e.hours||0,auto:!!e.auto,finished:!!e.finished,finishedOn:e.finishedOn||null,note:e.note||''})),
    ot:l.ot||null,createdAt:l.createdAt||new Date().toISOString(),by:S.me||l.person};
  const id=l.id||('log-'+l.date+'-'+uid());
  closeModal();
  if(!(await put('logs',id,doc)))return;
  for(const o of (l.daysOff||[])){if(!o.date)continue;await put('daysoff','off-'+o.date+'-'+(o.person||'both'),{date:o.date,person:o.person||'both',reason:o.reason||''});}
  // finished stages, after the log lands so learning sees its hours
  S.logs=[...S.logs.filter(x=>x.id!==id),{id,...doc}];buildIndex();
  for(const e of doc.entries)if(e.finished&&e.titleId&&e.stageId){const s=tById(e.titleId)?.stages.find(x=>x.id===e.stageId);if(s&&!s.done)await setStageDone(e.titleId,e.stageId,true,e.finishedOn||doc.date);}
  for(const r of (l.royalties||[]))await put('deposits','dep-'+r.date+'-'+uid().slice(0,6),{date:r.date,amount:r.amount,kind:'royalty',note:r.note||'',by:S.me||''});
  for(const bp of (l.billsPaid||[])){const b=S.bills.find(x=>x.id===bp.billId);if(!b)continue;const ym=billMonthFor(b,bp.date,bp.month);const n=Math.round((D(bp.date)-D(billDue(b,ym)))/864e5);
    await patch('bills',b.id,{paid:{...(b.paid||{}),[ym]:{date:bp.date,amount:+(bp.amount??b.amount)||0,...(n>LATE_GRACE?{late:n}:{})}}});}
  for(const pmt of (l.payments||[])){const t=tById(pmt.titleId);if(t&&!t.checkDate)await patch('titles',t.id,{checkDate:pmt.date,checkAmount:+pmt.amount||moneyOf(t).gross});}
  const qa=$('#qlog');if(qa)qa.value='';
  toast('Entered in the Ledger.');
}


/* ============ LEDGER ============ */
let ledMonth=TODAY.slice(0,7);
function viewLedger(){
  const [y,m]=ledMonth.split('-').map(Number);const start=`${ledMonth}-01`,end=iso(new Date(y,m,0,12));
  const ev=monthEvents(start,end);const rows=[];
  for(const [d,l] of Object.entries(ev))for(const x of l){if(x.k==='due')continue;
    if(x.k==='roy')rows.push({d,dir:'in',what:'💰 Royalties',amt:x.amt,status:x.actual?'received':'forecast',act:x.actual?`data-act="roy-pop" data-id="${x.dp.id}"`:'data-act="roy-pop"'});
    if(x.k==='check')rows.push({d,dir:'in',what:`💰 ${x.t.name} (net)`,amt:x.amt,status:x.actual?'received':'forecast',act:`data-act="check-pop" data-id="${x.t.id}"`});
    if(x.k==='payout')rows.push({d,dir:'pass',what:`↪ ${x.t.partnerName||'Partner'}'s share of ${x.t.name} (${money(x.amt)})`,amt:x.amt,status:x.actual?'passed on':'pass on when it clears',act:`data-act="check-pop" data-id="${x.t.id}"`});
    if(x.k==='bill')rows.push({d,dir:'out',what:`🧾 ${x.b.name}${x.owed||x.late?' ('+monthName(x.ym)+')':''}`,amt:x.amt,status:x.owed?`<span style="color:var(--overdue)">late · ${x.late} days · owed</span>`:x.paid?(x.late?`paid late · ${x.late} days`:'paid'):'expected',act:`data-act="bill-pop" data-id="${x.b.id}" data-ym="${x.ym}"`});}
  rows.sort((a,b)=>a.d.localeCompare(b.d));
  const tin=rows.filter(r=>r.dir==='in').reduce((a,r)=>a+r.amt,0),tout=rows.filter(r=>r.dir==='out').reduce((a,r)=>a+r.amt,0);
  let run=0;
  const years=[...new Set([TODAY.slice(0,4),...S.logs.map(l=>l.date.slice(0,4)),...S.titles.map(t=>(t.invoiceDate||t.due||'').slice(0,4)).filter(Boolean)])].sort().reverse();
  return `<div class="grid2" style="grid-template-columns:1.5fr 1fr;align-items:start"><div>
  <div class="cal-head"><button class="btn" data-act="led-mon" data-d="-1" aria-label="Previous month">‹</button><h2>${MON[m-1]} ${y}</h2><button class="btn" data-act="led-mon" data-d="1" aria-label="Next month">›</button></div>
  <table class="led"><thead><tr><th>Date</th><th>Entry</th><th>Status</th><th class="r">In</th><th class="r">Out</th><th class="r">Running</th></tr></thead><tbody>
  ${rows.map(r=>{run+=r.dir==='in'?r.amt:r.dir==='out'?-r.amt:0;return `<tr class="${r.dir}"><td>${fmtShort(r.d)}</td><td><button class="lnk" ${r.act} style="color:var(--ink);text-decoration:none">${esc(r.what)}</button></td><td class="muted">${r.status}</td><td class="r num">${r.dir==='in'?money(r.amt):''}</td><td class="r num">${r.dir==='out'?money(r.amt):''}</td><td class="r num" style="color:${run<0?'var(--overdue)':'inherit'}">${money(run)}</td></tr>`;}).join('')||'<tr><td colspan="6" class="muted">Nothing this month.</td></tr>'}
  <tr><td></td><td><b>Month</b></td><td></td><td class="r num"><b>${money(tin)}</b></td><td class="r num"><b>${money(tout)}</b></td><td class="r num"><b>${money(tin-tout)}</b></td></tr></tbody></table>
  <p class="muted" style="font-size:14px">A red running total means a bill lands before the check that covers it.</p></div>
  <div class="side"><div class="panel"><h3>Bills</h3>
  ${S.bills.slice().sort((a,b)=>(+a.day)-(+b.day)).map(b=>`<div class="row" style="justify-content:space-between;border-bottom:1px dotted var(--rule);padding:3px 0"><span>${esc(b.name)} <span class="muted">· usually the ${ord(billExpectedDay(b))}</span></span><span class="num">${billExpectedAmount(b)!==+b.amount?`<span class="muted" title="Average of recent payments">~</span>${money(billExpectedAmount(b))}`:money(b.amount)} <button class="lnk" data-act="bill-edit" data-id="${b.id}">edit</button></span></div>`).join('')||'<span class="muted">No bills yet.</span>'}
  <div style="margin-top:8px"><button class="btn small" data-act="bill-edit">Add a bill</button></div></div>
  <div class="panel"><h3>Royalties</h3>${(()=>{const m=royaltyModel();const ds=S.deposits.filter(d=>d.kind==='royalty').sort((a,b)=>b.date.localeCompare(a.date));
    return `${m?`<p style="margin:0 0 6px;font-size:15px">Expect about <b>${money(m.amount)}</b> a month, around the ${ord(m.day)}.</p>`:`<p class="muted" style="margin:0 0 6px;font-size:14px">${ds.length?`${3-ds.length} more deposit${3-ds.length>1?'s':''} and I'll start forecasting.`:'Say "received $X in royalties" in your daily note, or add one here.'}</p>`}
    ${ds.slice(0,6).map(d=>`<div class="row" style="justify-content:space-between;border-bottom:1px dotted var(--rule);padding:2px 0;font-size:15px"><span>${fmtShort(d.date)}${d.note?` <span class="muted">· ${esc(d.note)}</span>`:''}</span><span class="num">${money(d.amount)} <button class="lnk" data-act="roy-del" data-id="${d.id}">remove</button></span></div>`).join('')}
    <div class="row" style="margin-top:6px"><input type="date" id="roy-date" class="in" value="${TODAY}" aria-label="Date received"><input type="number" id="roy-amt" class="in" step="0.01" placeholder="Amount" style="width:100px" aria-label="Amount"><button class="btn small" data-act="roy-add">Add</button></div>`;})()}</div>
  <div class="panel"><h3>Year report</h3><p style="margin:0 0 6px;font-size:15px">Every title, log entry, check, payout and bill for the year, as one CSV.</p>
  <div class="row"><select id="rep-year" class="in">${years.map(y=>`<option>${y}</option>`).join('')}</select><button class="btn primary" data-act="report">Download CSV</button></div></div></div></div>`;
}
const ord=n=>n+(['th','st','nd','rd'][(n%100>10&&n%100<14)?0:n%10]||'th');

function reportCSV(y){
  const q=v=>{const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  const L=[];const row=a=>L.push(a.map(q).join(','));
  const inY=s=>s&&s.slice(0,4)===String(y);
  row([`${PNAME.jack} & ${PNAME.anne}'s Ledger & Lamp — ${y} report`,`generated ${TODAY}`]);L.push('');
  row(['TITLES']);row(['Title','Client','Arrangement','Kind','Status','Due','Delivered','Check received','FH','Gross','Partner payout','Software','Editor','Net','Hours Anne','Hours Jack','Total hours','Real ratio (h/FH)','Effective hourly','Days late']);
  let T={fh:0,gross:0,partner:0,software:0,editor:0,net:0,hours:0};
  for(const t of S.titles){const touched=inY(t.due)||inY(t.invoiceDate)||inY(t.checkDate)||S.logs.some(l=>inY(l.date)&&(l.entries||[]).some(e=>e.titleId===t.id));if(!touched)continue;
    const m=moneyOf(t),r=titleReal(t),fh=t.kind==='author'?0:titleFH(t);const late=t.due&&t.invoiceDate&&t.invoiceDate>t.due?Math.round((D(t.invoiceDate)-D(t.due))/864e5):'';
    row([t.name,t.client||'',t.category||'',t.kind,t.status,t.due||'',t.invoiceDate||'',t.checkDate||'',fh.toFixed(2),m.gross.toFixed(2),m.partner.toFixed(2),m.software.toFixed(2),m.editor.toFixed(2),m.net.toFixed(2),r.anne.toFixed(2),r.jack.toFixed(2),r.hours.toFixed(2),r.ratio?r.ratio.toFixed(2):'',r.hourly?r.hourly.toFixed(2):'',late]);
    if(inY(t.checkDate)){T.fh+=fh;T.gross+=m.gross;T.partner+=m.partner;T.software+=m.software;T.editor+=m.editor;T.net+=m.net;}T.hours+=r.hours;}
  L.push('');row(['WORK LOG']);row(['Date','Person','Title','Stage','Kind','Hours','Hours estimated','Finished','Note','Original note']);
  for(const l of S.logs.filter(l=>inY(l.date)).sort((a,b)=>a.date.localeCompare(b.date))){
    if(!(l.entries||[]).length)row([l.date,PNAME[l.person],'','','','','','','',l.raw]);
    (l.entries||[]).forEach((e,i)=>{const t=tById(e.titleId);const s=t?.stages.find(x=>x.id===e.stageId);row([l.date,PNAME[e.person],t?.name||'',s?STAGE_LABEL[s.type]:'',e.kind,(+e.hours||0).toFixed(2),e.auto?'yes':'',e.finished?'yes':'',e.note,i===0?l.raw:'']);});}
  L.push('');row(['FINISHED HOUR']);row(['Date','Person','Title','Booth hours','Words']);
  for(const f of S.fh.filter(f=>inY(f.date)))row([f.date,PNAME[f.person],tById(f.titleId)?.name||'',f.boothHours,f.words]);
  L.push('');row(['CHECKS']);row(['Date','Title','Our share','Net after costs','Status']);
  for(const t of S.titles){if(t.kind==='author')continue;const d=checkDateOf(t);if(!inY(d))continue;const m=moneyOf(t);row([d,t.name,ourCheck(t).toFixed(2),netCheck(t).toFixed(2),t.checkDate?'received':'forecast']);}
  L.push('');row(['PARTNER PAYOUTS']);row(['Date','Partner','Title','Amount','Status']);
  for(const t of S.titles){const m=moneyOf(t);if(!m.partner)continue;if(t.partnerPaidByClient)continue;const d=t.partnerPaidDate||checkDateOf(t);if(!inY(d))continue;row([d,t.partnerName||'',t.name,m.partner.toFixed(2),t.partnerPaidDate?'paid':'forecast']);}
  L.push('');row(['ROYALTIES']);row(['Date','Amount','Note']);let RY=0;
  for(const d of S.deposits.filter(d=>inY(d.date)).sort((a,b)=>a.date.localeCompare(b.date))){RY+=+d.amount||0;row([d.date,(+d.amount||0).toFixed(2),d.note||'']);}
  L.push('');row(['BILLS PAID']);row(['Date','Bill','Amount']);
  for(const b of S.bills)for(const [ym,p] of Object.entries(b.paid||{}))if(inY(ym))row([p.date||ym,b.name,(+p.amount||+b.amount).toFixed(2)]);
  L.push('');row(['SUMMARY (checks received this year)']);
  row(['Finished hours',T.fh.toFixed(2)]);row(['Gross',T.gross.toFixed(2)]);row(['Partner payouts',T.partner.toFixed(2)]);row(['Software',T.software.toFixed(2)]);row(['Editor',T.editor.toFixed(2)]);row(['Net',T.net.toFixed(2)]);row(['Royalties',RY.toFixed(2)]);row(['Net + royalties',(T.net+RY).toFixed(2)]);row(['Hours logged',T.hours.toFixed(2)]);
  return L.join('\n');
}

/* ============ THE KEY ============ */
function viewGuide(){
  const c=S.cfg,A=c.people.anne,J=c.people.jack,wpf=c.wordsPerFH;
  const n=x=>Number(x).toLocaleString('en-US');
  const r1=x=>Math.round(x*10)/10;
  const exWords=62000,exBooth=r1(exWords/A.wph),exDays=r1(exBooth/A.hours);
  const exFH=+(155000/wpf).toFixed(2),exGross=Math.round(200*exFH),exEd=Math.round(c.editorRate*exFH);
  const bPay=Math.round(exGross*.5);
  const S_=[
  ['k-start','Opening the book',`
    <p>Open the <b>Almanac</b> and look at your card on the left. It answers two questions.</p>
    <ul><li><b>Today's work</b>: how the hours you logged today were spent. It appears once you've logged.</li>
    <li><b>Focus on</b>: what to work on next, and why ("Due Dec 18 · aim Dec 11 · forecast Dec 9"). The first task, in bold, is the one to start.</li></ul>
    <p>Lines with ⏳ say what you're waiting on ("MGIS9 edit waits on your recording, forecast Dec 1"). Your partner's card sits below yours.</p>
    <p>At the end of the day, write a line or two in <b>Today I…</b> and press <b>Read my note</b>. That's the only daily input the tool needs.</p>`],
  ['k-tabs','The tabs',`
    <table class="led"><tr><th>Tab</th><th>What lives there</th></tr>
    <tr><td>Almanac</td><td>Your cards, notices, the daily note, the year's goals, and the month's calendar of bars, deadlines, checks and bills.</td></tr>
    <tr><td>Titles</td><td>A catalog card for every signed title, with stages, money, the ☆ star and its buttons. Finished titles are listed below with their real hours and real hourly rate.</td></tr>
    <tr><td>Pipeline</td><td>Maybes. They stay off the calendar until you press <b>Commit</b>.</td></tr>
    <tr><td>Work Log</td><td>Every note, searchable. Finished Hour stats come in here (paste or screenshot), and so do days off.</td></tr>
    <tr><td>Ledger</td><td>Money in and out by month with a running balance, your bills, royalties, and the year's CSV report.</td></tr>
    <tr><td>The Key</td><td>This page.</td></tr>
    <tr><td>Settings</td><td>Paces, hours, workdays, holidays, goals, and every timing rule described below.</td></tr></table>`],
  ['k-note','Writing the daily note',`
    <p>Write the way you'd tell each other. A simple word-matcher on this computer turns the note into ledger lines and shows you how it read them before anything is saved, so you can fix a title, stage, hours or checkmark first.</p>
    <div class="ex"><span class="lbl">It understands</span>
    <code>Recorded MGIS9 for 3 hours, rest was admin</code> · <code>Finished SAB1 edits</code> · <code>Invoice sent for BS1 redo on the 10th</code> · <code>Alaric's lines are in for FE3</code> · <code>Jack took Friday off</code> · <code>Neither of us recorded today</code> · <code>Paid electric $312 on the 9th</code> · <code>Received $214 in royalties</code> · <code>Cartomyth was paid 11/1</code></div>
    <h4>Hours you leave out</h4>
    <p>Lines without hours share whatever is left of your ${A.hours}-hour day, after stated hours and any Finished Hour booth time.</p>
    <div class="ex"><span class="lbl">Example</span>"Recorded MGIS9 for 3 hours, edited SAB1, answered email." The recording gets 3h. Edits and email split the other 3h, 1.5h each, marked with * in the Work Log.</div>
    <h4>Rules worth knowing</h4>
    <ul><li><b>"Finished"</b>, "done", "sent" or "delivered" checks off that stage, and every stage before it.</li>
    <li><b>Once you've logged today, today is closed.</b> Unfinished planned hours move to your next workday, so the forecast never assumes you'll squeeze them in tonight.</li>
    <li><b>No double counting.</b> If someone's day is already full, a "didn't record" line adds 0 hours.</li>
    <li><b>Days off</b> said in a note ("took Friday off") are marked automatically and push every forecast back.</li>
    <li><b>Too many hours?</b> If a day adds up to more than the scheduled hours, you'll get a notice: <i>It was overtime</i> or <i>Let me fix it</i>. Overtime pulls forecasts in.</li></ul>`],
  ['k-days','How a workday is planned',`
    <p>Each of you has <b>${A.hours} hours</b> (Anne) and <b>${J.hours} hours</b> (Jack) a day, on your workdays, minus US federal holidays and marked days off. There are no clock times, just hours.</p>
    <ul><li><b>One title in the booth per person per day.</b> If a recording job wraps early, the rest of the day goes to writing first, then to non-booth work (edits, invoicing, pickups) on other titles.</li>
    <li><b>Order of work:</b> ⭐ the starred title (deadlines permitting), then client titles (already started first, then by due date), then your own audio projects, then books in the gaps.</li>
    <li><b>Finish what's started.</b> A title already underway isn't reshuffled behind a newer one, unless you star the newer one.</li></ul>`],
  ['k-rec','Recording time',`
    <p>Booth hours = words ÷ booth pace. Your paces are <b>${n(A.wph)}</b> words an hour (Anne) and <b>${n(J.wph)}</b> (Jack). Once Finished Hour has 3+ booth hours from either of you in the last 30 days, the live pace from those stats takes over.</p>
    <div class="ex"><span class="lbl">Example</span>${n(exWords)} words ÷ ${n(A.wph)} = <b>${exBooth} booth hours</b>, about ${exDays} full days at ${A.hours} hours a day.</div>
    <p>Recording progress comes from Finished Hour words when available ("62,000 words, 20,000 read" means 42,000 left), and from logged hours when not.</p>`],
  ['k-tandem','Working in tandem',`
    <p>A duet runs in parallel, not in sequence.</p>
    <ul><li><b>The narrator with fewer words starts first.</b> The main narrator starts ${c.headStart} workdays later, so the earlier lines are ready to drop in. Change it per project with <b>Head start</b>; 0 means start together.</li>
    <li><b>If the editor also narrates</b>, edits start the day their own recording ends and keep pace with what's been recorded.</li>
    <li><b>If the editor doesn't narrate</b> (or is outsourced), editing starts ${c.editLag} workdays after the second narrator starts.</li>
    <li><b>Editing finishes</b> ${c.tailIn} workdays after the last recording day in-house, ${c.tailOut} if outsourced.</li>
    <li><b>An outside partner's part</b> is planned to their "finish by" date until you press <b>[name]'s lines are in</b>.</li></ul>
    <div class="ex"><span class="lbl">Example: MGIS9</span>Anne (62k words, fewer) starts Mon Nov 23. Jack (93k) starts ${c.headStart} workdays later. Anne starts editing the day her recording ends and follows along as Jack records. Jack's last booth day is Wed Dec 9, so edits are done Fri Dec 11, ${c.tailIn} workdays later. Delivery and invoice follow.</div>`],
  ['k-est','Other stages, and how they learn',`
    <table class="led"><tr><th>Stage</th><th>Starting estimate</th><th>Now</th></tr>
    <tr><td>Edit (in-house)</td><td>hours per finished hour × FH</td><td>Anne ${A.editPerFH}, Jack ${J.editPerFH}</td></tr>
    <tr><td>Deliver &amp; invoice</td><td>hours per title</td><td>Anne ${A.adminPerTitle}, Jack ${J.adminPerTitle}</td></tr>
    <tr><td>Pickups</td><td>hours per finished hour × FH, at least 1h, starting ${c.pickupDelay} workdays after invoice</td><td>Anne ${A.pickupsPerFH}, Jack ${J.pickupsPerFH}</td></tr>
    <tr><td>Book stages</td><td>outline, revise, edit, cover &amp; format, publish, market</td><td>${['outline','revise','aedit','format','publish','market'].map(k=>STAGE_LABEL[k]+' '+c.authorHours[k]+'h').join(', ')}</td></tr>
    <tr><td>Drafting</td><td>target words ÷ writing pace</td><td>Anne ${n(A.writeWph)}, Jack ${n(J.writeWph)} words/hr</td></tr></table>
    <p><b>Learning:</b> when a stage is checked off, its real logged hours are blended 50/50 with the current estimate. One bad week moves the number halfway, not all the way.</p>
    <div class="ex"><span class="lbl">Example</span>Edits estimated at 1.5h per FH take 2.1h per FH. The new estimate is (1.5 + 2.1) ÷ 2 = <b>1.8h</b>, and the next title is planned with it.</div>`],
  ['k-aim','The aim, amber and red',`
    <p>Every client title has an <b>aim</b>: ${c.weekEarly} workdays (a week) before its due date. You plan to the aim, and the due date is the backstop.</p>
    <ul><li><b>◇ aim</b> and <b>⚑ due</b> markers sit on the calendar.</li>
    <li><b>Striped amber</b> on a bar: past the aim but before the due date. You're eating the week. A notice says how many hours of overtime win it back.</li>
    <li><b>Red</b>: past the due date. The notice offers <b>Draft a client notice</b>, ready to copy.</li>
    <li><b>Your own projects and books</b> never go amber or red. Their date is a target, not a promise.</li></ul>
    <h4>Help me set a due date</h4>
    <p>In the Audio Project form, it simulates the new title behind everything already signed and finds when you'd finish. Then it offers two dates to quote:</p>
    <div class="ex"><span class="lbl">Example</span>You'd finish around Jan 8. Quote <b>Jan 15</b> (finish + ${c.weekEarly} workdays, a week of slack) or <b>Jan 19</b> (another ${c.comfortDays} workdays, comfortable). Either way the aim lands on or after Jan 8.</div>`],
  ['k-star','The star',`
    <p>Click ☆ beside an audio project's name to star it. Only one title can be starred; starring another moves the star.</p>
    <ul><li>The starred title gets every whole day it can use.</li>
    <li>If that would push another title later than it would otherwise land, and past its aim, that title gets whole days back, starting as late as possible while still hitting its aim. When the aim can't be saved, the title is at least kept no later than it would have been without the star.</li>
    <li>A notice tells you each time: "⭐ Book A is starred. Book B gets whole days from Nov 18…"</li></ul>
    <p><b>Deadlines win over the star.</b> The star is a preference, the deadline is the contract.</p>`],
  ['k-money','Money: checks, partners, costs',`
    <p><b>Finished hours (FH)</b> = the estimate you enter, or total words ÷ ${n(wpf)}.</p>
    <ul><li><b>Per finished hour:</b> check = rate × FH. <b>Per 2k words:</b> check = rate × words ÷ 2,000.</li>
    <li><b>Software</b>: whatever you enter. <b>Outsourced editor</b>: $${c.editorRate} × FH unless you type a different amount.</li>
    <li><b>Partners (B and C)</b>: paid as % of the check, $ per word of their part, or a flat amount.</li>
    <li><b>Partner money passes through.</b> Only your share counts as income; the partner's share shows as a faded ↪ line on the calendar. If the client pays the partner directly, tick that box, and the check you expect is just your share.</li></ul>
    <div class="ex"><span class="lbl">Example: an A title</span>155,000 words ÷ ${n(wpf)} = ${exFH} FH. Check at $200/FH = <b>${money(exGross)}</b>. With an outsourced editor ($${c.editorRate} × ${exFH} = ${money(exEd)}) and $70 software, you keep <b>${money(exGross-exEd-70)}</b>.</div>
    <div class="ex"><span class="lbl">Example: a B title, 50/50</span>Same ${money(exGross)} check. ${money(bPay)} passes to the partner and <b>${money(exGross-bPay)}</b> counts as income. The bottom of the form shows this live as you type: <i>Check · software · editor · partner · you keep</i>.</div>
    <h4>When checks arrive</h4>
    <p>A check is expected ${c.clearDays} workdays after the invoice. After you've marked two checks received from the same client, that client's real average takes over.</p>
    <div class="ex"><span class="lbl">Example</span>Invoice Tue Nov 10. Wed Nov 11 is a holiday and doesn't count, so the 💰 lands Fri Nov 20.</div>
    <p>Filing a title as finished keeps its check on the calendar until you mark it received (green <b>IN</b> stamp).</p>`],
  ['k-bills','Bills and royalties',`
    <ul><li><b>Bills</b> repeat monthly. Mark one paid (click it, or "Paid internet $84" in a note) and it moves to the real day with a green <b>PAID</b> stamp.</li>
    <li><b>Learning:</b> after two paid months, a bill's expected day becomes the average of its last three payment days, and its amount the average of its last three payments (shown with a ~ on the Ledger).</li>
    <li><b>Royalties</b> are one pot, not tied to titles. After three deposits the tool forecasts a monthly amount (the average of your last three months) on the average day they've landed, shown in italics until it arrives.</li></ul>
    <div class="ex"><span class="lbl">Example</span>Electric paid $290 on Sep 11 and $340 on Oct 9. November's bill is expected around the 10th at <b>~$315</b>.</div>
    <p>The Ledger's running balance turns red when a bill lands before the check that covers it.</p>`],
  ['k-goals','Goals and the year report',`
    <p><b>The Year's Reckoning</b> on the Almanac tracks finished hours and net revenue against your goals (${n(c.goals.fh)} FH, ${money(c.goals.revenue)}). Solid bars are money received; hatched is what's forecast by Dec 31. It started from your block schedule's figures through October (${c.baseline.fh} FH, ${money(c.baseline.revenue)}).</p>
    <p><b>Year report</b> (Ledger tab) downloads one CSV for any year, including the current one: titles with real hours and hourly rate, every log line, Finished Hour data, checks, partner pass-throughs, royalties, bills paid, and a summary.</p>`],
  ['k-remind','Reminders',`
    <p>Two scheduled tasks reach Anne's phone. Neither ever pings Jack.</p>
    <ul><li><b>Weekdays at 3:41 PM Mountain:</b> a nudge only if there's no log for the day. It skips weekends, holidays and days off.</li>
    <li><b>Fridays at 3:53 PM Mountain:</b> the week's hours by title, stages finished, invoices and money received, deadlines in the next three weeks, and the next two weeks of checks and bills.</li></ul>`],
  ['k-terms','Terms',`
    <table class="led">
    <tr><td><b>FH</b></td><td>Finished hour: one hour of final audio. Rates are usually "PFH", per finished hour.</td></tr>
    <tr><td><b>Booth hours</b></td><td>Time actually recording, as Finished Hour counts it.</td></tr>
    <tr><td><b>Aim</b></td><td>A week before the due date. What the plan works toward.</td></tr>
    <tr><td><b>Solo</b></td><td>One narrator, no partner share.</td></tr>
    <tr><td><b>A</b></td><td>Jack and Anne duet. You keep it all.</td></tr>
    <tr><td><b>B</b></td><td>Duet with an outside narrator, usually 50/50.</td></tr>
    <tr><td><b>C</b></td><td>Outside narrator paid per word or a flat fee; you do most of the work.</td></tr>
    <tr><td><b>D</b></td><td>Someone else leads; you perform characters.</td></tr>
    <tr><td><b>Own project</b></td><td>Your own audio project, with a target date that never goes amber or red.</td></tr>
    <tr><td><b>Pipeline</b></td><td>Maybes, kept off the calendar until committed.</td></tr></table>`]
  ];
  return `<h2>A Key to the Ledger &amp; Lamp</h2><p class="muted" style="margin-top:0">How to read it, how it reckons, and what it will do with what you tell it. The examples use your current settings.</p>
  <div class="key"><nav aria-label="Contents">${S_.map(([id,h])=>`<button data-act="toc" data-to="${id}">${h}</button>`).join('')}</nav>
  <article>${S_.map(([id,h,b])=>`<section id="${id}"><h3>${h}</h3>${b}</section>`).join('')}</article></div>`;
}

/* ============ SETTINGS ============ */
function viewSettings(){
  const c=S.cfg;const dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const y=+TODAY.slice(0,4);const hol=holidays(y);
  const person=p=>{const P=c.people[p];return `<div class="panel"><h3>${PNAME[p]}</h3>
   <div class="grid3"><label class="f">Hours a day<input class="in" data-cfg="people.${p}.hours" type="number" step="0.5" value="${P.hours}"></label>
   <label class="f">Booth pace (words/hr)<input class="in" data-cfg="people.${p}.wph" type="number" value="${P.wph}"><span style="font-size:12px">${liveWph(p)?`Booth, last 30 days: <b>${liveWph(p).toLocaleString()}</b> (used for forecasts)`:'Used until the Booth has 3+ hours in the last 30 days'}</span></label>
   <label class="f">Edit hours per FH<input class="in" data-cfg="people.${p}.editPerFH" type="number" step="0.05" value="${P.editPerFH}"></label>
   <label class="f">Pickup hours per FH<input class="in" data-cfg="people.${p}.pickupsPerFH" type="number" step="0.05" value="${P.pickupsPerFH}"></label>
   <label class="f">Deliver &amp; invoice hours<input class="in" data-cfg="people.${p}.adminPerTitle" type="number" step="0.25" value="${P.adminPerTitle}"></label>
   <label class="f">Writing pace (words/hr)<input class="in" data-cfg="people.${p}.writeWph" type="number" value="${P.writeWph}"></label></div>
   <div class="row" style="margin-top:8px">Works: ${dn.map((d,i)=>`<label class="row" style="gap:2px"><input type="checkbox" data-days="${p}" value="${i}" ${P.days.includes(i)?'checked':''}>${d}</label>`).join('')}</div>
   <p class="muted" style="font-size:13px;margin:6px 0 0">These paces update on their own each time a stage is finished. Edit them anytime.</p></div>`;};
  return `<h2>Settings</h2><div class="grid2" style="align-items:start"><div class="side">${person('anne')}${person('jack')}</div><div class="side">
  <div class="panel"><h3>The house rules</h3><div class="grid2">
   <label class="f">Words per finished hour<input class="in" data-cfg="wordsPerFH" type="number" value="${c.wordsPerFH}"></label>
   <label class="f">Aim to deliver (workdays before the due date)<input class="in" data-cfg="weekEarly" type="number" value="${c.weekEarly}"></label>
   <label class="f">Extra workdays in the "comfortable" quote<input class="in" data-cfg="comfortDays" type="number" value="${c.comfortDays}"></label>
   <label class="f">Default head start, fewer-words narrator (workdays)<input class="in" data-cfg="headStart" type="number" value="${c.headStart}"></label>
   <label class="f">Editor starts after the second narrator starts (workdays)<input class="in" data-cfg="editLag" type="number" value="${c.editLag}"></label>
   <label class="f">Our edits finish after the last recording day (workdays)<input class="in" data-cfg="tailIn" type="number" value="${c.tailIn}"></label>
   <label class="f">Outsourced edits finish after the last recording day (workdays)<input class="in" data-cfg="tailOut" type="number" value="${c.tailOut}"></label>
   <label class="f">Outsourced editor rate ($ per finished hour)<input class="in" data-cfg="editorRate" type="number" step="0.01" value="${c.editorRate}"></label>
   <label class="f">Check clears (workdays after invoice; each client learns its own after 2 checks)<input class="in" data-cfg="clearDays" type="number" value="${c.clearDays}"></label>
   <label class="f">Pickup list arrives (workdays after invoice)<input class="in" data-cfg="pickupDelay" type="number" value="${c.pickupDelay}"></label>
   <label class="f">Book editor turnaround (workdays)<input class="in" data-cfg="editorDays" type="number" value="${c.editorDays}"></label></div></div>
  <div class="panel"><h3>Goals</h3><div class="grid2">
   <label class="f">Finished hours this year<input class="in" data-cfg="goals.fh" type="number" value="${c.goals.fh}"></label>
   <label class="f">Revenue this year $<input class="in" data-cfg="goals.revenue" type="number" value="${c.goals.revenue}"></label>
   <label class="f">Carried in: FH already paid in ${c.baseline.year}<input class="in" data-cfg="baseline.fh" type="number" step="0.01" value="${c.baseline.fh}"></label>
   <label class="f">Carried in: revenue already received $<input class="in" data-cfg="baseline.revenue" type="number" value="${c.baseline.revenue}"></label></div>
   <p class="muted" style="font-size:13px;margin:6px 0 0">The carried-in figures come from your 2026 block schedule (checks through October).</p></div>
  <div class="panel"><h3>Holidays, ${y}</h3><div style="font-size:15px">${Object.entries(hol).map(([d,n])=>`<label class="row" style="gap:6px"><input type="checkbox" data-hol="${esc(n)}" ${c.skipHolidays.includes(n)?'':'checked'}> ${esc(n)} <span class="muted">${fmt(d)}</span></label>`).join('')}</div>
  <p class="muted" style="font-size:13px;margin:6px 0 0">Unchecked holidays count as workdays. Add your own days off in the Work Log.</p></div></div></div>`;
}

/* ============ popovers & modals ============ */
function modal(html,wide){closeModal();const l=$('#layer');setTimeout(payHint,0);l.innerHTML=`<div class="scrim" data-act="scrim"><div class="modal" role="dialog" aria-modal="true" ${wide?'style="max-width:980px"':''}>${html}</div></div>`;setTimeout(()=>l.querySelector('input,select,textarea,button')?.focus(),20);}
function closeModal(){$('#layer').innerHTML='';PREV=PREV&&PREV._keep?PREV:PREV;}
let popEl=null;
function pop(html,anchor){closePop();popEl=document.createElement('div');popEl.className='pop';popEl.innerHTML=html;document.getElementById('llpops').appendChild(popEl);
  const r=anchor.getBoundingClientRect();let x=Math.min(r.left,innerWidth-popEl.offsetWidth-10),yy=r.bottom+6;if(yy+popEl.offsetHeight>innerHeight-10)yy=r.top-popEl.offsetHeight-6;popEl.style.left=Math.max(8,x)+'px';popEl.style.top=Math.max(8,yy)+'px';}
function closePop(){popEl?.remove();popEl=null;}
function checkPopHTML(t){const m=moneyOf(t);const o=S.sim.out[t.id];
  return `<b>${esc(t.name)}</b><table class="money num">${t.partnerPaidByClient?`<tr><td>Our check (${esc(t.client||'client')})</td><td>${money(ourCheck(t))}</td></tr><tr><td colspan="2" class="muted">${esc(t.partnerName||'Partner')} is paid ${money(m.partner)} directly by the client</td></tr>`:`<tr><td>Check (${esc(t.client||'client')})</td><td>${money(ourCheck(t)+m.partner)}</td></tr>${m.partner?`<tr><td>${esc(t.partnerName||'Partner')}'s share, passed on</td><td>−${money(m.partner)}</td></tr>`:''}`}${m.software?`<tr><td>Software</td><td>−${money(m.software)}</td></tr>`:''}${m.editor?`<tr><td>Editor</td><td>−${money(m.editor)}</td></tr>`:''}<tr class="tot"><td>Ours</td><td>${money(ourCheck(t)-m.software-m.editor)}</td></tr></table>
  <div class="muted" style="margin-top:4px">${t.checkDate?'Received '+fmt(t.checkDate):`Expected ${fmt(checkDateOf(t))} · ${t.invoiceDate?'invoiced '+fmtShort(t.invoiceDate):'invoice forecast '+fmtShort(o?.finish)}`}</div>
  ${!t.checkDate?`<div style="margin-top:6px"><button class="btn small" data-act="check-recv" data-id="${t.id}">Check received</button></div>`:''}`;}
function titlePopHTML(t){const o=S.sim.out[t.id]||{};
  return `<b>${esc(t.name)}</b><div class="muted">${t.kind==='author'?'Author work':esc(t.client||'')}${t.due?' · due '+fmtShort(t.due):''}${hardDue(t)?' · aim '+fmtShort(targetOf(t)):''}${t.starred?' · ⭐ starred':''}</div>
  <div style="margin:4px 0">${o.late?`<span class="stamp over">Overdue · ${fmtShort(o.finish)}</span> needs ~${hrs(o.ot)} overtime`:o.amber?`<span class="stamp amb">Into the week · ${fmtShort(o.finish)}</span> ~${hrs(o.otTarget)} overtime gets it back`:o.finish?`<span class="stamp ok">${t.kind==='author'?'Ready':'Delivers'} ${fmtShort(o.finish)}</span>`:''}</div>
  <div style="font-size:13px">${(t.stages||[]).map(s=>`${s.done?'✓':'·'} ${esc(stageLabel(s))}${s.done?'':' → '+fmtShort(S.sim.byKey[t.id+'|'+s.id]?.finish)}`).join('<br>')}</div>
  <div style="margin-top:6px"><button class="btn small" data-act="edit-title" data-id="${t.id}">Open card</button></div>`;}
function billPopHTML(b,ym){const p=b.paid?.[ym],late=billLateDays(b,ym),due=billDue(b,ym),owed=!p&&late&&ym>=trackFrom(b);return `<b>${esc(b.name)} · ${monthName(ym)}</b><div class="num">${money(billAmount(b,ym))} · ${p?'paid '+fmt(p.date)+(late?` <span class="stamp over">${late} days late</span>`:''):owed?'was due '+fmt(due)+` <span class="stamp over">Late · ${late} days</span>`:'expected '+fmt(due)}</div>
  ${p?`<div style="margin-top:6px"><button class="btn small" data-act="bill-unpay" data-id="${b.id}" data-ym="${ym}">Undo paid</button></div>`:
  `<div class="row" style="margin-top:6px"><input type="date" id="bp-date" class="in" value="${TODAY<=billDue(b,ym)||owed?TODAY:billDue(b,ym)}" aria-label="Paid on"><input type="number" id="bp-amt" class="in" style="width:90px" value="${b.amount}" aria-label="Amount"><button class="btn small primary" data-act="bill-pay" data-id="${b.id}" data-ym="${ym}">Paid</button></div>`}`;}
function noticeDraft(t){const o=S.sim.out[t.id];const nd=addBD(o.finish,2);
  return `Hi ${t.client||'there'},

A quick heads-up on ${t.name}. We're running behind our ${fmt(t.due)} delivery date and would rather give you a real number now than a surprise later.

Our revised delivery date is ${fmt(nd)}. Everything else about the production stays as planned.

Let us know if that works on your end, or if there's a hard date we should be working toward.

Thanks,
${PNAME.anne}${(Store.settings.narrators || []).length > 1 ? " & " + PNAME.jack : ""}`;}

/* ============ events ============ */
document.addEventListener('click',async ev=>{
  if(!ev.target.closest('.ll')){closePop();return;}
  const a=ev.target.closest('[data-act]');
  if(popEl&&!ev.target.closest('.pop')&&!(a&&a.dataset.act.endsWith('-pop')))closePop();
  if(!a)return;const act=a.dataset.act,id=a.dataset.id;
  if(act==='scrim'){if(ev.target===a)closeModal();return;}
  switch(act){
    case 'close':closeModal();break;
    case 'mon':{if(a.dataset.d==='0')S.month=TODAY.slice(0,7);else{const [y,m]=S.month.split('-').map(Number);const d=new Date(y,m-1+(+a.dataset.d),1,12);S.month=iso(d).slice(0,7);}rerender();break;}
    case 'led-mon':{const [y,m]=ledMonth.split('-').map(Number);ledMonth=iso(new Date(y,m-1+(+a.dataset.d),1,12)).slice(0,7);rerender();break;}
    case 'title-pop':{const t=tById(id);if(t)pop(titlePopHTML(t),a);break;}
    case 'check-pop':{const t=tById(id);if(t)pop(checkPopHTML(t),a);break;}
    case 'bill-pop':{const b=S.bills.find(x=>x.id===id);if(b)pop(billPopHTML(b,a.dataset.ym),a);break;}
    case 'bill-pay':{const b=S.bills.find(x=>x.id===id);const ym=a.dataset.ym;const date=val('bp-date')||TODAY;const n=Math.round((D(date)-D(billDue(b,ym)))/864e5);closePop();await patch('bills',id,{paid:{...(b.paid||{}),[ym]:{date,amount:+val('bp-amt')||b.amount,...(n>LATE_GRACE?{late:n}:{})}}});break;}
    case 'bill-unpay':{const b=S.bills.find(x=>x.id===id);const p={...(b.paid||{})};delete p[a.dataset.ym];closePop();await put('bills',id,{...stripId(b),paid:p});break;}
    case 'bill-edit':{const b=S.bills.find(x=>x.id===id)||{name:'',amount:'',day:1};modal(`<h2>${id?'Edit':'Add a'} bill</h2><div class="grid3"><label class="f">Name<input id="b-name" value="${esc(b.name)}"></label><label class="f">Amount $<input id="b-amt" type="number" step="0.01" value="${esc(b.amount)}"></label><label class="f">Due day of month<input id="b-day" type="number" min="1" max="31" value="${esc(b.day)}"></label></div>
      <label class="f" style="max-width:260px">Unpaid months count as late from<input id="b-track" type="month" value="${esc(b.trackFrom||BILL_TRACK_FROM)}"></label><p class="muted" style="font-size:13px;margin:2px 0 0">Months before this are treated as settled.</p>
      <div class="foot">${id?`<button class="btn danger" data-act="bill-del" data-id="${id}" style="margin-right:auto">Delete</button>`:''}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="bill-save" data-id="${id||''}">Save</button></div>`);break;}
    case 'bill-save':{const b=S.bills.find(x=>x.id===id);const doc={...(b?stripId(b):{paid:{}}),name:val('b-name')||'Bill',amount:+val('b-amt')||0,day:+val('b-day')||1,active:true,trackFrom:val('b-track')||BILL_TRACK_FROM};closeModal();await put('bills',id||'bill-'+uid(),doc);break;}
    case 'roy-pop':{const dp=S.deposits.find(x=>x.id===id);const m=royaltyModel();
      pop(dp?`<b>Royalties received</b><div class="num">${money(dp.amount)} · ${fmt(dp.date)}</div>${dp.note?`<div class="muted">${esc(dp.note)}</div>`:''}<div style="margin-top:6px"><button class="btn small" data-act="roy-del" data-id="${dp.id}">Remove</button></div>`
        :`<b>Royalties, forecast</b><div class="num">~${money(m?.amount||0)}</div><div class="muted">Average of your last three months, landing around the ${ord(m?.day||1)}.</div>`,a);break;}
    case 'roy-add':{const amt=+val('roy-amt');if(!amt){toast('Enter an amount.');break;}await put('deposits','dep-'+uid(),{date:val('roy-date')||TODAY,amount:amt,kind:'royalty',note:'',by:S.me||''});toast('Royalties recorded.');break;}
    case 'roy-del':{if(a.dataset.confirm!=='1'){a.dataset.confirm='1';a.textContent='click again';break;}closePop();await del('deposits',id);break;}
    case 'bill-del':closeModal();await del('bills',id);break;
    case 'new-title':titleForm(null,a.dataset.kind);break;
    case 'edit-title':closePop();titleForm(structuredClone(tById(id)));break;
    case 'save-title':{const t=formToTitle(a.dataset.kind,id);const nid=id||('t-'+uid());const pid=a.dataset.pid;closeModal();
      if(await put('titles',nid,stripId(t))){if(pid)await del('pipeline',pid);toast(id?'Card updated.':'Added to the catalog.');}break;}
    case 'del-title':{if(a.dataset.confirm!=='1'){a.dataset.confirm='1';a.textContent='Click again to delete';break;}closeModal();await del('titles',id);break;}
    case 'suggest-due':{const t=formToTitle('narration',null);t.id='__new';t.due=null;t.status='active';
      if(!(t.stages||[]).some(s=>s.type==='record'||s.type==='ext')){$('#sugg').textContent='Add word counts first.';break;}
      buildIndex();const sim=simulate(t);const f=sim.out['__new']?.finish;if(!f){$('#sugg').textContent='Not within a year at current pace.';break;}
      const wk=+S.cfg.weekEarly||5,early=addBD(f,wk),safe=addBD(f,wk+(+S.cfg.comfortDays||2));
      $('#sugg').innerHTML=`You'd finish around ${fmt(f)}. Quote: <button class="lnk" data-act="use-due" data-d="${early}">${fmt(early)}</button> (a week of slack) · <button class="lnk" data-act="use-due" data-d="${safe}"><b>${fmt(safe)}</b></button> (comfortable)`;break;}
    case 'use-due':{const el=document.getElementById('f-due');if(el)el.value=a.dataset.d;break;}
    case 'stage':{const t=tById(id);const s=t?.stages.find(x=>x.id===a.dataset.sid);if(s)await setStageDone(id,s.id,!s.done,TODAY);break;}
    case 'check-recv':{const t=tById(id);closePop();const m=moneyOf(t);modal(`<h2>Check received · ${esc(t.name)}</h2><div class="grid2"><label class="f">Cleared on<input id="cr-date" type="date" value="${TODAY}"></label><label class="f">Amount $<input id="cr-amt" type="number" step="0.01" value="${(t.partnerPaidByClient?m.gross-m.partner:m.gross).toFixed(2)}"></label><p class="muted" style="grid-column:1/-1;margin:0;font-size:13px">${m.partner?(t.partnerPaidByClient?'Just your share. The client pays the partner directly.':`The full check. ${money(m.partner)} of it is the partner's and isn't counted as income.`):''}</p><label style="display:none"></label></div>
      <div class="foot"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="check-save" data-id="${id}">Record it</button></div>`);break;}
    case 'check-save':{const d=val('cr-date')||TODAY,amt=+val('cr-amt')||0;closeModal();const t=tById(id);await patch('titles',id,{checkDate:d,checkAmount:amt,...(t.invoiceDate?{}:{invoiceDate:d})});toast('Into the ledger.');break;}
    case 'star':{const t=tById(id);if(!t)break;const on=!t.starred;
      for(const o of S.titles.filter(x=>x.starred&&x.id!==id))await patch('titles',o.id,{starred:false});
      await patch('titles',id,{starred:on});toast(on?`⭐ ${shortOf(t)} goes first, deadlines permitting.`:'Star removed.');break;}
    case 'reopen':await patch('titles',id,{status:'active'});toast('Back on the active list.');break;
    case 'partner-paid':await patch('titles',id,{partnerPaidDate:TODAY});break;
    case 'archive':{const t=tById(id);if(a.dataset.confirm!=='1'){a.dataset.confirm='1';a.textContent='Click again to file it';break;}
      await patch('titles',id,{status:'done',...(t.kind==='author'?{publishedDate:TODAY}:{}),...(t.invoiceDate||t.kind==='author'?{}:{invoiceDate:TODAY})});break;}
    case 'commit':{const p=S.pipeline.find(x=>x.id===id);const ours=n=>/^(anne|jack)$/i.test((n||'').trim());const isJA=ours(p.narrator)&&ours(p.partner);const outside=[p.narrator,p.partner].find(n=>n&&!ours(n))||'';
      titleForm({kind:'narration',status:'active',color:nextInk(),name:p.name,short:p.short||'',client:p.client||'',category:isJA?'A':'B',rateModel:'pfh',rate:p.rate||200,estFH:p.fh||null,software:p.software||0,partnerName:isJA?'':outside,
        stages:[],_pipelineId:p.id});break;}
    case 'pipe-new':modal(`<h2>Add a maybe</h2><div class="grid3"><label class="f">Title<input id="p-name"></label><label class="f">Client<input id="p-client" list="clients"></label><label class="f">Narrator / partner<input id="p-who" placeholder="Jack / Anne"></label>
      <label class="f">Words<input id="p-words" type="number"></label><label class="f">Est. FH<input id="p-fh" type="number" step="0.1"></label><label class="f">Est. net $<input id="p-net" type="number"></label></div><label class="f" style="margin-top:8px">Note<input id="p-note"></label>
      <datalist id="clients">${clientOpts()}</datalist><div class="foot"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="pipe-save">Add</button></div>`);break;
    case 'pipe-save':{const [n,pa]=val('p-who').split('/').map(s=>s?.trim());const doc={name:val('p-name')||'Untitled',client:val('p-client'),narrator:n||'',partner:pa||'',words:+val('p-words')||0,fh:+val('p-fh')||0,net:+val('p-net')||0,note:val('p-note'),rate:200,order:99};closeModal();await put('pipeline','p-'+uid(),doc);break;}
    case 'pipe-del':{if(a.dataset.confirm!=='1'){a.dataset.confirm='1';a.textContent='click again';break;}await del('pipeline',id);break;}
    case 'read-log':{a.disabled=true;a.textContent='Reading…';const txt=$('#qlog')?.value||'';const dt=$('#qdate')?.value||TODAY;
      try{await readLog(txt,dt,S.me||'anne');}catch(e){console.error(e);toast("I couldn't read that note. Enter it by hand.");logPreview({id:null,date:dt,person:S.me||'anne',raw:txt,entries:[{person:S.me||'anne',titleId:null,stageId:null,kind:'admin',hours:null,finished:false,note:txt.slice(0,120)}],payments:[],daysOff:[]});}
      finally{a.disabled=false;a.textContent='Read my note';}break;}
    case 'log-hand':{logPreview(handLog(val('qdate')||TODAY));break;}
    case 'link-book':{LLV.linkBook&&LLV.linkBook(id);break;}
    case 'open-book':{LLV.openBook&&LLV.openBook(id);break;}
    case 'log-for':{if(location.hash!=='#/almanac'){location.hash='#/almanac';await new Promise(r=>setTimeout(r,120));}else render();const qd=$('#qdate');if(qd)qd.value=a.dataset.date;$('#qlog')?.focus();break;}
    case 'ent-add':syncPrevFromForm();PREV.entries.push({person:PREV.person,titleId:null,stageId:null,kind:'admin',hours:null,finished:false,note:''});logPreview(PREV);break;
    case 'ent-del':syncPrevFromForm();PREV.entries.splice(+a.dataset.i,1);logPreview(PREV);break;
    case 'log-save':await saveLog();break;
    case 'log-edit':{const l=S.logs.find(x=>x.id===id);if(l)logPreview({...structuredClone(l),entries:structuredClone(l.entries||[]),daysOff:[]});break;}
    case 'log-del':{if(a.dataset.confirm!=='1'){a.dataset.confirm='1';a.textContent='click again';break;}await del('logs',id);break;}
    case 'dismiss':await saveCfg({dismissed:{...(S.cfgDoc?.dismissed||{}),[a.dataset.k]:TODAY}});break;
    case 'ent-x':{if(!a.classList.contains('sure')){a.classList.add('sure');a.textContent='remove?';break;}
      const l=S.logs.find(x=>x.id===id);if(!l)break;const entries=(l.entries||[]).filter((_,i)=>i!==+a.dataset.i);await patch('logs',id,{entries});toast('Entry removed.');break;}
    case 'ot-ok':await patch('logs',id,{ot:'confirmed'});break;
    case 'notice':{const t=tById(id);const txt=noticeDraft(t);modal(`<h2>Client notice · ${esc(t.name)}</h2><textarea id="nt" class="in" rows="12" style="width:100%">${esc(txt)}</textarea><div class="foot"><button class="btn" data-act="close">Close</button><button class="btn primary" data-act="copy-notice">Copy</button></div>`);break;}
    case 'copy-notice':try{await navigator.clipboard.writeText($('#nt').value);toast('Copied.');}catch(e){$('#nt').select();toast('Select all and copy.');}break;
    case 'fh-save':{const rows=PREV?.fhRows||[];closeModal();for(const r of rows)await put('fh','fh-'+r.date+'-'+r.person+'-'+(r.titleId||'x')+'-'+uid().slice(0,4),{date:r.date,person:PEOPLE.includes(r.person)?r.person:(S.me||'anne'),titleId:r.titleId||null,boothHours:+r.boothHours||0,words:+r.words||0});toast('Booth time filed.');break;}
    case 'fh-del':await del('fh',id);break;
    case 'off-add':{let f=val('off-from'),t=val('off-to')||f;if(!f)break;if(t<f)[f,t]=[t,f];const who=val('off-who'),why=val('off-why');let d=f,n=0;while(d<=t&&n++<60){await put('daysoff','off-'+d+'-'+who,{date:d,person:who,reason:why});d=addDays(d,1);}toast('Marked. Forecasts moved.');break;}
    case 'off-del':await del('daysoff',id);break;
    case 'report':{const y=val('rep-year');const csv=reportCSV(y);
      if(S.dl){try{await S.dl.save({filename:`ledger-and-lamp-${y}.csv`,data:csv});}catch(e){if(e?.code!=='declined')copyFallback(csv);}}else copyFallback(csv);break;}
    case 'switch-me':whoModal();break;
    case 'set-me':{S.me=a.dataset.p;try{localStorage.setItem('ll-me',S.me);}catch(e){}closeModal();if(S.db&&S.uid)put('members',S.uid,{person:S.me});rerender();break;}
    case 'toc':{document.getElementById(a.dataset.to)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});break;}
    case 'mic':toggleMic(a);break;
  }
});
function copyFallback(csv){modal(`<h2>Year report</h2><p>Downloads aren't available in this view. Copy the CSV and paste it into a sheet.</p><textarea id="nt" class="in" rows="10" style="width:100%">${esc(csv)}</textarea><div class="foot"><button class="btn" data-act="close">Close</button><button class="btn primary" data-act="copy-notice">Copy</button></div>`);}
const stripId=o=>{const {id,...r}=o;return r;};
document.addEventListener('change',async ev=>{
  const el=ev.target;if(!el.closest('.ll'))return;
  if(el.id==='tgl-partner'){S.showPartner=el.checked;try{localStorage.setItem('ll-partner',el.checked?'1':'0');}catch(e){}rerender();return;}
  if(el.id==='log-p'){logFilter.p=el.value;rerender();return;}
  if(el.closest('.modal')&&/^f-/.test(el.id||''))payHint();
  if(el.closest('#ent-rows')&&el.dataset.f==='titleId'){syncPrevFromForm();const i=+el.closest('.ent-row').dataset.i;PREV.entries[i].stageId=null;logPreview(PREV);return;}
  if(el.name==='ink'){document.querySelectorAll('input[name=ink]+.swatch').forEach(s=>s.style.outline='none');el.nextElementSibling.style.outline='2px solid var(--ink)';return;}
  if(el.dataset.cfg){const path=el.dataset.cfg.split('.');const v=+el.value;const doc=structuredClone(S.cfgDoc||{});let o=doc;for(let i=0;i<path.length-1;i++){o[path[i]]=o[path[i]]||{};o=o[path[i]];}o[path.at(-1)]=v;
    if(path[0]==='baseline'&&!doc.baseline.year)doc.baseline.year=S.cfg.baseline.year;await saveCfg(doc);return;}
  if(el.dataset.days){const p=el.dataset.days;const days=[...document.querySelectorAll(`[data-days="${p}"]`)].filter(x=>x.checked).map(x=>+x.value);const P=structuredClone(S.cfgDoc?.people||{});P[p]={...(P[p]||{}),days};await saveCfg({people:P});return;}
  if(el.dataset.hol){const n=el.dataset.hol;const skip=new Set(S.cfg.skipHolidays);if(el.checked)skip.delete(n);else skip.add(n);await saveCfg({skipHolidays:[...skip]});return;}
});
function payHint(){
  const el=document.getElementById('money-sum');if(!el)return;
  const cat=val('f-cat');
  const words=(+val('f-wa')||0)+(+val('f-wj')||0)+((cat==='B'||cat==='C')?(+val('f-pw')||0):0);const fh=+val('f-fh')||words/S.cfg.wordsPerFH;
  const gross=val('f-rm')==='per2k'?(+val('f-rate')||0)*words/2000:(+val('f-rate')||0)*fh;
  const sw=+val('f-sw')||0;
  const editor=val('f-ed')==='outsourced'?((+val('f-ec')>0)?+val('f-ec'):(+S.cfg.editorRate||50)*fh):0;
  const partner=(cat==='B'||cat==='C')?partnerPay(val('f-pmode'),+val('f-pt')||0,gross,+val('f-pw')||0):0;
  const keep=gross-sw-editor-partner;
  const parts=[`Check ${money(gross)}`];
  if(sw)parts.push(`software −${money(sw)}`);
  if(val('f-ed')==='outsourced')parts.push(`editor −${money(editor)}${+val('f-ec')>0?'':` <span class="muted">(${fh.toFixed(2)} FH × $${S.cfg.editorRate})</span>`}`);
  if(cat==='B'||cat==='C')parts.push(`${esc(val('f-pn')||'partner')} −${money(partner)}`);
  el.innerHTML=`${parts.join(' · ')} · <b>you keep ${money(keep)}</b>${gross&&partner>gross?' <span style="color:var(--overdue)">(partner pay is more than the check: check the decimal)</span>':''}`;
  el.classList.toggle('neg',keep<0);
}
document.addEventListener('input',ev=>{if(ev.target.closest('.modal')&&/^f-/.test(ev.target.id||''))payHint();});
let qT;document.addEventListener('input',ev=>{if(ev.target.id==='log-q'){clearTimeout(qT);qT=setTimeout(()=>{logFilter.q=ev.target.value;const pos=ev.target.selectionStart;rerender();requestAnimationFrame(()=>{const e=$('#log-q');if(e){e.focus();e.setSelectionRange(pos,pos);}});},300);}});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'){closePop();if($('#layer').innerHTML)closeModal();}});

/* dictation */
let micOn=false,micBase='';
function toggleMic(btn){
  if(!S.dict)return;
  if(micOn){S.dict.stop().catch(()=>{});return;}
  const ta=$('#qlog');micBase=ta.value?ta.value.replace(/\s*$/,' '):'';
  S.dict.start().catch(e=>{micOn=false;btn.classList.remove('live');if(e?.code==='not_granted')toast('Microphone declined. Typing works fine.');});
}
function wireDictation(){
  if(!S.dict)return;
  S.dict.onPartial(({text})=>{const ta=$('#qlog');if(ta)ta.value=micBase+text;});
  S.dict.onFinal(({text})=>{micBase=(micBase+text).replace(/\s*$/,' ');const ta=$('#qlog');if(ta)ta.value=micBase;});
  S.dict.onState(({state})=>{micOn=state==='listening';const b=$('#micbtn');if(b){b.classList.toggle('live',micOn);b.title=micOn?'Stop':'Dictate';}});
}
function afterRender(){const b=$('#micbtn');if(b){b.hidden=!S.dict;b.classList.toggle('live',micOn);}}

/* who */
function whoModal(){modal(`<h2>Who's at the desk?</h2><p>Your calendar shows your own bars first, with your partner as faded ghosts when you want them.</p><div class="row"><button class="btn primary" data-act="set-me" data-p="anne">Anne</button><button class="btn primary" data-act="set-me" data-p="jack">Jack</button></div>`);}

/* ============ boot ============ */
/* ============ the Lamp Room wiring ============ */
// LLV: the view host. el = where the current Ledger & Lamp screen draws; the app fills in the hooks.
const LLV = { el: null, onChange: null, decorate: null, linkBook: null, openBook: null };

// people: Ledger & Lamp's keys are anne / jack; the names come from the Lamp Room's narrators
function keyOf(name) {
  const n = String(name || "").trim().toLowerCase(), N = (Store.settings.narrators || []).map(x => String(x.name || "").toLowerCase());
  if (n === "anne" || n === "jack") return n;
  const i = N.indexOf(n); return i === 0 ? "anne" : i === 1 ? "jack" : null;
}
function nameOf(k) { return PNAME[k] || k; }
function syncNames() {
  const N = Store.settings.narrators || [];
  PNAME.anne = (N[0] && N[0].name) || "Anne"; PNAME.jack = (N[1] && N[1].name) || "Jack";
  CAT.A = "A · " + (N.length > 1 ? PNAME.jack + " & " + PNAME.anne : "Both of us");
}

// the records live in Store.ll; S mirrors them
function syncS() {
  for (const c of ["titles", "logs", "bills", "daysoff", "pipeline", "deposits"]) S[c] = Store.ll[c];
  S.fh = (Store.ll.fh || []).concat(S.boothFh || []);
  if (S.cfgDoc !== Store.ll.config) { S.cfgDoc = Store.ll.config ? structuredClone(Store.ll.config) : null; S.cfg = mergeCfg(S.cfgDoc); }
}
// a title's name, due date, client and colour follow onto its book (and the Lamp Room's dashboard)
function afterSave(coll, id) {
  if (coll !== "titles") return;
  const t = tById(id); if (!t) return;
  for (const b of Store.books.filter(b => b.titleId === id)) {
    let ch = false;
    const set = (k, v) => { if (v !== undefined && b[k] !== v) { b[k] = v; ch = true; } };
    set("title", t.name); set("due", t.due || ""); set("client", t.client || ""); set("color", t.color || b.color);
    if (ch) Store.saveBook(b);
  }
}

// booth sessions → the "fh" figures the scheduler learns from (booth hours and words, by person, title and day)
async function loadBoothFh() {
  const rows = {}, map = {};
  for (const b of Store.books) if (b.titleId) map[b.id] = b.titleId;
  for (const k of PEOPLE) {
    let list = []; try { list = await Store.sessions(nameOf(k), 14); } catch (e) {}
    for (const s of list) {
      if (!s.date) continue;
      const tid = map[s.titleId] || null, key = s.date + "|" + k + "|" + (tid || "x");
      const r = rows[key] = rows[key] || { id: "booth-" + key.replace(/\|/g, "-"), date: s.date, person: k, titleId: tid, words: 0, boothHours: 0, auto: true };
      r.words += +s.words || 0; r.boothHours += (+s.boothSec || 0) / 3600;
    }
  }
  S.boothFh = Object.values(rows).filter(r => r.words || r.boothHours > 0.01).map(r => Object.assign(r, { boothHours: Math.round(r.boothHours * 100) / 100 }));
  syncS();
}

// "Log by hand": today's booth time is already filled in; add lines for the rest
function handLog(date) {
  const me = S.me || "anne", entries = [];
  const booth = S.fh.filter(f => f.auto && f.date === date && f.person === me && f.titleId);
  for (const f of booth) { const t = tById(f.titleId), s = t && (t.stages || []).find(x => x.type === "record" && x.owner === me); entries.push({ person: me, titleId: f.titleId, stageId: s ? s.id : null, kind: "work", hours: f.boothHours, finished: false, note: "Booth · " + (+f.words || 0).toLocaleString() + " words" }); }
  entries.push({ person: me, titleId: null, stageId: null, kind: "admin", hours: null, finished: false, note: "" });
  return { id: null, date, person: me, raw: "", entries, payments: [], billsPaid: [], royalties: [], daysOff: [] };
}

// Notes are read on this computer with a simple word-matcher (no AI, nothing sent anywhere).
function makeSample() { return null; }
// dictation into the "Today I…" box, with Chrome's speech recognition
function makeDict() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return null;
  let r = null, cb = { p: null, f: null, s: null };
  return {
    onPartial(f) { cb.p = f; }, onFinal(f) { cb.f = f; }, onState(f) { cb.s = f; },
    async start() { r = new SR(); r.continuous = true; r.interimResults = true; r.lang = "en-US";
      r.onresult = ev => { let fin = "", part = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += t; else part += t; } if (fin && cb.f) cb.f({ text: fin.trim() }); else if (cb.p) cb.p({ text: part.trim() }); };
      r.onend = () => cb.s && cb.s({ state: "idle" }); r.start(); cb.s && cb.s({ state: "listening" }); },
    async stop() { if (r) r.stop(); }
  };
}
const downloader = { async save({ filename, data }) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "text/csv" })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); } };

let booted = false;
async function init() {
  syncNames();
  syncS();
  S.me = keyOf(Store.me()) || "anne";
  S.sample = makeSample(); S.dict = makeDict(); S.dl = downloader; wireDictation();
  S.loaded = true; S.offline = false;
  if (!booted) {
    booted = true;
    document.addEventListener("lr-external", e => { syncS(); const d = e.detail || []; if (d.some(x => x.startsWith("book:"))) loadBoothFh().then(rerender); else rerender(); });
    document.addEventListener("lr-saved", () => { clearTimeout(init._t); init._t = setTimeout(() => loadBoothFh().then(() => compute()), 4000); });
  }
  compute();
  loadBoothFh().then(() => { compute(); LLV.onChange && LLV.onChange(); });
}
function show(tab, el) { S.tab = tab; LLV.el = el; el.classList.add("ll"); syncNames(); S.sample = makeSample(); render(); }

window.LL = {
  init, show, compute, rerender, render, syncS, keyOf, nameOf, loadBoothFh, views: LLV,
  get S() { return S; }, PEOPLE, PNAME, STAGE_LABEL, CAT, INKS,
  tById, moneyOf, titleFH, partWords, checkDateOf, invoiceOf, ourCheck, netCheck, hardDue, targetOf, stageLabel, titleColor, shortOf,
  nextAlloc, waitingFor, alertsHTML, goalsHTML, saveCfg, estHours, remainingHours, wphOf, isWorkday, capacity, holidayName, dayOff, billDate, billAmount, billsOverdue, monthName,
  titleForm, cardHTML, settingsHTML: viewSettings, logPreview, handLog, monthEvents, put, patch, del, setStageDone, fmt, fmtShort, hrs, money, TODAY: () => TODAY, addDays, addBD, nextInk, uid
};

})();
