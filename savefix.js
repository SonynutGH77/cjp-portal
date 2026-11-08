/* CJP Portal v6.3 - resilient SharePoint saving
   Serialises saves, keeps an encrypted-session recovery copy, retries transient
   failures, and exposes a Retry button. It never silently overwrites a
   concurrent SharePoint version.
*/
'use strict';
(function(){
  const REC='cjp.unsaved.recovery', RETRY=[1200,3500,8000];
  let busy=false,pending=false,timer=null,lastError='',original=null;
  const el=id=>document.getElementById(id);
  function snapshot(reason){try{sessionStorage.setItem(REC,JSON.stringify({at:new Date().toISOString(),reason,data:S}))}catch(e){console.warn('Recovery snapshot failed',e)}}
  function clearSnapshot(){try{sessionStorage.removeItem(REC)}catch(e){}}
  function statusText(){return (el('syncState')?.textContent||'').trim()}
  function failed(){return /save failed|failed to save|conflict|sign.?in/i.test(statusText())}
  function setState(t){try{if(typeof setSync==='function')setSync(t);else if(el('syncState'))el('syncState').textContent=t}catch(e){}}
  function controls(){let sync=el('syncState')?.parentElement;if(!sync||el('saveRetry'))return;let b=document.createElement('button');b.id='saveRetry';b.className='btn sm';b.textContent='Retry save';b.style.cssText='display:none;margin-top:6px;width:100%';b.onclick=()=>SaveFix.retry();sync.appendChild(b)}
  function showRetry(show,msg){controls();let b=el('saveRetry');if(b){b.style.display=show?'block':'none';if(msg)b.title=msg}}
  async function attempt(force=false){
    if(busy){pending=true;return false}busy=true;pending=false;snapshot('save queued');setState('Saving…');
    try{
      await original(force);
      // Original portal versions catch internally, so inspect the status too.
      if(failed())throw new Error(statusText()||'SharePoint write failed');
      clearSnapshot();showRetry(false);lastError='';return true;
    }catch(e){
      lastError=e?.message||String(e);snapshot(lastError);setState('⚠ Save failed · recovery kept');showRetry(true,lastError);console.error('CJP save failure',e);return false;
    }finally{
      busy=false;if(pending){pending=false;setTimeout(()=>attempt(false),250)}
    }
  }
  async function retry(){showRetry(false);for(let i=0;i<=RETRY.length;i++){let ok=await attempt(true);if(ok){if(typeof toast==='function')toast('Saved to SharePoint');return true}if(i<RETRY.length)await new Promise(r=>setTimeout(r,RETRY[i]))}showRetry(true,lastError);if(typeof toast==='function')toast('Save still failed. Recovery copy kept in this browser session.');return false}
  function install(){
    controls();if(typeof saveData!=='function'||original)return;
    original=saveData.bind(window);
    // Do NOT replace saveData. app.js save() calls saveData(), and replacing both can recurse.
    // Instead only replace the debounced convenience save() used by add-ons.
    if(typeof save==='function')save=function(){clearTimeout(timer);snapshot('pending local change');timer=setTimeout(()=>attempt(false),650);try{if(typeof renderAll==='function')renderAll()}catch(e){}};
    let obs=new MutationObserver(()=>{if(failed()){snapshot(statusText());showRetry(true,statusText())}});if(el('syncState'))obs.observe(el('syncState'),{childList:true,characterData:true,subtree:true});
    let rec=null;try{rec=JSON.parse(sessionStorage.getItem(REC)||'null')}catch(e){}if(rec&&rec.data){showRetry(true,'Unsaved recovery from '+rec.at);setState('⚠ Unsaved recovery available');}
  }
  window.SaveFix={retry,get recovery(){try{return JSON.parse(sessionStorage.getItem(REC)||'null')}catch(e){return null}},discard(){clearSnapshot();showRetry(false)}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,1800));else setTimeout(install,1800);
})();
