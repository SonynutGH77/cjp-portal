/* Property Portal v7.0 Alpha 2 - Security Vault bootstrap */
(() => {
  'use strict';
  const ID='vaultv7';
  const findHost=()=>document.querySelector('nav .nav, nav, aside, .sidebar, .side');
  function openVault(){
    const old=document.getElementById('v7modal'); if(old){old.style.display='flex';return;}
    const wrap=document.createElement('div'); wrap.id='v7modal';
    wrap.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(3,7,18,.88);display:flex;align-items:flex-start;justify-content:center;padding:28px;overflow:auto';
    const card=document.createElement('section'); card.style.cssText='width:min(720px,100%);margin-top:5vh;background:#151c2e;color:#eef3ff;border:1px solid #33415f;border-radius:20px;padding:24px;box-shadow:0 32px 80px #0008';
    const title=document.createElement('h2'); title.textContent='Security Vault'; title.style.margin='0 0 8px';
    const p=document.createElement('p'); p.textContent='V7 Alpha 2 is loaded. The encrypted-vault migration remains non-destructive and will not delete the current portal data.'; p.style.color='#aab7d1';
    const state=document.createElement('div'); state.style.cssText='padding:14px;border-radius:12px;background:#0d1424;border:1px solid #293854;margin:16px 0'; state.textContent='Status: Security Vault module loaded successfully.';
    const note=document.createElement('p'); note.textContent='Do not remove portal-data.json or existing backups yet. The next step is to validate encrypted writes after the existing save failure is resolved.'; note.style.color='#f4c46e';
    const close=document.createElement('button'); close.className='btn primary'; close.textContent='Close'; close.onclick=()=>wrap.style.display='none';
    card.append(title,p,state,note,close); wrap.append(card); document.body.append(wrap);
  }
  function install(){
    if(document.getElementById('v7open')) return true;
    const host=findHost(); if(!host) return false;
    const b=document.createElement('button'); b.id='v7open'; b.type='button'; b.className='sub'; b.style.cssText='width:100%;text-align:left;margin-top:8px;color:#bfcaf0'; b.textContent='🔐 Security Vault'; b.addEventListener('click',openVault);
    host.appendChild(b); window.CJPVaultV7={open:openVault,loaded:true,version:'7.0-alpha2'}; return true;
  }
  let tries=0; const t=setInterval(()=>{if(install()||++tries>30)clearInterval(t)},500);
  if(document.readyState!=='loading') install(); else document.addEventListener('DOMContentLoaded',install,{once:true});
})();
