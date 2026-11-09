/* CJP Portal v6.4 - Financial Health "Prepare for" + the Collins Wharf settlement card on the property page
   v6.4 changes:
   1. The Collins Wharf settlement planner summary now lives on the COLLINS WHARF PROPERTY PAGE, under the figures at the top, and stays there until the property is
      marked settled (Edit > "Settled?" = Yes). It is drawn every time the page is drawn, so it no longer depends on pressing Refresh.
   2. It has been taken off the Financial Health page. That panel was only added once and was wiped by the next redraw, which is why it appeared only after Refresh.
      The Financial Health "Prepare for" panel (budget and interest-rate items) is now re-added after every redraw.
   3. Budget utilisation compares like with like: spending in categories that HAVE a budget against the total of those budgets. v6.3 compared all spending against the
      budgets, so a single large payment in a category with no budget showed as thousands of percent. Spending in categories without a budget is shown separately.
   4. Month is your local month, and the spending figure is the same one the Financial Health page uses (transfers and payments you left out are not counted). */
'use strict';
(function(){
  const E=s=>typeof esc==='function'?esc(s):String(s??'');
  const A=n=>n==null||!isFinite(n)?'—':new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(n);
  const Q=id=>document.getElementById(id);
  const FH=()=>window.FinancialHealth;

  /* same inputs and defaults as the Collins planner summary used before */
  function settlement(p){
    const c=S.settings?.collinsPlanner||{};p=p||(S.properties||[]).find(x=>x.id==='p2')||{};
    const price=+c.purchasePrice||+p.purchase||672000,dep=+c.depositPaid||+p.deposit||76000,loan=+c.settlementLoan||537600;
    const cost=(+c.stampDuty||0)+(+c.legalSettlement||0)+(+c.settlementAdjustments||0)+(+c.otherSettlement||0),need=Math.max(0,price-dep-loan)+cost,missing=[];
    if(!c.loanRate)missing.push('final investment loan rate');
    if(!c.ownersCorpAnnual)missing.push('owners corporation budget');
    if(!c.insuranceAnnual)missing.push('landlord insurance');
    if(!c.settlementAdjustments)missing.push('settlement adjustments');
    return{price,dep,loan,cost,need,missing}}

  /* ---------- Collins Wharf settlement card (property page) ---------- */
  const isCollinsUnsettled=p=>!!p&&!p.sold&&!!p.unsettled&&(p.id==='p2'||/collins/i.test(p.name||''));
  function dateLine(p){
    const sd=p.purchaseDate,d=sd&&typeof days==='function'?days(sd):null;
    if(!sd)return 'No settlement date is set. Add one under Edit (Purchase / settlement date).';
    const f=typeof fdate==='function'?fdate(sd):sd;
    if(d>0)return `Settlement date ${E(f)} · in ${d} day${d===1?'':'s'}`;
    if(d===0)return `Settlement date ${E(f)} · today`;
    return `Settlement date ${E(f)} has passed. When it settles, set "Settled?" to Yes under Edit and this card will go away.`}
  function collinsCard(p){
    const s=settlement(p);
    const tile=(l,v,h)=>`<div style="border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px 14px;background:rgba(255,255,255,.04)"><div class="muted sm">${l}</div><div style="font-size:22px;font-weight:700;margin-top:2px">${v}</div><div class="muted sm" style="margin-top:2px">${h||'&nbsp;'}</div></div>`;
    return `<div class="card" id="collinsCard" style="margin-top:16px;background:rgba(9,13,28,.94);border:1px solid rgba(255,255,255,.14);border-left:4px solid #e34d59;color:#e8ecf7">`+
      `<div class="row sp" style="flex-wrap:wrap;gap:10px"><div><h2 style="margin:0">Settlement planner</h2><div class="muted sm">${E(p.name)} · shown here until the property is marked settled</div></div><button class="btn primary" onclick="go('collins-plan')">Open Collins planner</button></div>`+
      `<div class="muted sm" style="margin:10px 0">${dateLine(p)}</div>`+
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">${tile('Purchase price',A(s.price),'')}${tile('Deposit paid',A(s.dep),'')}${tile('Settlement loan',A(s.loan),'')}${tile('Still to fund',A(s.need),s.cost?'including your entered settlement costs':'before any missing final costs')}</div>`+
      `<h3 style="margin:16px 0 6px">Priority actions</h3>`+
      (s.missing.length?s.missing.map((x,i)=>`<div class="row sp" style="padding:7px 0;border-top:1px solid rgba(255,255,255,.1)"><span>${i+1}. Confirm ${E(x)}</span><b class="amber">Missing</b></div>`).join('')+`<div class="muted sm" style="margin-top:6px">${s.missing.length} input${s.missing.length===1?'':'s'} still need verification. Enter them in the Collins planner.</div>`:'<div class="note info">Every planner input is filled in.</div>')+`</div>`}
  function paintCollins(){
    const page=Q('propPage');if(!page||typeof S==='undefined'||!S)return;
    const old=Q('collinsCard');if(old)old.remove();
    const p=typeof prop==='function'&&typeof curProp!=='undefined'?prop(curProp):null;if(!isCollinsUnsettled(p))return;
    const k=page.querySelector('.grid.k6'),html=collinsCard(p);
    if(k)k.insertAdjacentHTML('afterend',html);else page.insertAdjacentHTML('beforeend',html)}
  try{const o=renderPropPage;renderPropPage=function(){const r=o.apply(this,arguments);try{paintCollins()}catch(e){console.warn('healthhome collins card',e)}return r}}catch(e){console.warn('healthhome: renderPropPage',e)}

  /* ---------- Financial Health: "Prepare for" ---------- */
  function budgetItem(){
    const F=FH(),key=F.months(1)[0],MS=F.monthSpend(key),lab=F.monthLabel(key),budgets=S.budgets||{};
    const cats=Object.keys(budgets).filter(c=>+budgets[c]>0),total=cats.reduce((a,c)=>a+(+budgets[c]),0);
    if(!total)return{level:'low',title:'Monthly budget utilisation',detail:'No category budgets are set. Set them on the Spending page to track how much you have used.',go:'spending'};
    const inB=cats.reduce((a,c)=>a+(MS.byCat[c]||0),0),outside=MS.total-inB,pct=inB/total;
    return{level:pct>1?'high':pct>.85?'medium':'low',title:'Monthly budget utilisation',go:'spending',
      detail:`${A(inB)} spent of ${A(total)} budget (${Math.round(pct*100)}%) in budgeted categories so far in ${lab}.`+(outside>0.5?` A further ${A(outside)} is in categories with no budget.`:'')}}
  function prep(){
    const h=Q('fhBody');if(!h||Q('fhPrepare')||typeof S==='undefined'||!S||!FH())return;
    const items=[budgetItem(),{level:'medium',title:'Interest-rate exposure',detail:'Use actual Macquarie loan rates and statements to reconcile the cost of rate changes.',go:'mortgage'}];
    h.insertAdjacentHTML('afterbegin',`<div class="m6-grid" id="fhPrepare" style="margin-bottom:16px"><div class="m6-card" style="grid-column:1/-1"><h2>Prepare for</h2>${items.map(x=>`<div class="m6-idea" style="border-left-color:${x.level==='high'?'#e34d59':x.level==='medium'?'#e4ac36':'#20a879'};cursor:pointer" onclick="go('${x.go}')"><strong>${E(x.title)} · ${x.level.toUpperCase()}</strong>${E(x.detail)}</div>`).join('')}</div></div>`)}
  function defaultHome(){if(sessionStorage.getItem('cjp.health.opened'))return;const gate=Q('gate');if(gate&&getComputedStyle(gate).display!=='none')return setTimeout(defaultHome,700);sessionStorage.setItem('cjp.health.opened','1');try{if(typeof go==='function')go('health')}catch(e){}}
  if(FH()&&FH().after)FH().after(prep);                       // runs after EVERY Financial Health redraw, so it can no longer disappear
  function boot(){prep();setTimeout(defaultHome,900)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,2100));else setTimeout(boot,2100);
  window.CollinsSettlement={settlement,isCollinsUnsettled};
})();
