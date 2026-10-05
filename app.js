(function(){
'use strict';
/* ---------- 工具 ---------- */
var $ = function(s, el){ return (el||document).querySelector(s); };
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function hash(str){ var h=2166136261; for(var i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function seeded(seed){ var s=seed||1; return function(){ s=(s+0x6D2B79F5)|0; var t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
function shuffle(arr, rnd){ var a=arr.slice(); rnd=rnd||Math.random; for(var i=a.length-1;i>0;i--){ var j=Math.floor(rnd()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; } return a; }
function pad(n){ return n<10?'0'+n:''+n; }
function dayKey(d){ d=d||new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function pct(a,b){ return b? Math.round(a*100/b) : 0; }
var LETTERS=['A','B','C','D'];
var LVNAME={'730':'730','860':'860','900':'900+'};

/* ---------- 儲存 ---------- */
var PREFIX='toeic900_';
var memStore={};
var store={
  get:function(k,d){ try{ var v=localStorage.getItem(PREFIX+k); return v?JSON.parse(v):d; }catch(e){ return memStore[k]!==undefined?memStore[k]:d; } },
  set:function(k,v){ try{ localStorage.setItem(PREFIX+k,JSON.stringify(v)); }catch(e){ memStore[k]=v; } }
};
var S = {
  marks: store.get('marks',{}),      // word -> 'known' | 'unsure'
  wrong: store.get('wrong',{}),      // word -> 錯誤次數
  seen: store.get('seen',{}),        // word -> 1
  quiz: store.get('quiz',{total:0,correct:0,rounds:0,best:0}),
  listen: store.get('listen',{p2:{},p3:{},p4:{}}), // id -> [correct,total]
  days: store.get('days',{}),        // YYYY-MM-DD -> 活動次數
  settings: store.get('settings',{accent:'en-US',listenAccent:'mix',rate:1,autoSpeak:false,goal:20})
};
['p2','p3','p4'].forEach(function(p){ if(!S.listen[p]) S.listen[p]={}; });
function save(k){ store.set(k,S[k]); }
function bump(){ var k=dayKey(); S.days[k]=(S.days[k]||0)+1; save('days'); }

/* ---------- 資料整理 ---------- */
var WORDS=[]; var BYWORD={}; var WORD_SLUG={};
function slugify(w){ return String(w).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
THEMES.forEach(function(t){ t.words.forEach(function(a){ var w={w:a[0],pos:a[1],zh:a[2],ex:a[3],exZh:a[4],lv:a[5],note:a[6],theme:t.id,themeName:t.name,icon:t.icon}; WORDS.push(w); BYWORD[w.w]=w; WORD_SLUG[w.w]=slugify(w.w); }); });
var L = (typeof LDATA!=='undefined') ? LDATA : {p2:[],p3:[],p4:[]};
var AUDIO_MANIFEST = null; // loaded async from audio/manifest.json
fetch('audio/manifest.json').then(function(r){ return r.ok ? r.json() : null; }).then(function(m){ AUDIO_MANIFEST=m; }).catch(function(){});

/* ---------- 語音 (Web Speech API) ---------- */
var TTS = {
  ok: ('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window),
  voices: [], token: 0, playing:false, onstate:null,
  load: function(){ if(!TTS.ok) return; try{ TTS.voices = speechSynthesis.getVoices().filter(function(v){ return /^en([-_]|$)/i.test(v.lang); }); }catch(e){ TTS.voices=[]; } },
  norm: function(l){ return (l||'').replace('_','-').toLowerCase(); },
  byAccent: function(acc){ acc=acc.toLowerCase(); return TTS.voices.filter(function(v){ return TTS.norm(v.lang)===acc; }); },
  gender: function(v){
    var n=(v.name||'').toLowerCase();
    if(/female|woman|samantha|karen|moira|tessa|fiona|victoria|zira|susan|hazel|catherine|serena|allison|\bava\b|kate|aria|jenny|libby|sonia|natasha|emma|olivia|salli|joanna|kendra|kimberly|ivy|amy|nicole|michelle|sara|elizabeth|linda|heather|zoe|ella|clara|google us english$/.test(n)) return 'F';
    if(/\bmale\b|daniel|alex\b|fred|david|mark|george|james|\blee\b|oliver|\btom\b|rishi|aaron|arthur|gordon|guy|ryan|thomas|eric|christopher|brian|matthew|russell|william|liam|andrew|roger|steffan|noah|google uk english male/.test(n)) return 'M';
    return '?';
  },
  pick: function(acc, g, avoid, cross){
    var base = acc==='any' ? TTS.voices : TTS.byAccent(acc);
    var en = TTS.voices;
    function ok(v, needG, needNew){ return (!needG || !g || TTS.gender(v)===g) && (!needNew || !avoid || avoid.indexOf(v)<0); }
    function first(list){ var loc=list.filter(function(v){ return v.localService; }); return (loc.length?loc:list)[0]; }
    var tries = [[base,true,true]];
    if(cross) tries.push([en,true,true]);
    tries.push([base,false,true]);
    if(cross) tries.push([en,false,true]);
    tries.push([base,true,false],[base,false,false],[TTS.byAccent('en-US'),false,false],[en,false,false]);
    for(var t=0;t<tries.length;t++){ var c=tries[t][0].filter(function(v){ return ok(v,tries[t][1],tries[t][2]); }); if(c.length) return first(c); }
    return null;
  },
  accents: function(){ var r={}; ['en-US','en-GB','en-AU'].forEach(function(a){ r[a]=TTS.byAccent(a).length; }); return r; },
  stop: function(){ TTS.token++; TTS.playing=false; if(TTS.ok){ try{ speechSynthesis.cancel(); }catch(e){} } if(TTS.onstate) TTS.onstate(false); },
  /* segs: [{text, voice, pitch, pause, lang}] */
  play: function(segs, onDone, onSeg){
    if(!TTS.ok){ toast('此瀏覽器不支援語音合成'); return; }
    TTS.stop();
    var my = ++TTS.token; TTS.playing=true; if(TTS.onstate) TTS.onstate(true);
    var parts=[]; segs.forEach(function(s,si){ var chunks = (s.text.match(/[^.!?]+[.!?]+["'”’)]*|[^.!?]+$/g) || [s.text]); chunks.forEach(function(c,ci){ c=c.trim(); if(c) parts.push({text:c, voice:s.voice, pitch:s.pitch, lang:s.lang, pause: ci===chunks.length-1 ? (s.pause||250) : 120, seg:si}); }); });
    var i=0;
    function next(){
      if(my!==TTS.token) return;
      if(i>=parts.length){ TTS.playing=false; if(TTS.onstate) TTS.onstate(false); if(onDone) onDone(); return; }
      var p=parts[i++]; if(onSeg) onSeg(p.seg);
      var u=new SpeechSynthesisUtterance(p.text);
      u.lang=(p.voice&&p.voice.lang)||p.lang||'en-US';
      if(p.voice){ try{ u.voice=p.voice; }catch(e){} }
      u.rate = Math.max(.5, Math.min(2, (S.settings.rate||1) * 0.95));
      u.pitch = p.pitch||1; u.volume=1;
      var finished=false;
      var est = 2500 + p.text.length*110/(u.rate||1);
      var guard = setTimeout(function(){ if(!finished){ finished=true; setTimeout(next,p.pause); } }, est*2);
      u.onend = function(){ if(finished) return; finished=true; clearTimeout(guard); setTimeout(next, p.pause); };
      u.onerror = function(ev){ if(finished) return; finished=true; clearTimeout(guard); if(ev && (ev.error==='interrupted'||ev.error==='canceled')) return; setTimeout(next, p.pause); };
      try{ speechSynthesis.speak(u); }catch(e){ finished=true; clearTimeout(guard); toast('語音播放失敗'); TTS.playing=false; if(TTS.onstate) TTS.onstate(false); }
    }
    setTimeout(next, 60);
  },
  say: function(text, accent){
    var acc = accent || S.settings.accent || 'en-US';
    var v = TTS.pick(acc, null);
    TTS.play([{text:text, voice:v, lang:acc, pitch:1, pause:50}]);
  }
};

/* ---------- 預錄神經語音（edge-tts）+ speechSynthesis 後備 ---------- */
var AP = {
  el: null, token: 0, playing: false, onstate: null, rate: 1,
  stop: function(){ AP.token++; AP.playing=false; if(AP.el){ try{ AP.el.onended=null; AP.el.onerror=null; AP.el.pause(); AP.el.removeAttribute('src'); AP.el.load(); }catch(e){} } TTS.stop(); if(AP.onstate) AP.onstate(false); },
  _playUrl: function(url, onDone, onErr){
    AP.stop(); var my=++AP.token; AP.playing=true; if(AP.onstate) AP.onstate(true);
    var a=new Audio(); AP.el=a; a.preload='auto'; a.src=url;
    try{ a.playbackRate = Math.max(0.5, Math.min(2, AP.rate || (S.settings.rate||1))); }catch(e){}
    a.onended=function(){ if(my!==AP.token) return; AP.playing=false; if(AP.onstate) AP.onstate(false); if(onDone) onDone(); };
    a.onerror=function(){ if(my!==AP.token) return; AP.playing=false; if(AP.onstate) AP.onstate(false); if(onErr) onErr(); };
    var p=a.play(); if(p&&p.catch) p.catch(function(){ if(my!==AP.token) return; AP.playing=false; if(AP.onstate) AP.onstate(false); if(onErr) onErr(); });
  },
  playWordCard: function(word, onDone){
    var path = (AUDIO_MANIFEST && AUDIO_MANIFEST.words && AUDIO_MANIFEST.words[word]) || ('audio/words/'+slugify(word)+'.mp3');
    AP.rate = S.settings.rate||1;
    AP._playUrl(path, onDone, function(){
      // fallback: word then example via speechSynthesis
      var w=BYWORD[word]; if(!w){ if(onDone) onDone(); return; }
      if(!TTS.ok){ toast('無法播放音檔，且此裝置不支援語音合成'); if(onDone) onDone(); return; }
      var acc=S.settings.accent||'en-US'; var v=TTS.pick(acc,null);
      TTS.play([{text:w.w, voice:v, lang:acc, pitch:1, pause:550},{text:w.ex, voice:v, lang:acc, pitch:1, pause:50}], onDone);
    });
  },
  playListening: function(part, id, onDone){
    var path = (AUDIO_MANIFEST && AUDIO_MANIFEST[part] && AUDIO_MANIFEST[part][id]) || ('audio/'+part+'/'+id+'.mp3');
    AP.rate = S.settings.rate||1;
    AP._playUrl(path, onDone, function(){
      // fallback to speechSynthesis using itemSegs
      var arr=L[part]; var it=null; for(var i=0;i<arr.length;i++) if(arr[i].id===id){ it=arr[i]; break; }
      if(!it || !TTS.ok){ toast('音檔載入失敗'+(TTS.ok?'':'，且不支援語音合成')); if(onDone) onDone(); return; }
      TTS.play(itemSegs(part,it), onDone);
    });
  }
};
AP.onstate = function(on){ updatePlayerUI(on); };

if(TTS.ok){ TTS.load(); try{ speechSynthesis.addEventListener ? speechSynthesis.addEventListener('voiceschanged', function(){ TTS.load(); if(cur.tab==='progress' || cur.tab==='listen') render(true); }) : (speechSynthesis.onvoiceschanged=TTS.load); }catch(e){} }

/* 角色→聲音分配（盡量男女分開、口音分開；聲音不足時以音高區分） */
var ROLE_PLAN = { M:{g:'M',acc:'en-US',pitch:.85}, W:{g:'F',acc:'en-GB',pitch:1.12}, M2:{g:'M',acc:'en-AU',pitch:.7}, W2:{g:'F',acc:'en-AU',pitch:1.3}, N:{g:null,acc:'en-US',pitch:1}, Q:{g:'F',acc:'en-US',pitch:1.08}, R:{g:'M',acc:'en-GB',pitch:.9} };
function castVoices(roles, seed){
  var mode=S.settings.listenAccent||'mix'; var used=[]; var cast={};
  var mixAcc=['en-US','en-GB','en-AU']; var r=seeded(seed||7); var off=Math.floor(r()*3);
  roles.forEach(function(role,i){
    var plan=ROLE_PLAN[role]||ROLE_PLAN.N;
    var acc = mode==='mix' ? (role==='N'? mixAcc[off] : plan.acc) : mode;
    var v = TTS.pick(acc, plan.g, used, mode==='mix');
    var dup = v && used.indexOf(v)>=0;
    if(v) used.push(v);
    var g = v? TTS.gender(v):'?';
    var pitch = 1;
    if(!v || dup || g==='?' || (plan.g && g!==plan.g)) pitch = plan.pitch; // 無法以聲音區分時改變音高
    cast[role]={voice:v, pitch:pitch, lang:acc};
  });
  return cast;
}

/* ---------- 狀態 ---------- */
var cur = { tab:'home' };
var V = { mode:'cards', theme:'all', level:'all', status:'all', idx:0, flipped:false, order:null, orderKey:'', quiz:null, quizDir:'mix', listOpen:{} };
var LS = { part:null, idx:0, ans:{}, submitted:false, playingSeg:-1 };

function pool(){
  return WORDS.filter(function(w){
    if(V.theme!=='all' && w.theme!==V.theme) return false;
    if(V.level!=='all' && w.lv!==V.level) return false;
    var m=S.marks[w.w];
    if(V.status==='known' && m!=='known') return false;
    if(V.status==='unsure' && m!=='unsure') return false;
    if(V.status==='new' && m) return false;
    if(V.status==='review' && !(m==='unsure' || S.wrong[w.w])) return false;
    return true;
  });
}
function filterKey(){ return V.theme+'|'+V.level+'|'+V.status; }

/* ---------- 共用 UI ---------- */
var toastTimer;
function toast(msg){ var t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(function(){ t.classList.remove('show'); },1800); }
function lvBadge(lv){ return '<span class="lv lv'+lv+'">'+LVNAME[lv]+'</span>'; }
function streak(){
  var d=new Date(); var n=0;
  if(!S.days[dayKey(d)]) d.setDate(d.getDate()-1);
  while(S.days[dayKey(d)]){ n++; d.setDate(d.getDate()-1); }
  return n;
}
function listenStats(p){ var c=0,t=0,items=0; Object.keys(S.listen[p]).forEach(function(k){ var r=S.listen[p][k]; c+=r[0]; t+=r[1]; items++; }); return {c:c,t:t,items:items}; }
function knownCount(){ return WORDS.filter(function(w){ return S.marks[w.w]==='known'; }).length; }
function unsureCount(){ return WORDS.filter(function(w){ return S.marks[w.w]==='unsure'; }).length; }
function wrongCount(){ return Object.keys(S.wrong).filter(function(k){ return BYWORD[k]; }).length; }
function ttsBanner(){
  return '<div class="banner info">🎧 聽力與字卡音檔為預錄神經語音（對齊多益口音與語速）。若音檔載入失敗會自動改用瀏覽器語音。iPhone 請關閉靜音鍵後再播放。</div>';
}

/* ---------- 頁面：首頁 ---------- */
function viewHome(){
  var today=S.days[dayKey()]||0, goal=S.settings.goal||20;
  var w = WORDS[hash(dayKey())%WORDS.length];
  var k=knownCount();
  var h='';
  h+='<div class="card hero"><div class="row" style="justify-content:space-between"><div><div class="muted small">目標分數</div><div style="font-size:28px;font-weight:900">TOEIC 900+</div></div><div style="text-align:right"><div class="muted small">連續學習</div><div style="font-size:28px;font-weight:900">🔥 '+streak()+' 天</div></div></div>';
  h+='<div class="muted small" style="margin-top:10px">今日練習 '+today+' / '+goal+' 次</div><div class="progressline" style="background:rgba(255,255,255,.3)"><i style="width:'+Math.min(100,pct(today,goal))+'%;background:#fff"></i></div>';
  h+='<div class="muted small" style="margin-top:6px">已熟悉單字 '+k+' / '+WORDS.length+'</div></div>';
  h+='<div class="quick" style="margin-bottom:14px">';
  h+='<button data-act="go" data-tab="vocab" data-mode="cards"><div class="qi">🃏</div><div class="qt">單字字卡</div><div class="qs">'+WORDS.length+' 個中高階商務單字</div></button>';
  h+='<button data-act="go" data-tab="vocab" data-mode="quiz"><div class="qi">✍️</div><div class="qt">單字測驗</div><div class="qs">每輪 10 題・英⇄中</div></button>';
  h+='<button data-act="go" data-tab="listen" data-part="p2"><div class="qi">🎧</div><div class="qt">Part 2 應答</div><div class="qs">間接回答・音近陷阱</div></button>';
  h+='<button data-act="go" data-tab="listen" data-part="p3"><div class="qi">💬</div><div class="qt">Part 3 對話</div><div class="qs">推論・言外之意題</div></button>';
  h+='<button data-act="go" data-tab="listen" data-part="p4"><div class="qi">📢</div><div class="qt">Part 4 獨白</div><div class="qs">廣播・留言・新聞</div></button>';
  h+='<button data-act="go" data-tab="vocab" data-mode="review"><div class="qi">📕</div><div class="qt">錯題本</div><div class="qs">不熟 '+unsureCount()+'・答錯 '+wrongCount()+'</div></button>';
  h+='</div>';
  h+='<div class="card"><div class="row" style="justify-content:space-between"><h3>📌 今日單字</h3>'+lvBadge(w.lv)+'</div>';
  h+='<div class="row"><div style="flex:1"><div class="en" style="font-size:26px;font-weight:800">'+esc(w.w)+' <span class="muted small">'+esc(w.pos)+'</span></div><div style="font-weight:700">'+esc(w.zh)+'</div></div><button class="iconbtn" data-act="say" data-text="'+esc(w.w)+'" aria-label="發音">🔊</button></div>';
  h+='<div class="ex"><div class="e en">'+esc(w.ex)+'</div><div class="muted small">'+esc(w.exZh)+'</div></div>'+(w.note?'<div class="note">💡 '+esc(w.note)+'</div>':'')+'</div>';
  h+='<div class="card small muted">💡 字卡發音會先讀單字、停頓後再讀例句。🎧 聽力音檔模擬多益美／英／加／澳口音與語速。<br>💡 900 分策略：Part 2 正解常是「間接回答」（如「我還在等資料」「去問 Karen」）；聽到與題目<b>發音相同或相近</b>的字要提高警覺。Part 3、4 請先讀題，特別注意「What does the speaker imply…」這類言外之意題。</div>';
  return h;
}

/* ---------- 頁面：單字 ---------- */
function vocabFilters(){
  var h='<div class="filters">';
  h+='<div class="chips">'+[['all','全部主題']].concat(THEMES.map(function(t){return [t.id,t.icon+' '+t.name];})).map(function(x){ return '<button class="chip'+(V.theme===x[0]?' on':'')+'" data-act="vf" data-k="theme" data-v="'+x[0]+'">'+esc(x[1])+'</button>'; }).join('')+'</div>';
  h+='<div class="chips">'+[['all','全部難度'],['730','730'],['860','860'],['900','900+']].map(function(x){ return '<button class="chip'+(V.level===x[0]?' on':'')+'" data-act="vf" data-k="level" data-v="'+x[0]+'">'+(x[0]!=='all'?'<span class="lv lv'+x[0]+'" style="margin-right:4px">●</span>':'')+x[1]+'</button>'; }).join('')+
     [['all','全部狀態'],['new','未標記'],['unsure','不熟'],['known','已熟悉'],['review','錯題＋不熟']].map(function(x){ return '<button class="chip'+(V.status===x[0]?' on':'')+'" data-act="vf" data-k="status" data-v="'+x[0]+'">'+x[1]+'</button>'; }).join('')+'</div>';
  h+='</div>';
  return h;
}
function viewVocab(){
  var h='<div class="seg" style="margin-bottom:12px">'+[['cards','🃏 字卡'],['quiz','✍️ 測驗'],['list','📋 單字表'],['review','📕 錯題本']].map(function(x){ return '<button class="'+(V.mode===x[0]?'on':'')+'" data-act="vmode" data-v="'+x[0]+'">'+x[1]+'</button>'; }).join('')+'</div>';
  if(V.mode==='review') return h+viewReview();
  if(V.mode==='quiz' && V.quiz) return h+viewQuiz();
  h+=vocabFilters();
  var P=pool();
  if(!P.length) return h+'<div class="card empty"><div class="big">🔍</div>這個篩選條件下沒有單字。<br><button class="btn ghost" style="margin-top:12px" data-act="vreset">清除篩選</button></div>';
  if(V.mode==='cards') return h+viewCards(P);
  if(V.mode==='quiz') return h+viewQuizStart(P);
  return h+viewList(P);
}
function cardOrder(P){
  var k=filterKey();
  if(V.orderKey!==k || !V.order || V.order.length!==P.length){ V.order=P.map(function(w){return w.w;}); V.orderKey=k; V.idx=0; V.flipped=false; }
  if(V.idx>=V.order.length) V.idx=0;
  return V.order;
}
function viewCards(P){
  var order=cardOrder(P); var w=BYWORD[order[V.idx]];
  if(!S.seen[w.w]){ S.seen[w.w]=1; save('seen'); }
  var m=S.marks[w.w];
  var h='<div class="row" style="justify-content:space-between"><div class="small muted">'+(V.idx+1)+' / '+order.length+'　'+w.icon+' '+esc(w.themeName)+'</div><button class="mini" data-act="shuffle">🔀 洗牌</button></div>';
  h+='<div class="progressline"><i style="width:'+pct(V.idx+1,order.length)+'%"></i></div>';
  h+='<div class="flash-wrap"><div class="flash'+(V.flipped?' flipped':'')+'" data-act="flip" id="flash" role="button" aria-label="點擊翻面">';
  h+='<div class="face front"><div class="facetop">'+lvBadge(w.lv)+'<button class="iconbtn" data-act="saycard" data-w="'+esc(w.w)+'" aria-label="發音（單字＋例句）">🔊</button></div><div class="word en">'+esc(w.w)+'</div><div class="pos en">'+esc(w.pos)+'</div><div class="hint">點卡片翻面看中文與例句　<span class="desk-only"><kbd>空白鍵</kbd> 翻面 <kbd>←</kbd><kbd>→</kbd> 切換</span></div></div>';
  h+='<div class="face back"><div class="facetop"><div><span class="en" style="font-weight:800;font-size:20px">'+esc(w.w)+'</span> <span class="muted en">'+esc(w.pos)+'</span></div><button class="iconbtn" data-act="saycard" data-w="'+esc(w.w)+'" aria-label="發音（單字＋例句）">🔊</button></div>';
  h+='<div class="meaning">'+esc(w.zh)+'</div><div class="ex"><div class="e en">'+esc(w.ex)+'</div><div class="muted small" style="margin-top:4px">'+esc(w.exZh)+'</div></div>'+(w.note?'<div class="note">💡 '+esc(w.note)+'</div>':'')+'</div>';
  h+='</div></div>';
  h+='<div class="markbar"><button class="btn unsure'+(m==='unsure'?' on':'')+'" data-act="mark" data-w="'+esc(w.w)+'" data-v="unsure">😵 不熟</button><button class="btn known'+(m==='known'?' on':'')+'" data-act="mark" data-w="'+esc(w.w)+'" data-v="known">✅ 已熟悉</button></div>';
  h+='<div class="cardnav"><button class="btn line" data-act="prev">← 上一張</button><button class="btn" data-act="next">下一張 →</button></div>';
  h+='<div class="row small muted" style="margin-top:12px;justify-content:center"><label><input type="checkbox" data-act="autospeak" '+(S.settings.autoSpeak?'checked':'')+'> 切換卡片時自動發音</label>　口音：'+accentSelect('accent')+'</div>';
  return h;
}
function accentSelect(key){
  var a=TTS.accents(); var val=S.settings[key];
  var opts=[['en-US','美式 en-US'],['en-GB','英式 en-GB'],['en-AU','澳式 en-AU']];
  if(key==='listenAccent') opts.unshift(['mix','混合口音（建議）']);
  return '<select data-act="setsel" data-k="'+key+'">'+opts.map(function(o){ var n=a[o[0]]; var lab=o[1]+(o[0]!=='mix' && TTS.voices.length && !n?'（本裝置無）':''); return '<option value="'+o[0]+'"'+(val===o[0]?' selected':'')+'>'+lab+'</option>'; }).join('')+'</select>';
}
function viewList(P){
  var h='<div class="card list"><div class="small muted" style="margin-bottom:4px">共 '+P.length+' 個單字・點單字展開例句</div>';
  P.forEach(function(w){
    var m=S.marks[w.w]; var open=V.listOpen[w.w];
    h+='<div class="item"><div class="main" data-act="lopen" data-w="'+esc(w.w)+'" style="cursor:pointer"><div><span class="w en">'+esc(w.w)+'</span> <span class="muted small en">'+esc(w.pos)+'</span> '+lvBadge(w.lv)+(S.wrong[w.w]?' <span class="tag bad">錯 '+S.wrong[w.w]+'</span>':'')+'</div><div class="z">'+esc(w.zh)+'</div>';
    if(open) h+='<div class="expand"><div class="en">'+esc(w.ex)+'</div><div class="muted">'+esc(w.exZh)+'</div>'+(w.note?'<div class="note">💡 '+esc(w.note)+'</div>':'')+'</div>';
    h+='</div><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="iconbtn" style="width:40px;height:40px;font-size:16px" data-act="say" data-text="'+esc(w.w)+'" aria-label="發音">🔊</button><button class="mini'+(m==='unsure'?' on-u':'')+'" data-act="mark" data-w="'+esc(w.w)+'" data-v="unsure">不熟</button><button class="mini'+(m==='known'?' on-k':'')+'" data-act="mark" data-w="'+esc(w.w)+'" data-v="known">熟</button></div></div>';
  });
  return h+'</div>';
}
function viewReview(){
  var uns=WORDS.filter(function(w){ return S.marks[w.w]==='unsure'; });
  var wr=WORDS.filter(function(w){ return S.wrong[w.w]; }).sort(function(a,b){ return S.wrong[b.w]-S.wrong[a.w]; });
  var h='<div class="card"><h3>📕 錯題本／不熟單字</h3><div class="small muted">測驗答錯的單字會自動加入錯題本；在複習測驗中答對即自動移除。</div>';
  h+='<div class="grid2" style="margin-top:12px"><button class="btn" data-act="reviewcards"'+((uns.length||wr.length)?'':' disabled')+'>🃏 複習字卡</button><button class="btn ghost" data-act="reviewquiz"'+((uns.length||wr.length)?'':' disabled')+'>✍️ 複習測驗</button></div></div>';
  function block(title, arr, kind){
    var s='<div class="card list"><div class="row" style="justify-content:space-between"><h3>'+title+'（'+arr.length+'）</h3>'+(arr.length?'<button class="mini" data-act="clear'+kind+'">清空</button>':'')+'</div>';
    if(!arr.length) s+='<div class="empty small">目前沒有單字 👍</div>';
    arr.forEach(function(w){ s+='<div class="item"><div class="main"><div><span class="w en">'+esc(w.w)+'</span> <span class="muted small en">'+esc(w.pos)+'</span> '+lvBadge(w.lv)+(kind==='wrong'?' <span class="tag bad">錯 '+S.wrong[w.w]+' 次</span>':'')+'</div><div class="z">'+esc(w.zh)+'</div></div><button class="iconbtn" style="width:40px;height:40px;font-size:16px" data-act="say" data-text="'+esc(w.w)+'">🔊</button><button class="mini" data-act="'+(kind==='wrong'?'rmwrong':'mark')+'" data-w="'+esc(w.w)+'" data-v="known">'+(kind==='wrong'?'移除':'✅ 熟了')+'</button></div>'; });
    return s+'</div>';
  }
  h+=block('😵 不熟單字',uns,'unsure');
  h+=block('❌ 測驗錯題',wr,'wrong');
  return h;
}
function viewQuizStart(P){
  var h='<div class="card"><h3>✍️ 單字測驗</h3><div class="small muted">從目前篩選的 '+P.length+' 個單字中出 10 題（不足 10 個則全部出題）。選項會盡量選同主題或同詞性的干擾字，提高鑑別度。</div>';
  h+='<div class="filterlabel" style="margin-top:12px">出題方向</div><div class="seg" style="margin-top:6px">'+[['mix','混合'],['e2c','英 → 中'],['c2e','中 → 英']].map(function(x){ return '<button class="'+(V.quizDir===x[0]?'on':'')+'" data-act="qdir" data-v="'+x[0]+'">'+x[1]+'</button>'; }).join('')+'</div>';
  h+='<button class="btn block" style="margin-top:14px" data-act="qstart">開始測驗</button></div>';
  var q=S.quiz; h+='<div class="card small muted">累計作答 '+q.total+' 題・正確率 '+pct(q.correct,q.total)+'%・完成 '+q.rounds+' 輪・最佳 '+q.best+'/10</div>';
  return h;
}
function buildQuiz(P, isReview){
  var picks=shuffle(P).slice(0,10);
  var qs=picks.map(function(w){
    var dir = V.quizDir==='mix' ? (Math.random()<.5?'e2c':'c2e') : V.quizDir;
    var same=WORDS.filter(function(x){ return x.w!==w.w && x.zh!==w.zh && (x.theme===w.theme || x.pos===w.pos); });
    var others=WORDS.filter(function(x){ return x.w!==w.w && x.zh!==w.zh && same.indexOf(x)<0; });
    var ds=shuffle(same).slice(0,3); if(ds.length<3) ds=ds.concat(shuffle(others).slice(0,3-ds.length));
    var opts=shuffle([w].concat(ds));
    return {w:w.w, dir:dir, opts:opts.map(function(x){return x.w;}), ans:opts.indexOf(w), pick:-1};
  });
  return {qs:qs, i:0, done:false, review:!!isReview};
}
function viewQuiz(){
  var Q=V.quiz;
  if(Q.done){
    var right=Q.qs.filter(function(q){ return q.pick===q.ans; }).length;
    var wrongs=Q.qs.filter(function(q){ return q.pick!==q.ans; });
    var msg = right===Q.qs.length?'太強了！全對 🎉': right>=8?'很棒，離 900 分更近了！': right>=5?'不錯，再複習一下錯題吧。':'加油！建議先用字卡熟悉單字。';
    var h='<div class="card" style="text-align:center"><div class="muted">本輪成績</div><div class="scorebig">'+right+' / '+Q.qs.length+'</div><div style="font-weight:700">'+msg+'</div>';
    h+='<div class="grid2" style="margin-top:14px"><button class="btn" data-act="qagain">再來一輪</button><button class="btn ghost" data-act="qexit">回到設定</button></div></div>';
    if(wrongs.length){
      h+='<div class="card list"><h3>❌ 錯題回顧（'+wrongs.length+'）</h3><div class="small muted">已自動加入錯題本。</div>';
      wrongs.forEach(function(q){ var w=BYWORD[q.w]; var p=BYWORD[q.opts[q.pick]];
        h+='<div class="item"><div class="main"><div><span class="w en">'+esc(w.w)+'</span> <span class="muted small en">'+esc(w.pos)+'</span> '+lvBadge(w.lv)+'</div><div class="z">✅ '+esc(w.zh)+'</div><div class="small" style="color:var(--bad)">你的答案：'+esc(q.dir==='e2c'?p.zh:p.w)+'</div><div class="expand muted en">'+esc(w.ex)+'</div>'+(w.note?'<div class="note">💡 '+esc(w.note)+'</div>':'')+'</div><button class="iconbtn" style="width:40px;height:40px;font-size:16px" data-act="say" data-text="'+esc(w.w)+'">🔊</button></div>'; });
      h+='</div>';
    }
    return h;
  }
  var q=Q.qs[Q.i]; var w=BYWORD[q.w];
  var h='<div class="card"><div class="row" style="justify-content:space-between"><div class="small muted">第 '+(Q.i+1)+' / '+Q.qs.length+' 題'+(Q.review?'・複習':'')+'</div>'+lvBadge(w.lv)+'</div><div class="progressline"><i style="width:'+pct(Q.i,Q.qs.length)+'%"></i></div>';
  if(q.dir==='e2c'){
    h+='<div class="small muted" style="text-align:center;margin-top:10px">選出正確的中文意思</div><div class="qprompt en">'+esc(w.w)+' <button class="iconbtn" style="vertical-align:middle;width:40px;height:40px;font-size:16px" data-act="say" data-text="'+esc(w.w)+'">🔊</button></div><div class="muted en" style="text-align:center">'+esc(w.pos)+'</div>';
  } else {
    h+='<div class="small muted" style="text-align:center;margin-top:10px">選出對應的英文單字</div><div class="qprompt" style="font-size:clamp(22px,6vw,30px)">'+esc(w.zh)+'</div><div class="muted en" style="text-align:center">'+esc(w.pos)+'</div>';
  }
  h+='</div><div>';
  q.opts.forEach(function(o,i){
    var x=BYWORD[o]; var cls='opt'; if(q.pick>=0){ if(i===q.ans) cls+=' right'; else if(i===q.pick) cls+=' wrong'; }
    h+='<button class="'+cls+'" data-act="qpick" data-i="'+i+'"'+(q.pick>=0?' disabled':'')+'><span class="k">'+LETTERS[i]+'</span><span class="'+(q.dir==='c2e'?'en':'')+'">'+esc(q.dir==='e2c'?x.zh:x.w)+'</span></button>';
  });
  h+='</div>';
  if(q.pick>=0){
    h+='<div class="card"><div style="font-weight:800;color:'+(q.pick===q.ans?'var(--ok)':'var(--bad)')+'">'+(q.pick===q.ans?'✅ 答對了！':'❌ 答錯了')+'</div><div><span class="en" style="font-weight:800">'+esc(w.w)+'</span>：'+esc(w.zh)+'</div><div class="ex"><div class="e en">'+esc(w.ex)+'</div><div class="muted small">'+esc(w.exZh)+'</div></div>'+(w.note?'<div class="note">💡 '+esc(w.note)+'</div>':'')+'</div>';
    h+='<button class="btn block" data-act="qnext">'+(Q.i+1<Q.qs.length?'下一題 →':'看成績')+'</button>';
  }
  return h;
}

/* ---------- 頁面：聽力 ---------- */
var PARTS = {
  p2:{name:'Part 2 應答問題', icon:'🎧', desc:'聽一句問題與三個回應，選出最適當的回答。選項不會顯示在畫面上。', unit:'題'},
  p3:{name:'Part 3 簡短對話', icon:'💬', desc:'兩人或三人對話，每段 3 題。含「言外之意」推論題。', unit:'段'},
  p4:{name:'Part 4 簡短獨白', icon:'📢', desc:'語音留言、廣播、新聞、會議摘錄，每段 3 題。', unit:'段'}
};
function viewListenHome(){
  var h=ttsBanner();
  h+='<div class="card"><h2>🎧 聽力練習</h2><div class="small muted">原創 900 分等級題目，模擬多益 Part 2–4。語音由裝置的語音合成產生，會盡量使用不同口音與聲音。</div>';
  h+='<div class="setrow" style="margin-top:6px"><span>語速</span>'+speedSeg()+'</div><div class="setrow"><span>口音</span>'+accentSelect('listenAccent')+'</div></div>';
  ['p2','p3','p4'].forEach(function(p){ var st=listenStats(p); var P=PARTS[p];
    h+='<button class="card partcard" data-act="lpart" data-v="'+p+'"><div class="big">'+P.icon+'</div><div style="flex:1"><div style="font-weight:800;font-size:17px">'+P.name+'</div><div class="small muted">'+P.desc+'</div><div class="small" style="margin-top:4px">共 '+L[p].length+' '+P.unit+'・已完成 '+st.items+'・正確率 '+(st.t?pct(st.c,st.t)+'%':'—')+'</div><div class="progressline"><i style="width:'+pct(st.items,L[p].length)+'%"></i></div></div><div style="font-size:22px;color:var(--muted)">›</div></button>';
  });
  return h;
}
function speedSeg(){ return '<div class="seg" style="flex:none">'+[.75,1,1.25].map(function(r){ return '<button class="'+(S.settings.rate===r?'on':'')+'" data-act="rate" data-v="'+r+'">'+r+'x</button>'; }).join('')+'</div>'; }
function itemSegs(part, it){
  var segs=[];
  if(part==='p2'){
    var c=castVoices(['Q','R'], hash(it.id));
    segs.push({text:it.q, voice:c.Q.voice, pitch:c.Q.pitch, lang:c.Q.lang, pause:900});
    it.o.forEach(function(o,i){ segs.push({text:LETTERS[i]+'. '+o, voice:c.R.voice, pitch:c.R.pitch, lang:c.R.lang, pause:i<2?700:200}); });
  } else if(part==='p3'){
    var roles=[]; it.l.forEach(function(x){ if(roles.indexOf(x[0])<0) roles.push(x[0]); });
    var c3=castVoices(roles, hash(it.id));
    it.l.forEach(function(x){ var v=c3[x[0]]; segs.push({text:x[1], voice:v.voice, pitch:v.pitch, lang:v.lang, pause:450}); });
  } else {
    var c4=castVoices(['N'], hash(it.id));
    segs.push({text:it.text, voice:c4.N.voice, pitch:c4.N.pitch, lang:c4.N.lang, pause:200});
  }
  return segs;
}
function transcriptHTML(part, it){
  if(part==='p2') return '<p><b>Q:</b> <span class="en">'+esc(it.q)+'</span></p>'+it.o.map(function(o,i){ return '<p'+(i===it.a?' style="color:var(--ok);font-weight:700"':'')+'><b>('+LETTERS[i]+')</b> <span class="en">'+esc(o)+'</span>'+(i===it.a?' ✅':'')+'</p>'; }).join('');
  if(part==='p3') return it.l.map(function(x,i){ return '<p data-line="'+i+'"><b>'+esc(it.sp[x[0]]||x[0])+':</b> <span class="en">'+esc(x[1])+'</span></p>'; }).join('');
  return '<p class="muted small">'+esc(it.kind)+'</p><p class="en">'+esc(it.text)+'</p>';
}
function viewListenItem(){
  var p=LS.part, arr=L[p], it=arr[LS.idx], P=PARTS[p];
  var h=ttsBanner();
  h+='<div class="row" style="justify-content:space-between;margin-bottom:8px"><button class="mini" data-act="lback">‹ 返回</button><div class="small muted">'+P.name+'</div></div>';
  h+='<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">'+(p==='p2'?'No. '+(LS.idx+1):esc(it.t))+'</h3><span class="small muted">'+(LS.idx+1)+' / '+arr.length+'</span></div>';
  h+='<div class="player" style="margin-top:12px"><div class="playmain'+((AP.playing||TTS.playing)?' playing-anim':'')+'" id="playmain"><button class="playbtn'+((AP.playing||TTS.playing)?' playing':'')+'" data-act="lplay" id="playbtn" aria-label="播放">'+((AP.playing||TTS.playing)?'■':'▶')+'</button><div style="flex:1"><div class="wave"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="status" id="pstatus">'+((AP.playing||TTS.playing)?'播放中…':'按 ▶ 播放音檔')+'</div></div><button class="btn line" data-act="lreplay" style="min-height:44px;padding:8px 12px">↻ 重播</button></div>';
  h+='<div class="row" style="justify-content:space-between"><span class="small muted">語速</span>'+speedSeg()+'</div></div></div>';
  var qs = p==='p2' ? [{q:'請選出最適當的回應', o:['','',''], a:it.a, e:it.e}] : it.q;
  h+='<div class="card">';
  qs.forEach(function(q,qi){
    var key=qi; var pick=LS.ans[key];
    h+='<div class="qblock"><div class="qt">'+(p==='p2'?'🎯 '+q.q:'<span class="en">'+(qi+1)+'. '+esc(q.q)+'</span>')+'</div>';
    q.o.forEach(function(o,i){
      var cls='opt'; if(LS.submitted){ if(i===q.a) cls+=' right'; else if(i===pick) cls+=' wrong'; } else if(i===pick) cls+=' sel';
      h+='<button class="'+cls+'" data-act="lpick" data-q="'+qi+'" data-i="'+i+'"'+(LS.submitted?' disabled':'')+'><span class="k">'+LETTERS[i]+'</span><span class="en">'+(p==='p2'? (LS.submitted?esc(o||it.o[i]):'('+LETTERS[i]+')') : esc(o))+'</span></button>';
    });
    if(LS.submitted) h+='<div class="explain">'+(pick===q.a?'✅ 答對！':'❌ 正確答案是 ('+LETTERS[q.a]+')。')+' '+esc(q.e)+'</div>';
    h+='</div>';
  });
  var all = qs.every(function(_,qi){ return LS.ans[qi]!==undefined; });
  if(!LS.submitted) h+='<button class="btn block" data-act="lsubmit"'+(all?'':' disabled')+'>'+(all?'送出答案':'請先作答'+(qs.length>1?'全部 '+qs.length+' 題':''))+'</button>';
  if(!LS.submitted) h+='<button class="btn line block" style="margin-top:10px" data-act="lpeek">👀 顯示逐字稿（不計分）</button>';
  h+='</div>';
  if(LS.submitted || LS.peek){
    h+='<div class="card"><h3>📝 逐字稿</h3><div class="transcript" id="transcript">'+transcriptHTML(p, p==='p2'?{q:it.q,o:it.o,a:LS.submitted?it.a:-1}:it)+'</div></div>';
  }
  if(LS.submitted){
    h+='<div class="grid2"><button class="btn line" data-act="lprev"'+(LS.idx>0?'':' disabled')+'>← 上一'+P.unit+'</button><button class="btn" data-act="lnext">'+(LS.idx+1<arr.length?'下一'+P.unit+' →':'回到列表')+'</button></div>';
  }
  h+='<div class="card" style="margin-top:14px"><div class="small muted">題目導覽（綠＝答對、紅＝有錯）</div><div class="dots">'+arr.map(function(x,i){ var r=S.listen[p][x.id]; var c=r?(r[0]===r[1]?'done-ok':'done-bad'):''; return '<button class="'+c+(i===LS.idx?' cur':'')+'" data-act="ljump" data-i="'+i+'">'+(i+1)+'</button>'; }).join('')+'</div></div>';
  return h;
}
function updatePlayerUI(on){
  var b=$('#playbtn'), m=$('#playmain'), s=$('#pstatus');
  if(b){ b.textContent = on?'■':'▶'; b.classList.toggle('playing',on); }
  if(m) m.classList.toggle('playing-anim',on);
  if(s) s.textContent = on?'播放中…':'按 ▶ 播放音檔';
}
TTS.onstate=updatePlayerUI; /* AP.onstate set above */
function playItem(){
  var it=L[LS.part][LS.idx];
  AP.playListening(LS.part, it.id, function(){ var s=$('#pstatus'); if(s) s.textContent='播放完畢・可按 ↻ 重播'; });
}

/* ---------- 頁面：進度 ---------- */
function viewProgress(){
  var k=knownCount(), u=unsureCount(), seen=Object.keys(S.seen).filter(function(x){return BYWORD[x];}).length;
  var q=S.quiz; var ls={}; var lc=0, lt=0; ['p2','p3','p4'].forEach(function(p){ ls[p]=listenStats(p); lc+=ls[p].c; lt+=ls[p].t; });
  var h='<div class="grid2 grid4" style="margin-bottom:14px">';
  h+='<div class="stat"><div class="n">🔥 '+streak()+'</div><div class="l">連續學習天數</div></div>';
  h+='<div class="stat"><div class="n">'+k+'<span class="small muted">/'+WORDS.length+'</span></div><div class="l">已熟悉單字</div></div>';
  h+='<div class="stat"><div class="n">'+(q.total?pct(q.correct,q.total)+'%':'—')+'</div><div class="l">單字測驗正確率（'+q.total+' 題）</div></div>';
  h+='<div class="stat"><div class="n">'+(lt?pct(lc,lt)+'%':'—')+'</div><div class="l">聽力正確率（'+lt+' 題）</div></div>';
  h+='</div>';
  // 7 日
  var days=[], max=1; for(var i=6;i>=0;i--){ var d=new Date(); d.setDate(d.getDate()-i); var key=dayKey(d); var n=S.days[key]||0; max=Math.max(max,n); days.push({l:(d.getMonth()+1)+'/'+d.getDate(), n:n, wd:'日一二三四五六'[d.getDay()]}); }
  h+='<div class="card"><h3>📅 最近 7 天練習量</h3><div class="bars">'+days.map(function(x){ return '<div class="b"><span>'+x.n+'</span><i style="height:'+Math.max(3,Math.round(x.n*90/max))+'px'+(x.n?'':';opacity:.25')+'"></i><span>'+x.wd+'</span></div>'; }).join('')+'</div></div>';
  // 單字
  h+='<div class="card"><h3>📚 單字</h3><div class="small muted">已瀏覽 '+seen+'・已熟悉 '+k+'・不熟 '+u+'・錯題 '+wrongCount()+'</div>';
  ['730','860','900'].forEach(function(lv){ var tot=WORDS.filter(function(w){return w.lv===lv;}); var kn=tot.filter(function(w){return S.marks[w.w]==='known';}).length; h+='<div style="margin-top:10px"><div class="row" style="justify-content:space-between"><span>'+lvBadge(lv)+' 等級</span><span class="small muted">'+kn+' / '+tot.length+'</span></div><div class="progressline"><i style="width:'+pct(kn,tot.length)+'%"></i></div></div>'; });
  h+='<div class="small muted" style="margin-top:10px">測驗完成 '+q.rounds+' 輪・最佳成績 '+q.best+'/10</div></div>';
  // 主題
  h+='<div class="card"><h3>🗂️ 各主題熟悉度</h3>'+THEMES.map(function(t){ var kn=t.words.filter(function(a){return S.marks[a[0]]==='known';}).length; return '<div style="margin-top:8px"><div class="row" style="justify-content:space-between"><span class="small">'+t.icon+' '+t.name+'</span><span class="small muted">'+kn+'/'+t.words.length+'</span></div><div class="progressline"><i style="width:'+pct(kn,t.words.length)+'%"></i></div></div>'; }).join('')+'</div>';
  // 聽力
  h+='<div class="card"><h3>🎧 聽力</h3>'+['p2','p3','p4'].map(function(p){ var s=ls[p]; return '<div class="setrow"><span>'+PARTS[p].name+'</span><span class="small muted">完成 '+s.items+'/'+L[p].length+'・正確率 '+(s.t?pct(s.c,s.t)+'%':'—')+'</span></div>'; }).join('')+'</div>';
  // 設定
  var a=TTS.accents();
  h+='<div class="card"><h3>⚙️ 設定</h3>';
  h+='<div class="setrow"><span>單字發音口音</span>'+accentSelect('accent')+'</div>';
  h+='<div class="setrow"><span>聽力口音</span>'+accentSelect('listenAccent')+'</div>';
  h+='<div class="setrow"><span>語速</span>'+speedSeg()+'</div>';
  h+='<div class="setrow"><span>每日目標（次）</span><select data-act="setsel" data-k="goal">'+[10,20,30,50].map(function(g){ return '<option value="'+g+'"'+(S.settings.goal===g?' selected':'')+'>'+g+'</option>'; }).join('')+'</select></div>';
  h+='<div class="setrow"><span>測試語音</span><button class="mini" data-act="testvoice">🔊 播放測試</button></div>';
  h+='<div class="small muted" style="margin-top:6px">聽力與字卡主要使用預錄神經語音（美／英／加／澳）。語速滑桿會調整播放速度。後備：'+(TTS.ok?('瀏覽器語音合成 '+TTS.voices.length+' 個'):'此瀏覽器不支援語音合成')+'。</div></div>';
  h+='<div class="card"><h3>🗑️ 重設</h3><div class="small muted">清除所有單字標記、錯題本、測驗與聽力紀錄、連續天數。此動作無法復原。</div><button class="btn bad block" style="margin-top:10px" data-act="reset">重設所有學習紀錄</button></div>';
  h+='<div class="small muted" style="text-align:center;margin:8px 0 20px">多益 900 衝刺 v1・資料只儲存在這台裝置的瀏覽器中</div>';
  return h;
}

/* ---------- 路由與繪製 ---------- */
function render(keepScroll){
  var y=window.scrollY;
  var v=$('#view'); var h='';
  if(cur.tab==='home') h=viewHome();
  else if(cur.tab==='vocab') h=viewVocab();
  else if(cur.tab==='listen') h= LS.part? viewListenItem() : viewListenHome();
  else h=viewProgress();
  v.innerHTML=h;
  document.querySelectorAll('nav.tabs button').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-tab')===cur.tab); });
  $('#streakPill').textContent='🔥 '+streak();
  if(keepScroll) window.scrollTo(0,y); else window.scrollTo(0,0);
}
function go(tab){ if(AP.playing||TTS.playing) AP.stop(); cur.tab=tab; var hsh='#'+tab+(tab==='listen'&&LS.part?'/'+LS.part:'')+(tab==='vocab'?'/'+V.mode:''); try{ history.replaceState(null,'',hsh); }catch(e){} render(); }
function openPart(p, idx){ LS.part=p; LS.idx=idx||0; LS.ans={}; LS.submitted=false; LS.peek=false; if(AP.playing||TTS.playing) AP.stop(); }

function routeFromHash(){
  var hh=(location.hash||'').replace('#','').split('/');
  var tab=hh[0]; if(['home','vocab','listen','progress'].indexOf(tab)<0) tab='home';
  if(tab==='vocab' && hh[1] && ['cards','quiz','list','review'].indexOf(hh[1])>=0) V.mode=hh[1];
  if(tab==='listen' && hh[1] && L[hh[1]]) openPart(hh[1], parseInt(hh[2]||'0',10)||0);
  cur.tab=tab;
}

/* ---------- 事件 ---------- */
function setMark(w, v){ if(S.marks[w]===v) delete S.marks[w]; else S.marks[w]=v; save('marks'); bump(); }
function cardMove(d){ var P=pool(); var order=cardOrder(P); V.idx=(V.idx+d+order.length)%order.length; V.flipped=false; bump(); render(true); if(S.settings.autoSpeak) AP.playWordCard(order[V.idx]); }

document.addEventListener('click', function(ev){
  var el=ev.target.closest('[data-act]'); if(!el) return;
  var a=el.getAttribute('data-act'); var d=function(k){ return el.getAttribute('data-'+k); };
  if(el.tagName==='SELECT' || (el.tagName==='INPUT')) return;
  switch(a){
    case 'tab': if(d('tab')==='listen' && cur.tab==='listen' && LS.part){ LS.part=null; } go(d('tab')); break;
    case 'go': if(d('mode')){ V.mode=d('mode'); V.quiz=null; } if(d('part')) openPart(d('part'),0); go(d('tab')); break;
    case 'say': ev.stopPropagation(); TTS.say(d('text')); break;
    case 'saycard': ev.stopPropagation(); AP.playWordCard(d('w')); break;
    case 'vmode': V.mode=d('v'); if(V.mode!=='quiz') V.quiz=null; go('vocab'); break;
    case 'vf': V[d('k')]=d('v'); V.idx=0; V.flipped=false; render(true); break;
    case 'vreset': V.theme='all'; V.level='all'; V.status='all'; render(); break;
    case 'flip': V.flipped=!V.flipped; var f=$('#flash'); if(f) f.classList.toggle('flipped',V.flipped); if(V.flipped) bump(); break;
    case 'prev': cardMove(-1); break;
    case 'next': cardMove(1); break;
    case 'shuffle': var P=pool(); cardOrder(P); V.order=shuffle(V.order); V.idx=0; V.flipped=false; render(true); toast('已打亂順序'); break;
    case 'mark': ev.stopPropagation(); setMark(d('w'), d('v')); render(true); if(S.marks[d('w')]) toast(S.marks[d('w')]==='known'?'已標記為「已熟悉」':'已加入「不熟單字」'); break;
    case 'lopen': V.listOpen[d('w')]=!V.listOpen[d('w')]; render(true); break;
    case 'rmwrong': delete S.wrong[d('w')]; save('wrong'); render(true); break;
    case 'clearunsure': if(confirm('確定清空所有「不熟」標記？')){ Object.keys(S.marks).forEach(function(k){ if(S.marks[k]==='unsure') delete S.marks[k]; }); save('marks'); render(true);} break;
    case 'clearwrong': if(confirm('確定清空錯題本？')){ S.wrong={}; save('wrong'); render(true);} break;
    case 'reviewcards': V.theme='all'; V.level='all'; V.status='review'; V.mode='cards'; V.idx=0; go('vocab'); break;
    case 'reviewquiz': V.theme='all'; V.level='all'; V.status='review'; V.mode='quiz'; V.quiz=buildQuiz(pool(), true); go('vocab'); break;
    case 'qdir': V.quizDir=d('v'); render(true); break;
    case 'qstart': V.quiz=buildQuiz(pool(), V.status==='review'); render(); break;
    case 'qpick':
      var Q=V.quiz, q=Q.qs[Q.i]; if(q.pick>=0) break; q.pick=parseInt(d('i'),10);
      var ok=q.pick===q.ans; S.quiz.total++; if(ok) S.quiz.correct++;
      if(!ok){ S.wrong[q.w]=(S.wrong[q.w]||0)+1; save('wrong'); }
      else if(Q.review && S.wrong[q.w]){ delete S.wrong[q.w]; save('wrong'); }
      save('quiz'); bump(); render(true); break;
    case 'qnext': if(V.quiz.i+1<V.quiz.qs.length){ V.quiz.i++; render(); } else { V.quiz.done=true; var r=V.quiz.qs.filter(function(x){return x.pick===x.ans;}).length; S.quiz.rounds++; if(V.quiz.qs.length===10) S.quiz.best=Math.max(S.quiz.best,r); save('quiz'); render(); } break;
    case 'qagain': V.quiz=buildQuiz(pool(), V.quiz && V.quiz.review); render(); break;
    case 'qexit': V.quiz=null; render(); break;
    case 'lpart': openPart(d('v'), 0); go('listen'); break;
    case 'lback': LS.part=null; go('listen'); break;
    case 'lplay': if(AP.playing||TTS.playing) AP.stop(); else playItem(); break;
    case 'lreplay': playItem(); break;
    case 'rate': S.settings.rate=parseFloat(d('v')); save('settings'); var wasPlaying=AP.playing||TTS.playing; AP.rate=S.settings.rate; render(true); if(wasPlaying && cur.tab==='listen' && LS.part){ playItem(); toast('已切換為 '+S.settings.rate+'x，從頭播放'); } break;
    case 'lpick': if(LS.submitted) break; LS.ans[parseInt(d('q'),10)]=parseInt(d('i'),10); render(true); break;
    case 'lpeek': LS.peek=!LS.peek; render(true); break;
    case 'lsubmit':
      var p=LS.part, it=L[p][LS.idx]; var qs=p==='p2'?[{a:it.a}]:it.q; var c=0; qs.forEach(function(q,qi){ if(LS.ans[qi]===q.a) c++; });
      S.listen[p][it.id]=[c,qs.length]; save('listen'); bump(); LS.submitted=true; render(true);
      toast(c===qs.length?'全對！🎉':'答對 '+c+' / '+qs.length); break;
    case 'lnext': if(LS.idx+1<L[LS.part].length){ openPart(LS.part, LS.idx+1); render(); } else { LS.part=null; go('listen'); } break;
    case 'lprev': if(LS.idx>0){ openPart(LS.part, LS.idx-1); render(); } break;
    case 'ljump': openPart(LS.part, parseInt(d('i'),10)); render(); break;
    case 'testvoice': TTS.say('Welcome to your TOEIC practice. The quarterly report is due on Friday.'); break;
    case 'reset':
      if(confirm('確定要重設所有學習紀錄嗎？此動作無法復原。')){
        S.marks={}; S.wrong={}; S.seen={}; S.quiz={total:0,correct:0,rounds:0,best:0}; S.listen={p2:{},p3:{},p4:{}}; S.days={};
        ['marks','wrong','seen','quiz','listen','days'].forEach(save); V.quiz=null; render(); toast('已重設所有紀錄');
      } break;
  }
});
document.addEventListener('change', function(ev){
  var el=ev.target; var a=el.getAttribute('data-act');
  if(a==='setsel'){ var k=el.getAttribute('data-k'); S.settings[k]= k==='goal'? parseInt(el.value,10) : el.value; save('settings'); if(k==='accent') TTS.say('Hello, this is my accent.'); render(true); }
  if(a==='autospeak'){ S.settings.autoSpeak=el.checked; save('settings'); }
});
document.addEventListener('keydown', function(ev){
  if(cur.tab!=='vocab' || V.mode!=='cards') return;
  if(ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
  if(ev.key==='ArrowRight'){ cardMove(1); ev.preventDefault(); }
  else if(ev.key==='ArrowLeft'){ cardMove(-1); ev.preventDefault(); }
  else if(ev.key===' '||ev.key==='Enter'){ V.flipped=!V.flipped; var f=$('#flash'); if(f) f.classList.toggle('flipped',V.flipped); ev.preventDefault(); }
});
/* 字卡左右滑動 */
var tx=null, ty=null;
document.addEventListener('touchstart', function(e){ if(!e.target.closest('#flash')) { tx=null; return; } tx=e.touches[0].clientX; ty=e.touches[0].clientY; }, {passive:true});
document.addEventListener('touchend', function(e){ if(tx===null) return; var dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty; tx=null; if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5){ V.suppressFlip=true; cardMove(dx<0?1:-1); } }, {passive:true});
document.addEventListener('click', function(e){ if(V.suppressFlip && e.target.closest('#flash')){ V.suppressFlip=false; e.stopImmediatePropagation(); e.preventDefault(); } else V.suppressFlip=false; }, true);
document.addEventListener('visibilitychange', function(){ if(document.hidden && (AP.playing||TTS.playing)) AP.stop(); });

routeFromHash();
render();
window.addEventListener('hashchange', function(){ var before=location.hash; routeFromHash(); render(); });
window.__TOEIC = {WORDS:WORDS, L:L, TTS:TTS, AP:AP, AUDIO_MANIFEST:function(){return AUDIO_MANIFEST;}};
})();
