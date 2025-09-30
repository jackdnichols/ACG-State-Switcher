// ===============================
// ACG State Switcher — popup.js
// ===============================

function isAcgAaaHost(urlString) {
	try {
		const { hostname } = new URL(urlString);
		const host = hostname.toLowerCase();
		return host === "acg.aaa.com" || host.endsWith(".acg.aaa.com");
	} catch {
		return false;
	}
}

async function getActiveTab() {
	  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	  return tabs?.[0] || null;
}

function setStateControlsEnabled(enabled) {
	const sel = document.getElementById('stateSelect');
	const btn = document.getElementById('applyBtn');
	const note = document.getElementById('stateLockNote');
	if (sel) sel.disabled = !enabled;
	if (btn) btn.disabled = !enabled;
	if (note) note.style.display = enabled ? 'none' : 'block';
}

/* ---------- Apply Cookies ---------- */
const DOMAIN_ALLOWLIST = ["aaa.com", "acg.aaa.com", "meemic.com", "meemicfoundation.org"];
function targetUrlForCookie(c){const p=(c.path&&String(c.path))||"/";if(c.hostOnly&&c.domain){const h=String(c.domain).replace(/^\./,"");return `https://${h}${p.startsWith("/")?p:`/${p}`}`;}return `https://www.acg.aaa.com${p.startsWith("/")?p:`/${p}`}`;}
function normalizeSameSite(v){if(v==null)return;const s=String(v).toLowerCase();if(s==="none"||s==="no_restriction")return"no_restriction";if(s==="lax")return"lax";if(s==="strict")return"strict";}
function isAllowedHost(url){try{const u=new URL(url);const h=u.hostname.toLowerCase();return DOMAIN_ALLOWLIST.some(d=>{d=d.toLowerCase().replace(/^\./,"");return h===d||h.endsWith("."+d);});}catch{return false;}}
function buildCompatDetails(c){const d={url:targetUrlForCookie(c),name:c.name,value:String(c.value??""),path:(c.path&&String(c.path))||"/",secure:!!c.secure,httpOnly:!!c.httpOnly};if(!c.hostOnly&&c.domain)d.domain=c.domain;const ss=normalizeSameSite(c.sameSite);if(ss)d.sameSite=ss;if(d.sameSite==="no_restriction"){d.secure=true;try{const u=new URL(d.url);u.protocol="https:";d.url=u.toString();}catch{}}if(Number.isFinite(+c.expirationDate))d.expirationDate=Math.floor(+c.expirationDate);return d;}
function candidateCookiePaths(n){const raw=(n||"").trim();const ns=raw.replace(/\s+/g,"");const low=raw.toLowerCase();const lns=low.replace(/\s+/g,"");return[`cookies/${raw}.json`,`cookies/${ns}.json`,`cookies/${low}.json`,`cookies/${lns}.json`];}
async function fetchFirstCookieFile(n){const tried=[];for(const p of candidateCookiePaths(n)){const url=chrome.runtime.getURL(p);tried.push(url);try{const r=await fetch(url);if(r.ok)return{json:await r.json(),path:p};}catch{}}const e=new Error(`No cookie file found for "${n}".`);e.tried=tried;throw e;}
async function applyCookies(cookies){let ok=0,fail=0;const errors=[];for(const c of cookies){const name=c?.name||"(unnamed)";try{if(!c?.name)throw new Error("Missing name");const val=String(c.value??"");if(val.length>4096)throw new Error("Value exceeds 4096 bytes");let det=buildCompatDetails(c);if(!isAllowedHost(det.url)){const exact=(c.hostOnly&&c.domain)?String(c.domain).replace(/^\./,""):(c.domain?String(c.domain).replace(/^\./,""):"www.acg.aaa.com");det={url:`https://${exact}/`,name:c.name,value:String(c.value??""),path:"/",secure:true,httpOnly:!!c.httpOnly};if(!isAllowedHost(det.url))throw new Error(`not in allowlist (${det.url})`);}await chrome.cookies.set(det);ok++;}catch(e){fail++;errors.push(`${name}: ${e?.message||e}`);}}return{ok,fail,errors};}
function toast(el,msg,ok=true){if(!el)return;el.className=ok?"success":"success";el.textContent=msg;}

