/* Property Portal v7.0 Alpha - non-destructive encrypted vault migration
   Web Crypto only: PBKDF2-HMAC-SHA-256 (600,000) + AES-256-GCM + HKDF-SHA-256.
   The passphrase and master key are never persisted. Existing portal-data.json is NOT deleted. */
(() => {
  'use strict';
  const te = new TextEncoder(), td = new TextDecoder();
  const ROOT = 'Portal/vault-v7-alpha';
  const ITER = 600000, IDLE = 15 * 60 * 1000;
  let master = null, idleTimer = null, recoveryText = '';
  const $ = s => document.querySelector(s);
  const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const wipe = a => { try { if (a?.fill) a.fill(0); } catch {} };
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  async function pbkdf(pass, salt) {
    const material = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations:ITER}, material, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }
  async function rawAes(raw, usages=['encrypt','decrypt']) { return crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, false, usages); }
  async function seal(key, value, aad='') {
    const iv=rand(12), plain=te.encode(typeof value==='string' ? value : JSON.stringify(value));
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:te.encode(aad),tagLength:128},key,plain);
    return {v:1,alg:'A256GCM',iv:b64(iv),aad,ct:b64(ct)};
  }
  async function open(key, box) {
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(box.iv),additionalData:te.encode(box.aad||''),tagLength:128},key,unb64(box.ct));
    return td.decode(plain);
  }
  async function domainKey(name) {
    if (!master) throw new Error('Vault is locked');
    const base=await crypto.subtle.importKey('raw',master,'HKDF',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:te.encode('cjp-v7'),info:te.encode(name)},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function sha(value) { return b64(await crypto.subtle.digest('SHA-256',te.encode(JSON.stringify(value)))); }
  async function hmacId(value) {
    if (!master) throw new Error('Vault is locked');
    const k=await crypto.subtle.importKey('raw',master,{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sig=await crypto.subtle.sign('HMAC',k,te.encode(String(value)));
    return b64(sig).replace(/[+/=]/g,'').slice(0,22);
  }
  function write(path,text) {
    if (!window.Store) throw new Error('Private storage is not connected');
    if (typeof Store.writeText==='function') return Store.writeText(path,text);
    if (typeof Store.putText==='function') return Store.putText(path,text);
    if (typeof Store.write==='function') return Store.write(path,new Blob([text],{type:'application/json'}));
    throw new Error('This portal build does not expose a compatible private-storage writer');
  }
  async function read(path) {
    if (!window.Store) throw new Error('Private storage is not connected');
    if (typeof Store.readText==='function') return Store.readText(path);
    if (typeof Store.getText==='function') return Store.getText(path);
    throw new Error('This portal build does not expose a compatible private-storage reader');
  }

  function txDate(t){ return String(t.date||t.transactionDate||t.postedDate||'').slice(0,7) || 'unknown'; }
  function isSmsf(x){ return /smsf|super fund|the canopy/i.test(JSON.stringify(x||{})); }
  async function minimiseAccount(a){
    const n=String(a.accountNumber||a.number||a.accountNo||'').replace(/\D/g,'');
    const out={...a}; delete out.accountNumber; delete out.number; delete out.accountNo;
    if(n){out.last4=n.slice(-4);out.accountRef=await hmacId(n);}
    return out;
  }
  async function partition(source){
    const clone=structuredClone(source), tx=clone.transactions||[]; delete clone.transactions;
    const accounts=clone.accounts||[]; clone.accounts=await Promise.all(accounts.map(minimiseAccount));
    const personalTx={}, smsfTx={};
    for(const t of tx){ const bucket=isSmsf(t)?smsfTx:personalTx; (bucket[txDate(t)] ||= []).push(t); }
    const smsfProps=(clone.properties||[]).filter(isSmsf), personalProps=(clone.properties||[]).filter(x=>!isSmsf(x));
    const personal={...clone,properties:personalProps};
    const smsf={properties:smsfProps,accounts:(clone.accounts||[]).filter(isSmsf),tax:clone.smsfTax||clone.tax?.smsf||null};
    personal.accounts=(clone.accounts||[]).filter(x=>!isSmsf(x)); delete personal.smsfTax;
    return {personal,smsf,personalTx,smsfTx};
  }
  async function createKeys(pass){
    if(pass.length<16) throw new Error('Use a unique passphrase of at least 16 characters');
    const salt=rand(16), recovery=rand(32), m=rand(32);
    const pkey=await pbkdf(pass,salt), rkey=await rawAes(recovery);
    const wrappedPassword=await seal(pkey,b64(m),'cjp-v7-master-password');
    const wrappedRecovery=await seal(rkey,b64(m),'cjp-v7-master-recovery');
    master=m;
    recoveryText='CJP-V7-'+b64(recovery).replace(/=/g,'').match(/.{1,8}/g).join('-');
    return {salt:b64(salt),iterations:ITER,wrappedPassword,wrappedRecovery};
  }
  function recoveryBytes(text){ return unb64(text.replace(/^CJP-V7-/,'').replace(/-/g,'')+'==='.slice((text.replace(/^CJP-V7-/,'').replace(/-/g,'').length+3)%4)); }
  async function unlockWithPass(pass,manifest){
    const pkey=await pbkdf(pass,unb64(manifest.kdf.salt));
    master=unb64(await open(pkey,manifest.keys.wrappedPassword)); touch(); return true;
  }
  async function unlockWithRecovery(code,manifest){
    const rkey=await rawAes(recoveryBytes(code));
    master=unb64(await open(rkey,manifest.keys.wrappedRecovery)); touch(); return true;
  }
  function touch(){ clearTimeout(idleTimer); if(master) idleTimer=setTimeout(lock,IDLE); }
  function lock(){ wipe(master); master=null; recoveryText=''; clearTimeout(idleTimer); setStatus('Vault locked'); }
  function download(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function setStatus(t,kind=''){const e=$('#v7status');if(e){e.textContent=t;e.dataset.kind=kind;}}
  async function migrate(){
    if(!window.S) throw new Error('Portal data is not loaded');
    const p1=$('#v7pass').value,p2=$('#v7pass2').value;if(p1!==p2)throw new Error('Passphrases do not match');
    setStatus('Deriving key and encrypting…');
    const keyMeta=await createKeys(p1), parts=await partition(S), files={};
    const add=async(path,domain,value)=>{const key=await domainKey(domain);const box=await seal(key,value,path);files[path]=JSON.stringify(box);};
    await add(`${ROOT}/personal/core.enc`,'personal',parts.personal);
    await add(`${ROOT}/smsf/core.enc`,'smsf',parts.smsf);
    for(const [m,v] of Object.entries(parts.personalTx)) await add(`${ROOT}/transactions/personal/${m}.enc`,'transactions-personal',v);
    for(const [m,v] of Object.entries(parts.smsfTx)) await add(`${ROOT}/transactions/smsf/${m}.enc`,'transactions-smsf',v);
    const manifest={format:'cjp-vault',version:1,created:new Date().toISOString(),cipher:'AES-256-GCM',kdf:{name:'PBKDF2-HMAC-SHA-256',salt:keyMeta.salt,iterations:ITER},keys:{wrappedPassword:keyMeta.wrappedPassword,wrappedRecovery:keyMeta.wrappedRecovery},objects:Object.keys(files),sourceHash:await sha(S),status:'alpha-parallel'};
    for(const [path,text] of Object.entries(files)) await write(path,text);
    await write(`${ROOT}/manifest.json`,JSON.stringify(manifest,null,2));
    // Verification reads every object back and authenticates each GCM tag.
    for(const path of manifest.objects){const box=JSON.parse(await read(path));const domain=path.includes('/smsf/')?'smsf':path.includes('/transactions/personal/')?'transactions-personal':path.includes('/transactions/smsf/')?'transactions-smsf':'personal';await open(await domainKey(domain),box);}
    download('CJP-V7-RECOVERY-KEY.txt',`CJP Property Portal V7 recovery key\n\n${recoveryText}\n\nStore this offline. Anyone with this key and the encrypted vault can decrypt the vault.\n`);
    setStatus(`Encrypted vault verified: ${manifest.objects.length} object(s). Plaintext data was not deleted.`,'ok');
    $(`#v7pass`).value='';$(`#v7pass2`).value=''; touch();
  }
  async function verifyExisting(){
    setStatus('Reading encrypted manifest…');const manifest=JSON.parse(await read(`${ROOT}/manifest.json`));
    const pass=$('#v7unlock').value, rec=$('#v7recovery').value;
    if(pass) await unlockWithPass(pass,manifest); else if(rec) await unlockWithRecovery(rec,manifest); else throw new Error('Enter the Vault passphrase or recovery key');
    for(const path of manifest.objects){const box=JSON.parse(await read(path));const domain=path.includes('/smsf/')?'smsf':path.includes('/transactions/personal/')?'transactions-personal':path.includes('/transactions/smsf/')?'transactions-smsf':'personal';await open(await domainKey(domain),box);}
    setStatus(`Vault unlocked and verified: ${manifest.objects.length} encrypted object(s).`,'ok');
  }
  function modal(){
    let e=$('#v7modal');if(e)return e;
    e=document.createElement('div');e.id='v7modal';e.style.cssText='display:none;position:fixed;inset:0;z-index:10000;background:#060a14e8;padding:25px;overflow:auto';
    e.innerHTML=`<div style="max-width:720px;margin:auto;background:#141b2d;border:1px solid #33415f;border-radius:18px;padding:24px;color:#eef3ff"><div style="display:flex;justify-content:space-between;gap:12px"><div><h2 style="margin:0">🔐 V7 Security Vault</h2><p style="color:#9eb0d0">Alpha migration writes a parallel encrypted vault. It does not replace or delete the current data file.</p></div><button id="v7close" class="btn">Close</button></div><div class="card"><h3>Create encrypted parallel vault</h3><label>New Vault passphrase</label><input id="v7pass" type="password" autocomplete="new-password"><label>Confirm passphrase</label><input id="v7pass2" type="password" autocomplete="new-password"><p class="muted sm">Minimum 16 characters. The passphrase is never stored or sent. An offline recovery key is downloaded once.</p><button id="v7migrate" class="btn primary">Create and verify encrypted vault</button></div><div class="card" style="margin-top:14px"><h3>Verify existing V7 vault</h3><label>Vault passphrase</label><input id="v7unlock" type="password" autocomplete="current-password"><div style="text-align:center;color:#789;margin:8px">or</div><label>Offline recovery key</label><input id="v7recovery" type="password" autocomplete="off"><button id="v7verify" class="btn">Unlock and verify</button> <button id="v7lock" class="btn">Lock now</button></div><div id="v7status" class="note" style="margin-top:14px">Ready. No data has been changed.</div></div>`;
    document.body.appendChild(e);$('#v7close').onclick=()=>e.style.display='none';$('#v7migrate').onclick=()=>migrate().catch(x=>setStatus(x.message,'error'));$('#v7verify').onclick=()=>verifyExisting().catch(x=>setStatus('Unlock failed. Check the passphrase or recovery key.','error'));$('#v7lock').onclick=lock;return e;
  }
  function install(){
    const sidebar=document.querySelector('.sidebar,.side,aside'); if(!sidebar)return setTimeout(install,1200);
    if($('#v7open'))return; const b=document.createElement('button');b.id='v7open';b.className='navitem';b.textContent='🔐 Security Vault';b.style.cssText='width:100%;text-align:left;margin-top:8px';b.onclick=()=>{modal().style.display='block'};sidebar.appendChild(b);
    ['pointerdown','keydown','scroll'].forEach(x=>addEventListener(x,touch,{passive:true}));addEventListener('beforeunload',lock);document.addEventListener('visibilitychange',()=>{if(document.hidden)touch()});
  }
  window.CJPVaultV7={open:()=>modal().style.display='block',lock,get unlocked(){return !!master}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
