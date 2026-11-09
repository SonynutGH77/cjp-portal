/* CJP Portal v7.0 Beta 2.1 - displayfix.js
   Makes every import / report screen show the SAME account name and masked number
   as the Money section, using the presets in accountpreset.js.
   - Display only: replaces raw PDF names + full account numbers with nickname + "Macquarie · ••••1234"
   - Auto-selects "Treat as" ONLY where it is still "— choose —" and the preset makes the answer obvious
   - Does not change balances, transactions or any saved data except that one dropdown (through the app's own change handler)
   Load this LAST in index.html (after the vault scripts).
*/
'use strict';
(function(){
  // Nicknames - identical to what the Money section shows
  const NICK={
    '9207':'Neale Home Loan',
    '8993':'Salary & Bills',
    '9132':'Food/Fun/Fuel',
    '2048':'Online Purchases',
    '9124':'Collins Wharf Equity Split',
    '3269':'SMSF Cash Management',
    '3997':'SMSF Accelerator'
  };
  // Only unambiguous auto-selections (applied only when the dropdown is still on "choose")
  const AUTO_TREAT={
    '9124':/^loan\s*·.*equity release/i
  };
  const stripZ=v=>String(v||'').replace(/\D/g,'').replace(/^0+/,'');
  function presets(){
    try{return (window.CJPAccountPreset&&window.CJPAccountPreset.presets)||[]}catch(e){return []}
  }
  function lookup(digits){
    const d=stripZ(digits);
    if(d.length<7)return null;
    for(const p of presets()){
      if(stripZ(p.accountNumber)===d)return p;
    }
    return null;
  }
  function nickFor(p){
    if(NICK[p.last4])return NICK[p.last4];
    return String(p.name||'').replace(/^Macquarie\s+/i,'').replace(/\s*••••\d{4}\s*$/,'').trim();
  }
  const NUM_RE=/\b(\d{8,12})\b/;
  const tries={};
  function autoTreat(row,last4){
    const rx=AUTO_TREAT[last4];
    if(!rx||!row)return;
    const sel=row.querySelector('select');
    if(!sel)return;
    const cur=sel.options[sel.selectedIndex];
    const isChoose=!sel.value||/^[—\-\s]*choose/i.test((cur&&cur.textContent)||'');
    if(!isChoose)return;                       // never override a choice you made
    tries[last4]=(tries[last4]||0)+1;
    if(tries[last4]>3)return;                  // safety: no loops
    const opt=Array.from(sel.options).find(o=>rx.test((o.textContent||'').trim()));
    if(!opt)return;
    sel.value=opt.value;
    sel.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function processNode(textNode){
    const txt=textNode.nodeValue;
    if(!txt||!NUM_RE.test(txt))return;
    const m=txt.match(NUM_RE);
    const p=lookup(m[1]);
    if(!p)return;
    const el=textNode.parentElement;
    if(!el||el.closest('script,style,textarea,input,select,option'))return;
    const row=el.closest('tr')||el.closest('li')||el.parentElement;
    // 1) auto-select treat-as (before we lose the number)
    autoTreat(row,p.last4);
    // 2) nickname on the line above the number (the bold name)
    const prev=el.previousElementSibling;
    if(prev&&!/\d{6,}/.test(prev.textContent||'')&&(prev.textContent||'').length<80){
      prev.textContent=nickFor(p);
    }
    // 3) masked number line, holder name removed
    textNode.nodeValue='Macquarie · ••••'+p.last4;
  }
  function scan(root){
    const w=document.createTreeWalker(root||document.body,NodeFilter.SHOW_TEXT,null);
    const list=[];
    while(w.nextNode())list.push(w.currentNode);
    list.forEach(processNode);
  }
  let pending=false;
  function schedule(){
    if(pending)return;
    pending=true;
    setTimeout(()=>{pending=false;try{scan(document.body)}catch(e){console.warn('displayfix',e)}},120);
  }
  function start(){
    schedule();
    new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,characterData:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  window.CJPDisplayFix={scan,nickFor,lookup};
})();