document.getElementById('applyBtn')?.addEventListener('click', async () => {
  const msgEl=document.getElementById('stateMsg');
  
  // Hard guard: do nothing if disabled
  if (document.getElementById('applyBtn').disabled) return;

  try{
    const sel=document.getElementById('stateSelect');const state=sel?.value?.trim();
    if(!state){toast(msgEl,"Pick a state first.",false);return;}
    const {json:cookies,path}=await fetchFirstCookieFile(state);
    const {ok,fail,errors}=await applyCookies(cookies);
    if(fail===0)toast(msgEl,`Applied ${ok} cookies ✔ (${path})`,true);
    else{const summary=errors.slice(0,6).join(" • ");toast(msgEl,`Applied ${ok}; ${fail} failed. ${summary}${errors.length>6?" • …":""}`,false);}
    setTimeout(()=>{chrome.tabs.query({active:true,currentWindow:true},(tabs)=>{const id=tabs?.[0]?.id;if(id)chrome.tabs.reload(id,{bypassCache:true});});window.close();},1000);
  }catch(err){console.error('State apply error:',err);toast(msgEl,err?.message||"Error applying state cookies",false);}
});

/* ---------- Env Websites + Author (unchanged from your last working) ---------- */
const ENV_KEY='selectedEnv';let currentEnv=null;
const urls={acg:{production:"https://www.acg.aaa.com",stage1:"https://www.stage1.acg.aaa.com",qa1:"https://www.qa1.acg.aaa.com",dev1:"https://www.dev1.acg.aaa.com"},meemic:{production:"https://www.meemic.com",stage1:"https://stage1.meemic.com",qa1:"https://qa1.meemic.com",dev1:"https://dev1.meemic.com"},meemicfoundation:{production:"https://www.meemicfoundation.org",stage1:"https://stage1.meemicfoundation.org",qa1:"https://qa1.meemicfoundation.org",dev1:"https://dev1.meemicfoundation.org"}};
const authorUrls={production:"https://author-p149839-e1583596.adobeaemcloud.com",stage1:"https://author-p149839-e1583546.adobeaemcloud.com",qa1:"https://author-p149839-e1583595.adobeaemcloud.com",dev1:"https://author-p149839-e1544194.adobeaemcloud.com"};
function setDisabled(a,d){a.classList.toggle('disabled',d);if(d){a.setAttribute('aria-disabled','true');a.setAttribute('tabindex','-1');}else{a.removeAttribute('aria-disabled');a.removeAttribute('tabindex');}}
function enableWebsitesAndAemLinks(){const en=!!currentEnv;document.querySelectorAll('[data-company]').forEach(a=>setDisabled(a,!en));const author=document.getElementById('authorLink');if(author)setDisabled(author,!en);}
function setActiveEnvLink(env){document.querySelectorAll('#envRow a[data-env]').forEach(a=>{const on=a.getAttribute('data-env')===env;a.classList.toggle('active',on);a.setAttribute('aria-selected',on?'true':'false');if(on)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');});}
document.getElementById('envRow')?.addEventListener('click',(e)=>{const a=e.target.closest('a[data-env]');if(!a)return;e.preventDefault();currentEnv=a.getAttribute('data-env');setActiveEnvLink(currentEnv);enableWebsitesAndAemLinks();try{chrome.storage.sync.set({[ENV_KEY]:currentEnv});}catch{}},true);
document.querySelectorAll('[data-company]').forEach(link=>{link.addEventListener('click',(e)=>{e.preventDefault();if(!currentEnv||link.classList.contains('disabled'))return;const company=link.getAttribute('data-company');const target=urls?.[company]?.[currentEnv];if(target)chrome.tabs.create({url:target});});});
document.getElementById('authorLink')?.addEventListener('click',(e)=>{e.preventDefault();if(!currentEnv||e.currentTarget.classList.contains('disabled'))return;const target=authorUrls[currentEnv];if(target)chrome.tabs.create({url:target});});

/* ---------- Theme ---------- */
function applyTheme(mode){document.documentElement.setAttribute("data-theme",mode);document.getElementById('themeLight')?.setAttribute('aria-pressed',String(mode==='light'));document.getElementById('themeDark')?.setAttribute('aria-pressed',String(mode==='dark'));document.getElementById('themeSystem')?.setAttribute('aria-pressed',String(mode==='system'));}
(async function initTheme(){const saved=(await chrome.storage.sync.get(['themeMode']))?.themeMode??'system';applyTheme(saved);document.getElementById('themeLight')?.addEventListener('click',async()=>{applyTheme('light');await chrome.storage.sync.set({themeMode:'light'});});document.getElementById('themeDark')?.addEventListener('click',async()=>{applyTheme('dark');await chrome.storage.sync.set({themeMode:'dark'});});document.getElementById('themeSystem')?.addEventListener('click',async()=>{applyTheme('system');await chrome.storage.sync.set({themeMode:'system'});});})();

/* ---------- Badge Options (unchanged from last working) ---------- */
async function withActiveTab(fn){const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs?.[0];if(!tab?.id)return;return fn(tab.id);}
document.querySelectorAll('input[name="badgeMode"]').forEach(r=>{
  r.addEventListener('change',async()=>{
    if(!r.checked) return;
    const mode=r.value; // selector | corner | free
    await withActiveTab(async (id)=>{try{await chrome.tabs.sendMessage(id,{type:"SET_BADGE_MODE",mode});}catch{}});
    const note=document.getElementById('stateMsg2');
    if(note) note.textContent = mode==="free" ? "Drag anywhere on the page. Position auto-saves per URL." : "Mode updated.";
  });
});
document.getElementById('badgeCorner')?.addEventListener('change',async(e)=>{
  const corner=e.target.value;
  await withActiveTab(async(id)=>{try{await chrome.tabs.sendMessage(id,{type:"SET_BADGE_CORNER",corner});}catch{}});
  const note=document.getElementById('stateMsg2'); if(note) note.textContent="Corner saved.";
});
document.getElementById('badgeAnchor')?.addEventListener('change',async(e)=>{
  const anchor=e.target.value.trim();
  await withActiveTab(async(id)=>{try{await chrome.tabs.sendMessage(id,{type:"SET_BADGE_ANCHOR",anchor});}catch{}});
  const note=document.getElementById('stateMsg2'); if(note) note.textContent="Anchor selector saved.";
});
const sendOffsets=async()=>{
  const offX=Number(document.getElementById('badgeOffsetX')?.value||0);
  const offY=Number(document.getElementById('badgeOffsetY')?.value||0);
  await withActiveTab(async(id)=>{try{await chrome.tabs.sendMessage(id,{type:"SET_BADGE_OFFSETS",offX,offY});}catch{}});
  const note=document.getElementById('stateMsg2'); if(note) note.textContent="Offsets saved.";
};
document.getElementById('badgeOffsetX')?.addEventListener('change',sendOffsets);
document.getElementById('badgeOffsetY')?.addEventListener('change',sendOffsets);
document.getElementById('badgeReset')?.addEventListener('click',async()=>{
  await withActiveTab(async(id)=>{try{await chrome.tabs.sendMessage(id,{type:"BADGE_RESET_POSITION"});}catch{}});
  const note=document.getElementById('stateMsg2'); if(note) note.textContent="Position cleared for this URL (snapped to anchor).";
});

/* ---------- Init ---------- */
(async function init(){
  // Gate the State UI based on active tab domain
  const tab = await getActiveTab();
  const allowed = !!tab?.url && isAcgAaaHost(tab.url);
  setStateControlsEnabled(allowed);

  try{const stored=await chrome.storage.sync.get('selectedEnv');currentEnv=stored?.['selectedEnv']||'qa1';}
  catch{currentEnv='qa1';}
  setActiveEnvLink(currentEnv); 
  enableWebsitesAndAemLinks();
})();
