(function () {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const html = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const read = (key, fallback) => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } };
  const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const cfg = window.APP_CONFIG || {};
  const data = {route:"home", base:[], bank:[], custom:read("ac_final_bank",[]), users:[], user:null, results:[], attempt:null, lastResult:null, reviewResult:null, showOriginal:{}, adminRows:[], cloud:false, db:null, toastTimer:null};
  const typeName = {single:"單選題",multiple:"複選題",image:"圖片點選",filter:"資料篩選",order:"拖曳排序",match:"配對題"};
  function notice(message) { const el=byId("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(data.toastTimer); data.toastTimer=setTimeout(()=>el.classList.remove("show"),4000); }
  function unique(questions) { const seen=new Set(); return questions.filter(q => { const key=String(q.title||"").toLowerCase().replace(/\s/g,"").replace(/[，。！？、:：]/g,""); if(!key||seen.has(key))return false; seen.add(key); return true; }); }
  function validQuestion(q) { return q && typeName[q.type] && typeof q.title==="string" && q.title.length>2 && q.answer!==undefined && (q.type!=="image" || Array.isArray(q.hotspots)); }
  function demoMode() { return !data.cloud; }
  function isAdmin() { return data.user && data.user.role==="admin"; }
  function requireUser() { if(data.user)return true; showAuth("login"); notice("請先登入已核准的帳號"); return false; }
  function setRoute(route) { if(["practice","exam","history"].includes(route)&&!requireUser())return; if(route==="admin"&&!isAdmin()){notice("只有管理員可以使用此功能");return;} data.route=route; document.querySelectorAll("[data-route]").forEach(b=>b.classList.toggle("active",b.dataset.route===route)); byId("sidebar").classList.remove("open"); render(); if(route==="admin")loadAdmin().catch(e=>notice(e.message)); window.scrollTo(0,0); }
  function setHeader(title) { byId("breadcrumb").textContent=title; byId("adminNav").hidden=!isAdmin(); byId("accountBtn").textContent=data.user?data.user.name:"登入 / 註冊"; byId("logoutBtn").hidden=!data.user; byId("modePill").textContent=data.cloud?"雲端同步":"示範模式"; byId("sideMode").textContent=data.cloud?"Supabase 雲端模式":"離線示範模式"; }
  const demoWarning = () => demoMode()?'<div class="demo-banner"><strong>目前為瀏覽器示範模式。</strong> 使用者、核准狀態及成績僅存於此裝置；不會跨裝置同步，也不適合儲存真實個資。設定 Supabase 後可啟用正式帳號管理。</div>':"";
  const bankWarning = () => data.custom.length?'<div class="demo-banner">目前載入由管理員在此瀏覽器匯入的題庫；匯入檔案不會自動同步到其他裝置，正式版請更新 GitHub 上的 questions.json。</div>':'<div class="demo-banner"><strong>目前使用 10 題原創示範題。</strong>尚未取得作業指定的 PDF 與 MD 真題，因此圖片、篩選、拖曳題型僅用來展示操作，不能視為與原試題一致。</div>';
  async function digest(password,salt) { const bytes=new TextEncoder().encode(salt+"|"+password); const output=await crypto.subtle.digest("SHA-256",bytes); return Array.from(new Uint8Array(output)).map(b=>b.toString(16).padStart(2,"0")).join(""); }
  function randomSalt() { const a=new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map(x=>x.toString(16).padStart(2,"0")).join(""); }
  async function seedDemo() {
    data.users=read("ac_final_users",[]);
    if(data.users.length===0){
      const examples=[{id:"demo-admin",name:"示範管理員",email:"admin@demo.local",role:"admin",status:"approved",password:"demo1234"},{id:"demo-student",name:"示範學生",email:"student@demo.local",role:"student",status:"approved",password:"demo1234"}];
      for(const u of examples){u.salt=randomSalt();u.hash=await digest(u.password,u.salt);delete u.password;u.login_count=0;u.created_at=new Date().toISOString();}
      data.users=examples;save("ac_final_users",data.users);
    }
    const id=read("ac_final_session",null);
    data.user=data.users.find(u=>u.id===id&&u.status==="approved")||null;
    data.results=read("ac_final_results",[]);
  }
  async function initCloud() {
    if(!cfg.supabaseUrl||!cfg.supabaseAnonKey)return false;
    if(!window.supabase||!window.supabase.createClient){notice("雲端套件載入失敗，已切換為示範模式");return false;}
    try{
      data.db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
      const res=await data.db.auth.getSession();
      if(res.data.session)await acceptCloudSession(res.data.session.user,false);
      return true;
    }catch(err){console.error(err);notice("無法連接雲端，已切換為示範模式");data.db=null;return false;}
  }
  async function acceptCloudSession(authUser,recordLogin) {
    const {data:profile,error}=await data.db.from("profiles").select("*").eq("id",authUser.id).single();
    if(error||!profile||profile.status!=="approved"){await data.db.auth.signOut();data.user=null;return false;}
    if(recordLogin)await data.db.rpc("record_login");
    data.user=profile;
    if(recordLogin)data.user.login_count++;
    await loadResults();
    return true;
  }
  async function loadResults() {
    if(!data.user)return;
    if(data.cloud){
      const {data:rows,error}=await data.db.from("results").select("id,user_id,mode,score,passed,answered,total,details,created_at").order("created_at",{ascending:false});
      if(error)notice("無法載入成績："+error.message);
      else data.results=rows||[];
    }else data.results=read("ac_final_results",[]);
  }
  async function register(name,email,password) {
    if(data.cloud) {
      const r=await data.db.auth.signUp({email,password,options:{data:{name}}});
      if(r.error)throw r.error;
      await data.db.auth.signOut();
    }else{
      if(data.users.some(u=>u.email.toLowerCase()===email.toLowerCase()))throw Error("此 Email 已申請過");
      const salt=randomSalt();
      data.users.push({id:"local-"+Date.now()+"-"+Math.random().toString(36).slice(2),name,email,role:"student",status:"pending",salt,hash:await digest(password,salt),login_count:0,created_at:new Date().toISOString()});
      save("ac_final_users",data.users);
    }
  }
  async function login(email,password){
    if(data.cloud){
      const r=await data.db.auth.signInWithPassword({email,password});
      if(r.error)throw r.error;
      if(!(await acceptCloudSession(r.data.user,true)))throw Error("帳號尚未經管理員核准，或已被停用");
    }else{
      const u=data.users.find(x=>x.email.toLowerCase()===email.toLowerCase());
      if(!u||u.hash!==await digest(password,u.salt))throw Error("帳號或密碼錯誤");
      if(u.status!=="approved")throw Error("帳號尚未核准或已被停用");
      u.login_count=(u.login_count||0)+1;data.user=u;
      save("ac_final_session",u.id);save("ac_final_users",data.users);
      await loadResults();
    }
    closeAuth();setRoute("home");notice("登入成功，歡迎回來！");
  }
  async function logout(){
    if(data.cloud)await data.db.auth.signOut();
    else localStorage.removeItem("ac_final_session");
    data.user=null;data.attempt=null;data.reviewResult=null;data.results=[];setRoute("home");notice("已登出");
  }
  async function changePassword(newPassword){
    if(data.cloud){const r=await data.db.auth.updateUser({password:newPassword});if(r.error)throw r.error;}
    else{data.user.salt=randomSalt();data.user.hash=await digest(newPassword,data.user.salt);save("ac_final_users",data.users);}
  }
  function showAuth(mode){
    const signup=mode==="register";
    byId("authBody").innerHTML='<div class="eyebrow">ACCOUNT ACCESS</div><h2>'+(signup?"申請新帳號":"歡迎登入")+'</h2><p>'+(signup?"申請後需經管理員核准，才能開始練習。":"登入後可以練習、模擬測驗及查看成績。")+'</p>'+
      '<form id="authForm" data-mode="'+(signup?"register":"login")+'">'+
      (signup?'<div class="input-group"><label for="authName">姓名</label><input id="authName" name="name" required maxlength="60" autocomplete="name"></div>':"")+
      '<div class="input-group"><label for="authEmail">Email</label><input id="authEmail" type="email" name="email" required autocomplete="email" placeholder="you@example.com"></div>'+
      '<div class="input-group"><label for="authPassword">密碼</label><input id="authPassword" type="password" name="password" required minlength="6" autocomplete="'+(signup?"new-password":"current-password")+'" value="'+(signup?"a123456":"")+'"></div>'+
      '<p id="authError" class="form-error" aria-live="polite"></p><button class="primary-btn" type="submit" style="width:100%">'+(signup?"送出申請":"登入")+'</button></form>'+
      '<button class="auth-switch" data-auth-mode="'+(signup?"login":"register")+'">'+(signup?"已有帳號？返回登入":"沒有帳號？申請帳號")+'</button>'+
      (demoMode()?'<p class="small">示範帳號：admin@demo.local 或 student@demo.local，密碼都是 demo1234。<strong>切勿在示範模式輸入真實個資或常用密碼。</strong></p>':"");
    if(!byId("authDialog").open)byId("authDialog").showModal();
  }
  function closeAuth(){byId("authDialog").close();}
  function stats(){
    const mine=data.results.filter(x=>x.user_id===data.user?.id);
    const max=mine.length?Math.max(...mine.map(x=>x.score)):0;
    const latest=mine.length?mine[0].score:0;
    return {mine,max,latest,logins:data.user?.login_count||0};
  }
  function home(){
    const s=stats(),logged=!!data.user;
    return '<div class="eyebrow">YOUR ACCOUNTING JOURNEY</div><h1 class="page-title">'+(logged?"嗨，"+html(data.user.name)+"！":"準備好迎接會計學期末考了嗎？")+'</h1><p class="page-desc">從理解觀念到動手操作，透過多元互動題型建立真正的應試能力。</p>'+
      demoWarning()+bankWarning()+
      '<section class="hero"><div class="hero-copy"><div class="eyebrow" style="color:#e9eaff">FINAL EXAM PREPARATION</div><h2>每一次練習，<br>都讓你更接近目標。</h2><p>完整保留篩選、拖曳、配對與圖片點選等互動形式。滿分 1000 分，達 700 分即通過。</p><button class="white-btn" data-action="startPractice">立即開始練習 →</button></div><div class="hero-art"><div class="ring"></div><div class="paper">📚</div></div></section>'+
      '<section class="stats-grid">'+
      stat("▣","題庫題數",data.bank.length+" 題")+
      stat("★","個人最高分",s.max+" / 1000")+
      stat("✓","最近測驗",s.mine.length?s.latest+" 分":"尚無紀錄")+
      stat("↗","登入次數",s.logins+" 次")+'</section>'+
      '<div class="section-header"><h2>開始你的學習旅程</h2><span class="muted small">依照自己的步調學習</span></div>'+
      '<section class="features-grid">'+
      feature("✎","自由練習","逐題探索、立即查看正解與中文解析，操作錯誤也能重新嘗試。","開始練習","startPractice")+
      feature("◷","完整模擬考","實際操作多元題型，完成後依答對比例換算 1000 分滿分。","參加模擬考","startExam")+
      feature("▤","歷次成績","記錄分數與作答結果，檢視錯題、中文詳解及原文。","查看成績","history")+'</section>'+
      '<div class="section-header"><h2>題型與規則</h2></div><div class="panel"><p class="muted">本系統支援單選、複選、資料列篩選、拖曳排序、分類配對與圖片點選。每題採全對得分，最後依正確題數換算 1000 分；700 分及格。未答題視為錯誤。</p><div class="row"><span>及格標準</span><strong>700 / 1000</strong></div><div class="progress" style="margin-top:12px"><span style="width:70%"></span></div></div>';
  }
  function stat(icon,label,value){return '<div class="stat-card"><div class="stat-icon">'+icon+'</div><strong>'+html(value)+'</strong><small>'+html(label)+'</small></div>';}
  function feature(icon,title,desc,button,action){return '<article class="feature-card"><div class="feature-icon">'+icon+'</div><h3>'+title+'</h3><p>'+desc+'</p><button class="secondary-btn" data-action="'+action+'">'+button+' →</button></article>';}
  function start(kind){
    if(!requireUser())return;
    if(!data.bank.length){notice("題庫目前是空的");return;}
    data.attempt={kind,questions:data.bank.slice(),index:0,answers:{},reveals:{},startedAt:Date.now()};
    data.route=kind;render();window.scrollTo(0,0);
  }
  function currentAnswer(q){return data.attempt.answers[q.id];}
  function isAnswered(q){
    const a=currentAnswer(q);
    return a!==undefined&&a!==null&&(Array.isArray(a)?a.length>0:typeof a==="object"?Object.keys(a).length>0:String(a).length>0);
  }
  function setAnswer(q,value){data.attempt.answers[q.id]=value;render(); }
  function score(q,a) {
    if(a===null||a===undefined)return false;
    if(Array.isArray(q.answer))return Array.isArray(a)&&JSON.stringify(q.answer.slice().sort())===JSON.stringify(a.slice().sort()) && (q.type!=="order"||JSON.stringify(q.answer)===JSON.stringify(a));
    if(q.answer&&typeof q.answer==="object")return Object.keys(q.answer).every(k=>q.answer[k]===a[k])&&Object.keys(a||{}).length===Object.keys(q.answer).length;
    return String(q.answer)===String(a);
  }
  function formatAnswer(q,a){
    if(a===null||a===undefined||(Array.isArray(a)&&!a.length))return "未作答";
    if(q.type==="single"||q.type==="multiple"){const ids=Array.isArray(a)?a:[a];return ids.map(x=>q.choices.find(o=>o.id===x)?.text||x).join("、");}
    if(q.type==="image")return q.hotspots.find(o=>o.id===a)?.label||String(a);
    if(q.type==="filter")return (Array.isArray(a)?a:[]).map(x=>q.rows.find(o=>o.id===x)?.item||x).join("、")||"未作答";
    if(q.type==="order")return (Array.isArray(a)?a:[]).map(x=>q.items.find(o=>o.id===x)?.text||x).join(" → ")||"未作答";
    if(q.type==="match")return q.left.map(l=>l.text+"："+(q.right.find(r=>r.id===(a||{})[l.id])?.text||"未選")).join("；");
    return String(a);
  }
  function questionBody(q,a){
    if(q.type==="single"||q.type==="multiple"){
      const multi=q.type==="multiple",sel=multi?(Array.isArray(a)?a:[]):[a];
      return '<div class="options">'+q.choices.map((o,i)=>'<label class="option '+(sel.includes(o.id)?"selected":"")+'"><input type="'+(multi?"checkbox":"radio")+'" name="choice" value="'+html(o.id)+'" '+(sel.includes(o.id)?"checked":"")+'><span class="opt-index">'+String.fromCharCode(65+i)+'.</span><span>'+html(o.text)+'</span></label>').join("")+'</div>';
    }
    if(q.type==="filter"){
      const selected=Array.isArray(a)?a:[];
      return '<div class="instruction">直接點選要篩選的資料列，可多選；再次點選可取消。</div><div class="table-scroll"><table class="data-table"><thead><tr><th>選取</th>'+q.columns.map(c=>'<th>'+html(c.label)+'</th>').join("")+'</tr></thead><tbody>'+
        q.rows.map(r=>'<tr class="selectable '+(selected.includes(r.id)?"chosen":"")+'" data-filter-id="'+html(r.id)+'"><td><input type="checkbox" tabindex="-1" aria-label="選取 '+html(r.item)+'" '+(selected.includes(r.id)?"checked":"")+'></td>'+q.columns.map(c=>'<td>'+html(r[c.key])+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
    }
    if(q.type==="order"){
      const order=Array.isArray(a)?a:q.items.map(x=>x.id);
      return '<div class="instruction">拖曳項目調整順序，或使用 ↑／↓ 按鈕操作。按鈕同樣適用於手機。</div><div class="sortable">'+order.map((id,i)=>{
        const item=q.items.find(x=>x.id===id); if(!item)return "";
        return '<div class="sort-item" data-drag-index="'+i+'" draggable="true"><span class="drag-handle" aria-hidden="true">⠿</span><span class="pill">'+(i+1)+'</span><strong>'+html(item.text)+'</strong><button data-move="-1" data-i="'+i+'" aria-label="向上移動" '+(!i?"disabled":"")+'>↑</button><button data-move="1" data-i="'+i+'" aria-label="向下移動" '+(i===order.length-1?"disabled":"")+'>↓</button></div>';
      }).join("")+'</div>';
    }
    if(q.type==="match"){
      return '<div class="match-rows">'+q.left.map(l=>'<div class="match-row"><label for="pair-'+html(l.id)+'">'+html(l.text)+'</label><select data-match-id="'+html(l.id)+'" id="pair-'+html(l.id)+'"><option value="">請選擇科目分類</option>'+q.right.map(r=>'<option value="'+html(r.id)+'" '+((a||{})[l.id]===r.id?"selected":"")+'>'+html(r.text)+'</option>').join("")+'</select></div>').join("")+'</div>';
    }
    if(q.type==="image"){
      const src=/^(https:\/\/|\.\/|assets\/)/.test(q.image||"")?q.image:"./assets/t-account.svg";
      const spot=q.hotspots.find(x=>x.id===a);
      return '<div class="instruction">點擊圖片內的目標區域，系統將標記你點選的位置。</div><div class="image-wrap" data-image="1"><img src="'+html(src)+'" alt="題目互動圖片" draggable="false">'+(spot?'<span class="hotspot" style="left:'+((spot.x1+spot.x2)/2)+'%;top:'+((spot.y1+spot.y2)/2)+'%">✓</span>':"")+'</div><p class="small muted">已選擇：'+html(spot?.label||"尚未選擇")+'</p>';
    }
    return '<p>未知題型</p>';
  }
  function feedback(q,a) {
    const right=score(q,a);
    return '<div class="feedback '+(right?"correct":"wrong")+'"><h4>'+(right?"✓ 答對了！":"✕ 此題尚未答對")+'</h4>'+
      '<div class="answer-reveal"><strong>正確答案：</strong>'+html(formatAnswer(q,q.answer))+'</div>'+
      '<p><strong>中文解析：</strong>'+html(q.explanation||"尚未提供解析")+'</p>'+
      '<button class="secondary-btn" data-action="toggleOriginal" data-qid="'+html(q.id)+'">'+(data.showOriginal[q.id]?"隱藏原文":"顯示原文")+'</button>'+
      (data.showOriginal[q.id]?'<p>'+html(q.originalEnglish||"此題未提供外文原題")+'</p>':"")+'</div>';
  }
  function examPage(){
    const a=data.attempt;if(!a||a.kind!==data.route)return '<div class="panel"><h2>尚未開始</h2><button class="primary-btn" data-action="start'+(data.route==="exam"?"Exam":"Practice")+'">開始</button></div>';
    const q=a.questions[a.index],n=a.questions.length,answered=a.questions.filter(isAnswered).length,isPractice=a.kind==="practice";
    return '<div class="eyebrow">'+(isPractice?"PRACTICE MODE":"EXAM MODE")+'</div><h1 class="page-title">'+(isPractice?"自由練習":"期末模擬考試")+'</h1><p class="page-desc">'+(isPractice?"每題都能查看答案與詳解，不計入歷次測驗成績。":"完成所有題型後交卷；滿分 1000 分，700 分及格。")+'</p>'+
      bankWarning()+'<div class="exam-layout"><div class="panel question-panel"><div class="question-top"><span class="type-label">'+html(typeName[q.type]||"題目")+'</span><span>Question '+(a.index+1)+' / '+n+'</span></div>'+
      '<h2 class="question-title">'+html(q.title)+'</h2>'+(q.intro?'<p class="question-intro">'+html(q.intro)+'</p>':"")+
      questionBody(q,currentAnswer(q))+
      (isPractice&&a.reveals[q.id]?feedback(q,currentAnswer(q)):"")+
      '<div class="question-footer"><div class="button-group"><button class="secondary-btn" data-action="prev" '+(!a.index?"disabled":"")+'>← 上一題</button><button class="secondary-btn" data-action="next" '+(a.index===n-1?"disabled":"")+'>下一題 →</button></div><div class="button-group">'+(isPractice?'<button class="secondary-btn" data-action="reveal">觀看答案與解析</button><button class="primary-btn" data-action="submitPractice">完成並記錄分數</button>':'<button class="primary-btn" data-action="submitExam">交卷計分</button>')+'</div></div></div>'+
      '<aside class="panel question-side"><h3>'+(isPractice?"練習進度":"考試進度")+'</h3><div class="row"><span class="muted">已作答</span><strong>'+answered+' / '+n+'</strong></div><div class="progress" style="margin-top:13px"><span style="width:'+(answered/n*100)+'%"></span></div><div class="question-dots">'+a.questions.map((item,i)=>'<button class="'+(i===a.index?"active ":"")+(isAnswered(item)?"answered":"")+'" data-go="'+i+'" aria-label="前往第 '+(i+1)+' 題">'+(i+1)+'</button>').join("")+'</div><p class="aside-note">方格可直接跳題。綠色代表已操作；尚未作答的題目在交卷時視為錯誤。</p>'+(isPractice?'<button class="secondary-btn" data-action="startPractice" style="width:100%">重新開始</button>':'<p class="small muted">經過時間：<strong id="timer">'+elapsed(a.startedAt)+'</strong></p>')+'</aside></div>';
  }
  function elapsed(start){const sec=Math.floor((Date.now()-start)/1000);return String(Math.floor(sec/60)).padStart(2,"0")+":"+String(sec%60).padStart(2,"0");}
  async function finishExam(){
    const a=data.attempt;if(!a)return;
    const unanswered=a.questions.filter(q=>!isAnswered(q)).length;
    if(!window.confirm((a.kind==="practice"?"確定完成本次練習？":"確定交卷？")+(unanswered?"尚有 "+unanswered+" 題未作答。":"")+"交卷後將計算成績。"))return;
    const correct=a.questions.filter(q=>score(q,a.answers[q.id])).length;
    const mark=Math.round(correct/a.questions.length*1000);
    const record={id:"local-"+Date.now(),mode:a.kind,user_id:data.user.id,score:mark,passed:mark>=700,answered:a.questions.length-unanswered,total:a.questions.length,created_at:new Date().toISOString(),details:a.questions.map(q=>({questionId:q.id,title:q.title,originalEnglish:q.originalEnglish||"",right:score(q,a.answers[q.id]),userAnswer:formatAnswer(q,a.answers[q.id]),correctAnswer:formatAnswer(q,q.answer),explanation:q.explanation||""}))};
    if(data.cloud){
      const {data:rows,error}=await data.db.from("results").insert({user_id:record.user_id,mode:record.mode,score:record.score,passed:record.passed,answered:record.answered,total:record.total,details:record.details}).select().single();
      if(error){notice("雲端成績儲存失敗："+error.message);return;}
      record.id=rows.id;
      await loadResults();
    }else{data.results.unshift(record);save("ac_final_results",data.results);}
    data.lastResult=record;data.reviewResult=record;data.attempt=null;setRoute("result");
  }
  function resultPage(){
    const record=data.reviewResult||data.lastResult;
    if(!record)return '<div class="panel">尚無測驗結果</div>';
    return '<div class="eyebrow">'+(record.mode==="practice"?"PRACTICE RESULT":"EXAM RESULT")+'</div><h1 class="page-title">成績與逐題詳解</h1>'+
      '<section class="panel result-hero"><div class="result-emoji">'+(record.passed?"🏆":"📖")+'</div><h2>'+(record.passed?"恭喜，達到及格標準！":"繼續努力，下一次會更好！")+'</h2><div class="result-score">'+record.score+'<small> / 1000</small></div><p class="muted">及格門檻 700 分・'+html(new Date(record.created_at).toLocaleString("zh-TW"))+'</p><div class="button-group" style="justify-content:center"><button class="primary-btn" data-action="startExam">再考一次</button><button class="secondary-btn" data-action="history">返回紀錄</button></div></section>'+
      '<div class="section-header"><h2>完整作答解析</h2><span class="muted small">'+(record.details||[]).filter(x=>x.right).length+' 題正確 / '+record.total+' 題</span></div>'+
      '<div class="review-list">'+(record.details||[]).map((d,i)=>'<article class="review-item"><div class="row"><span class="pill '+(d.right?"green":"red")+'">'+(d.right?"✓ 正確":"✕ 錯誤")+'</span><span class="muted small">第 '+(i+1)+' 題</span></div><h4>'+html(d.title)+'</h4><p><strong>你的作答：</strong>'+html(d.userAnswer)+'</p><p class="answers"><strong>正確答案：</strong>'+html(d.correctAnswer)+'</p><p><strong>中文解析：</strong>'+html(d.explanation)+'</p>'+
      (!d.right?'<button class="secondary-btn" data-review-original="'+i+'">'+(data.showOriginal["review-"+i]?"隱藏原文":"顯示原文")+'</button>'+(data.showOriginal["review-"+i]?'<p>'+html(d.originalEnglish||"原題未提供外文內容")+'</p>':""):"")+'</article>').join("")+'</div>';
  }
  function historyPage(){
    const mine=data.results.filter(r=>r.user_id===data.user?.id);
    return '<div class="eyebrow">PERFORMANCE TRACKER</div><h1 class="page-title">我的成績紀錄</h1><p class="page-desc">查看每次模擬考成績與詳解。每次按下「完成並記錄分數」的練習，與完整交卷的模擬考，都會計入。</p>'+
      demoWarning()+'<div class="panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>日期</th><th>類型</th><th>分數</th><th>完成題數</th><th>狀態</th><th>詳解</th></tr></thead><tbody>'+
      (mine.length?mine.map(r=>'<tr><td>'+html(new Date(r.created_at).toLocaleString("zh-TW"))+'</td><td>'+(r.mode==="practice"?"自由練習":"模擬考試")+'</td><td><strong>'+r.score+' / 1000</strong></td><td>'+r.answered+" / "+r.total+'</td><td><span class="pill '+(r.passed?"green":"red")+'">'+(r.passed?"及格":"未及格")+'</span></td><td><button class="secondary-btn" data-review="'+html(r.id)+'">檢視</button></td></tr>').join(""):'<tr><td colspan="6" class="muted">目前沒有紀錄。完成一次自由練習或模擬考後就會出現在這裡。</td></tr>')+'</tbody></table></div></div>';
  }
  async function loadAdmin(){
    if(!isAdmin())return;
    if(data.cloud){
      const [u,r]=await Promise.all([data.db.from("profiles").select("*").order("created_at",{ascending:false}),data.db.from("results").select("user_id,mode,score,passed,created_at").order("created_at",{ascending:false}).limit(100)]);
      if(u.error)notice("讀取帳號資料失敗："+u.error.message);
      data.adminRows=u.data||[];
      if(!r.error)data.adminResults=r.data||[];
    }else{data.adminRows=data.users.slice();data.adminResults=data.results.slice();}
    if(data.route==="admin")render();
  }
  function adminPage(){
    if(!isAdmin())return '<div class="panel">管理權限不足</div>';
    const pending=data.adminRows.filter(u=>u.status==="pending").length;
    return '<div class="eyebrow">ADMIN DASHBOARD</div><h1 class="page-title">管理員控制台</h1><p class="page-desc">審核帳號申請、確認登入次數與測驗紀錄、管理本地題庫。</p>'+demoWarning()+
      '<section class="stats-grid">'+stat("👥","總帳號數",data.adminRows.length)+stat("⌛","待審核",pending)+stat("▤","已記錄測驗",(data.adminResults||[]).length)+stat("📚","題庫題數",data.bank.length)+'</section>'+
      '<div class="section-header"><h2>帳號申請與審核</h2></div><div class="panel table-scroll"><table class="data-table"><thead><tr><th>姓名 / Email</th><th>狀態</th><th>登入次數</th><th>操作</th></tr></thead><tbody>'+
      data.adminRows.map(u=>'<tr><td><strong>'+html(u.name)+'</strong><div class="muted small">'+html(u.email)+'</div></td><td><span class="pill '+(u.status==="approved"?"green":u.status==="pending"?"gray":"red")+'">'+({approved:"已核准",pending:"待審核",rejected:"已停用"}[u.status]||"未知")+(u.role==="admin"?" · 管理員":"")+'</span></td><td>'+Number(u.login_count||0)+'</td><td>'+((u.role==="admin")?"—":'<div class="button-group"><button class="secondary-btn" data-approve="'+html(u.id)+'" data-status="approved" '+(u.status==="approved"?"disabled":"")+'>核准</button><button class="danger-btn" data-approve="'+html(u.id)+'" data-status="rejected" '+(u.status==="rejected"?"disabled":"")+'>停用</button></div>')+'</td></tr>').join("")+'</tbody></table></div>'+
      '<div class="section-header"><h2>近期測驗成績</h2></div><div class="panel table-scroll"><table class="data-table"><thead><tr><th>學員</th><th>類型</th><th>成績</th><th>是否及格</th><th>日期</th></tr></thead><tbody>'+
      ((data.adminResults||[]).length?(data.adminResults||[]).slice(0,30).map(r=>'<tr><td>'+html(data.adminRows.find(u=>u.id===r.user_id)?.name||r.user_id)+'</td><td>'+(r.mode==="practice"?"自由練習":"模擬考試")+'</td><td>'+r.score+'</td><td>'+(r.passed?"及格":"未及格")+'</td><td>'+html(new Date(r.created_at).toLocaleString("zh-TW"))+'</td></tr>').join(""):'<tr><td colspan="5" class="muted">尚無紀錄</td></tr>')+'</tbody></table></div>'+
      '<div class="section-header"><h2>管理題庫</h2></div><div class="panel"><p class="muted">可匯入符合 README 格式的 JSON 題庫，系統會以正規化題目文字排除重複。匯入後會<strong>取代示範題庫</strong>，但僅儲存在本瀏覽器。若要讓所有學生看到正式題庫，需把 JSON 提交到 GitHub 專案的 questions.json。</p><input id="bankInput" type="file" accept=".json,application/json" hidden><div class="button-group"><button class="primary-btn" data-action="importBank">匯入 JSON 題庫</button><button class="secondary-btn" data-action="exportBank">匯出目前題庫</button><button class="secondary-btn" data-action="restoreBank">清除自訂題庫</button></div><p class="small muted">PDF / MD 需先依原有文字、圖片與互動規則整理為 JSON；目前尚無自動解析 PDF 的功能。</p></div>'+
      '<div class="section-header"><h2>帳號安全</h2></div><form class="panel" id="passwordForm"><p class="muted">請將管理員密碼改為獨特且足夠強的密碼。正式模式管理員請在 Supabase Auth 建立，不會把初始密碼寫進公開網站。</p><div class="input-group"><label for="newPassword">新密碼（至少 8 碼）</label><input id="newPassword" type="password" minlength="8" required autocomplete="new-password"></div><button class="primary-btn" type="submit">更新我的密碼</button></form>';
  }
  function render(){
    const titles={home:"學習總覽",practice:"自由練習",exam:"模擬考試",history:"成績紀錄",admin:"管理後台",result:"成績詳解"};
    setHeader(titles[data.route]||"學習總覽");
    byId("app").innerHTML=({home,practice:examPage,exam:examPage,history:historyPage,admin:adminPage,result:resultPage}[data.route]||home)();
  }
  async function approve(id,status){
    if(!isAdmin())return;
    if(data.cloud){const r=await data.db.rpc("set_student_status",{target_user:id,next_status:status});if(r.error)throw r.error;}
    else{const u=data.users.find(x=>x.id===id&&x.role!=="admin");if(!u)return;u.status=status;save("ac_final_users",data.users);}
    notice(status==="approved"?"帳號已核准":"帳號已停用");await loadAdmin();
  }
  function importBank(file){
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const parsed=JSON.parse(String(reader.result));
        const incoming=Array.isArray(parsed)?parsed:parsed.questions;
        if(!Array.isArray(incoming)||!incoming.length||!incoming.every(validQuestion))throw Error("題庫格式不正確，請參考 README 的範例");
        const merged=unique(data.custom.concat(incoming));const added=merged.length-data.custom.length;
        data.custom=merged;data.bank=merged.slice();save("ac_final_bank",data.custom);
        notice("匯入完成：新增 "+added+" 題；已自動排除 "+(incoming.length-added)+" 題重複內容");render();
      }catch(e){notice("匯入失敗："+e.message);}
    };
    reader.readAsText(file);
  }
  function exportBank(){
    const payload=JSON.stringify({version:1,kind:data.custom.length?"imported":"demonstration",questions:data.bank},null,2);
    const url=URL.createObjectURL(new Blob([payload],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="accounting_questions.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function handleMove(i,step){
    const a=data.attempt,q=a.questions[a.index],current=currentAnswer(q);
    const order=Array.isArray(current)?current.slice():q.items.map(x=>x.id);
    const next=i+step;if(next<0||next>=order.length)return;
    [order[i],order[next]]=[order[next],order[i]];
    setAnswer(q,order);
  }
  function controls(){
    document.querySelectorAll("[data-route]").forEach(btn=>btn.addEventListener("click",()=>setRoute(btn.dataset.route)));
    byId("menuToggle").addEventListener("click",()=>byId("sidebar").classList.toggle("open"));
    byId("accountBtn").addEventListener("click",()=>data.user?notice(data.user.email):showAuth("login"));
    byId("logoutBtn").addEventListener("click",()=>logout().catch(e=>notice(e.message)));
    document.addEventListener("submit",async e=>{
      if(e.target.id==="authForm"){
        e.preventDefault();const form=e.target,mode=form.dataset.mode,email=form.elements.email.value.trim().toLowerCase(),password=form.elements.password.value;
        const button=form.querySelector('[type="submit"]');button.disabled=true;
        try{
          if(mode==="register"){const name=form.elements.name.value.trim();if(!name)throw Error("請填寫姓名");await register(name,email,password);closeAuth();notice("申請已送出，請等待管理員核准"+(data.cloud?"；若啟用 Email 驗證，也需完成信箱驗證":""));}
          else await login(email,password);
        }catch(err){byId("authError").textContent=err.message||"發生錯誤";}
        finally{button.disabled=false;}
      }
      if(e.target.id==="passwordForm"){
        e.preventDefault();const pwd=byId("newPassword").value;
        try{await changePassword(pwd);byId("newPassword").value="";notice("密碼更新成功");}catch(err){notice("更新失敗："+err.message);}
      }
    });
    document.addEventListener("click",async e=>{
      const auth=e.target.closest("[data-auth-mode]");if(auth){showAuth(auth.dataset.authMode);return;}
      const b=e.target.closest("[data-action]");
      if(b){
        const action=b.dataset.action;
        if(action==="startPractice"||action==="startExam"){start(action==="startExam"?"exam":"practice");return;}
        if(action==="history"){setRoute("history");return;}
        if(action==="prev"||action==="next"){if(data.attempt){data.attempt.index=Math.max(0,Math.min(data.attempt.questions.length-1,data.attempt.index+(action==="next"?1:-1)));render();}return;}
        if(action==="reveal"){const q=data.attempt.questions[data.attempt.index];data.attempt.reveals[q.id]=true;render();return;}
        if(action==="submitExam"||action==="submitPractice"){await finishExam();return;}
        if(action==="toggleOriginal"){data.showOriginal[b.dataset.qid]=!data.showOriginal[b.dataset.qid];render();return;}
        if(action==="importBank"){byId("bankInput")?.click();return;}
        if(action==="exportBank"){exportBank();return;}
        if(action==="restoreBank"){if(confirm("確定清除本機匯入的題庫並恢復示範題庫？")){data.custom=[];data.bank=data.base.slice();localStorage.removeItem("ac_final_bank");render();notice("已恢復示範題庫");}return;}
      }
      const goto=e.target.closest("[data-go]");if(goto&&data.attempt){data.attempt.index=Number(goto.dataset.go);render();return;}
      const mover=e.target.closest("[data-move]");if(mover&&data.attempt){handleMove(Number(mover.dataset.i),Number(mover.dataset.move));return;}
      const row=e.target.closest("[data-filter-id]");
      if(row&&data.attempt){const q=data.attempt.questions[data.attempt.index];const id=row.dataset.filterId,selected=Array.isArray(currentAnswer(q))?currentAnswer(q).slice():[];if(selected.includes(id))selected.splice(selected.indexOf(id),1);else selected.push(id);setAnswer(q,selected);return;}
      const imageTarget=e.target.closest("[data-image]");
      if(imageTarget&&data.attempt){
        const q=data.attempt.questions[data.attempt.index],img=imageTarget.querySelector("img"),rect=img.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*100,y=(e.clientY-rect.top)/rect.height*100;
        const found=q.hotspots.find(h=>x>=h.x1&&x<=h.x2&&y>=h.y1&&y<=h.y2);
        if(found)setAnswer(q,found.id);
        return;
      }
      const approveButton=e.target.closest("[data-approve]");
      if(approveButton){try{await approve(approveButton.dataset.approve,approveButton.dataset.status);}catch(error){notice(error.message);}return;}
      const reviewButton=e.target.closest("[data-review]");
      if(reviewButton){data.reviewResult=data.results.find(r=>String(r.id)===reviewButton.dataset.review);data.showOriginal={};setRoute("result");return;}
      const original=e.target.closest("[data-review-original]");
      if(original){const key="review-"+original.dataset.reviewOriginal;data.showOriginal[key]=!data.showOriginal[key];render();}
    });
    document.addEventListener("change",e=>{
      const upload=e.target.closest("#bankInput");if(upload?.files?.length){importBank(upload.files[0]);return;}
      if(!data.attempt)return;
      const q=data.attempt.questions[data.attempt.index];
      if(e.target.name==="choice"){
        const v=e.target.value;
        if(q.type==="single")setAnswer(q,v);
        if(q.type==="multiple"){const curr=Array.isArray(currentAnswer(q))?currentAnswer(q).slice():[];if(e.target.checked&&!curr.includes(v))curr.push(v);if(!e.target.checked)curr.splice(curr.indexOf(v),1);setAnswer(q,curr);}
      }
      const sel=e.target.closest("[data-match-id]");
      if(sel){const value=Object.assign({},currentAnswer(q)||{});if(sel.value)value[sel.dataset.matchId]=sel.value;else delete value[sel.dataset.matchId];setAnswer(q,value);}
    });
    let dragSource=null;
    document.addEventListener("dragstart",e=>{const item=e.target.closest("[data-drag-index]");if(item){dragSource=Number(item.dataset.dragIndex);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",String(dragSource));}});
    document.addEventListener("dragover",e=>{if(dragSource!==null&&e.target.closest("[data-drag-index]"))e.preventDefault();});
    document.addEventListener("drop",e=>{const item=e.target.closest("[data-drag-index]");if(item&&dragSource!==null&&data.attempt){e.preventDefault();const idx=Number(item.dataset.dragIndex),q=data.attempt.questions[data.attempt.index],curr=currentAnswer(q),order=Array.isArray(curr)?curr.slice():q.items.map(x=>x.id);const moved=order.splice(dragSource,1)[0];order.splice(idx,0,moved);dragSource=null;setAnswer(q,order);}});
    document.addEventListener("dragend",()=>dragSource=null);
    setInterval(()=>{const t=byId("timer");if(t&&data.attempt)t.textContent=elapsed(data.attempt.startedAt);},1000);
    window.addEventListener("hashchange",()=>{const p=location.hash.slice(1);if(["home","practice","exam","history","admin"].includes(p))setRoute(p);});
  }
  async function init(){
    try{const r=await fetch("./questions.json");if(!r.ok)throw Error("題庫載入失敗");const payload=await r.json();data.base=unique(payload.questions||[]);data.custom=unique(data.custom.filter(validQuestion));data.bank=data.custom.length?data.custom.slice():data.base.slice();}
    catch(err){byId("app").innerHTML='<div class="panel">無法載入題庫：'+html(err.message)+'</div>';return;}
    data.cloud=await initCloud();
    if(!data.cloud)await seedDemo();
    controls();render();
    if(data.cloud&&data.user)await loadResults();
  }
  init().catch(err=>{console.error(err);byId("app").innerHTML='<div class="panel">初始化發生錯誤：'+html(err.message)+'</div>';});
})();
