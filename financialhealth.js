/* CJP Portal v6.4 - Financial Health
   v6.4 fixes (everything else is as in v6.1):
   1. DUPLICATE HEADINGS: inject() looked for an element called "fhPage", but the section it adds is called "v-health", so it never found it and added another
      Financial Health section on every redraw. It now checks for the right element, and removes any extra copies.
   2. MISSING INCOME IS NOT ZERO: when no income has been imported for the month, income, surplus and savings rate show a dash and say why. They no longer show your
      spending as a loss. (The page's own footnote already says missing information should stay missing.)
   3. SPENDING YOU CAN SEE INTO: "What's in this?" lists the largest payments counted this month, by category. A payment that is not everyday spending
      (a deposit, a one-off purchase) can be ticked "Not everyday spending" to leave it out of these figures. That tick is reversible and does NOT change the transaction,
      your Spending list, budgets or the tax pack.
   4. MONTH LABELS use your local date. The old code used UTC, which labelled the whole 12-month window one month early between midnight and about 10:30am in South Australia.
   5. Month-to-date is labelled as such, and the last full month is shown beside it.
   6. Other pages can now run after every redraw (FinancialHealth.after), which is what fixes the Collins "Prepare for" panel vanishing until Refresh. */
'use strict';
(function(){
  const $h=id=>document.getElementById(id);
  const A=n=>n==null||!isFinite(n)?'—':new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(n);
  const pc=n=>n==null?'—':(n*100).toFixed(1)+'%';
  const escH=s=>typeof esc==='function'?esc(s):String(s??'');
  const acct=role=>(S.settings?.bankAccounts||[]).find(a=>a.role===role);
  const bal=a=>{if(!a)return null;if(Number.isFinite(a.currentBalance))return a.currentBalance;if(Number.isFinite(a.lastBalance))return a.lastBalance;return null};
  const transfer=t=>t.category==='Transfers'||/\btransfer\b|\btfr\b|from account|to account|osko/i.test(t.desc||'');
  const ym=d=>(d||'').slice(0,7);
  const pad=n=>String(n).padStart(2,'0');
  const keyOf=d=>d.getFullYear()+'-'+pad(d.getMonth()+1);               // local month, not UTC
  const monthLabel=k=>{if(!/^\d{4}-\d{2}$/.test(k||''))return '';const [y,m]=k.split('-');return new Date(+y,+m-1,1).toLocaleDateString('en-AU',{month:'short',year:'2-digit'})};
  function months(n){const out=[],now=new Date();for(let i=n-1;i>=0;i--)out.push(keyOf(new Date(now.getFullYear(),now.getMonth()-i,1)));return out}

  /* Payments you have marked "Not everyday spending" (S.settings.healthExclude). They stay everywhere else in the portal. */
  const skipped=()=>S.settings?.healthExclude||{};
  const counted=t=>!transfer(t)&&!skipped()[t.id];
  function cash(){
    const R={};months(12).forEach(m=>R[m]={m,in:0,out:0,net:0,nIn:0,nOut:0});
    (S.transactions||[]).forEach(t=>{const r=R[ym(t.date)];if(!r||!counted(t))return;const v=+t.amount||0;if(v>0){r.in+=v;r.nIn++}else if(v<0){r.out-=v;r.nOut++}});
    Object.values(R).forEach(r=>{r.hasIn=r.nIn>0&&r.in>0;r.net=r.hasIn?r.in-r.out:null});   // no income recorded = surplus unknown, not a loss
    return Object.values(R)}
  function monthSpend(key){
    const byCat={};let total=0,count=0;
    (S.transactions||[]).forEach(t=>{if(ym(t.date)!==key||!counted(t))return;const v=+t.amount||0;if(v>=0)return;total-=v;count++;const c=t.category||'Other';byCat[c]=(byCat[c]||0)-v});
    return{total,count,byCat}}
  function propertyTotals(){let value=0,debt=0,equity=0;(S.properties||[]).filter(p=>!p.sold).forEach(p=>{value+=+p.value||0;const d=(p.loans||[]).reduce((a,l)=>a+(+l.balance||0),0);debt+=d;equity+=(+p.value||0)-d});return{value,debt,equity}}
  function mortgage(){const p=(S.properties||[]).find(p=>p.id==='p1'),h=(S.mortgage||[]).filter(x=>x.propertyId==='p1').sort((a,b)=>a.month.localeCompare(b.month)),r=h.at(-1)||{},loan=r.loan??p?.loans?.[0]?.balance??null;const offsets=['salary-bills','fff'].map(acct).map(bal).filter(Number.isFinite),off=offsets.length?offsets.reduce((a,b)=>a+b,0):(r.offset??null),net=loan!=null&&off!=null?loan-off:null;return{loan,off,net,row:r}}
  function gaps(){
    const g=[],accts=S.settings?.bankAccounts||[];
    ['salary-bills','fff','online-purchases','home-loan','investment-equity-split','smsf-cash','smsf-accelerator'].forEach(role=>{const a=accts.find(x=>x.role===role);if(!a)g.push({s:'high',t:`Account mapping missing: ${role}`});else if(!a.lastImport&&!a.lastTxDate)g.push({s:'medium',t:`No statement imported yet for ${a.name}`})});
    const cur=cash().at(-1);if(cur&&!cur.hasIn)g.push({s:'medium',t:`No income recorded for ${monthLabel(cur.m)}, so the monthly surplus can't be worked out`});
    const unc=(S.transactions||[]).filter(t=>!transfer(t)&&(!t.category||t.category==='Other'||t.category==='Unclassified')).length;if(unc)g.push({s:'medium',t:`${unc} transaction(s) need classification`});
    const ign=Object.values(S.documents||{}).filter(d=>d.status==='ignored').length;if(ign)g.push({s:'low',t:`${ign} ignored document(s) can be reviewed`});
    const pend=(window.Inbox?.items||[]).length;if(pend)g.push({s:'medium',t:`${pend} Agent Inbox item(s) awaiting approval`});
    (S.properties||[]).filter(p=>!p.sold).forEach(p=>{if(!p.value)g.push({s:'medium',t:`${p.name}: property value missing`});(p.loans||[]).forEach(l=>{if(!l.rate)g.push({s:'medium',t:`${p.name}: ${l.name} interest rate missing`})})});
    return g}
  function opportunities(C){
    const o=[],cur=C.at(-1)||{},prev=C.slice(-4,-1),avg=prev.reduce((a,x)=>a+x.out,0)/Math.max(1,prev.length),fff=acct('fff'),online=acct('online-purchases'),thisM=months(1)[0];
    const spent=id=>-(S.transactions||[]).filter(t=>t.bankAcc===id&&ym(t.date)===thisM&&t.amount<0&&counted(t)).reduce((a,t)=>a+t.amount,0);
    const fs=spent(fff?.id),os=spent(online?.id),target=+(S.settings?.moneyInsights?.weeklyFFF||250)*52/12;
    if(fs>target)o.push({n:'FFF',v:fs-target,text:`FFF is ${A(fs-target)} above the monthly equivalent of your weekly target.`});
    if(os>300)o.push({n:'Online purchases',v:os-300,text:`Online purchases are ${A(os-300)} above a ${A(300)} monthly reference ceiling.`});
    if(cur.out>avg&&avg)o.push({n:'Spending trend',v:cur.out-avg,text:`This month's spending so far is ${A(cur.out-avg)} above the prior 3-month average.`});
    const subs=(S.transactions||[]).filter(t=>ym(t.date)===thisM&&/subscription/i.test(t.category||'')&&t.amount<0&&counted(t)).reduce((a,t)=>a-t.amount,0);
    if(subs)o.push({n:'Subscriptions',v:subs*.2,text:`A 20% subscription reduction is ${A(subs*.2)}/month.`});
    return{o,total:o.reduce((a,x)=>a+x.v,0)}}
  function confidence(){const G=gaps(),pen=Math.min(55,G.filter(x=>x.s==='high').length*15+G.filter(x=>x.s==='medium').length*5+G.filter(x=>x.s==='low').length*2);return{score:Math.max(25,100-pen),G}}
  function health(C,P,M,O,D){const cur=C.at(-1)||{},rate=cur.hasIn?cur.net/cur.in:null;let score=50;if(cur.net>0)score+=15;if(rate!=null&&rate>=.2)score+=10;if(M.net!=null&&M.net>0)score+=10;if(O.total<Math.max(1,cur.in*.05))score+=5;if(D.score>=80)score+=10;score=Math.max(0,Math.min(100,score));return{score,label:score>=80?'Strong':score>=65?'Good':score>=50?'Watch':'Action required',rate}}
  function rates(M){const current=4.85,rises=5,latest=.25,effective='19 Nov 2026',cost=M.net!=null?M.net*latest/100/12:null;return{current,rises,latest,effective,cost,annual:cost!=null?cost*12:null}}

  const hooks=[];
  function render(){
    const host=$h('fhBody');if(!host||typeof S==='undefined'||!S)return;
    const C=cash(),P=propertyTotals(),M=mortgage(),O=opportunities(C),D=confidence(),H=health(C,P,M,O,D),R=rates(M),cur=C.at(-1)||{},prev=C.at(-2)||{};
    const lab=monthLabel(cur.m),plab=monthLabel(prev.m),surCls=cur.net==null?'':cur.net>=0?'m6-pos':'m6-neg';
    const noInc=cur.hasIn?'':`<div class="m6-note" style="color:#e4ac36">No income has been imported for ${escH(lab)}, so the surplus is shown as unknown instead of as a loss. Import your salary account statement to complete it.</div>`;
    host.innerHTML=`
 <div class="m6-kpis"><div class="m6-kpi"><div class="label">Financial position</div><div class="value ${H.score>=65?'m6-pos':H.score<50?'m6-neg':'m6-warn'}">${H.label}</div><div class="hint">Health indicator ${H.score}/100 · not a credit score</div></div><div class="m6-kpi"><div class="label">Net property equity</div><div class="value">${A(P.equity)}</div><div class="hint">${A(P.value)} property value</div></div><div class="m6-kpi"><div class="label">Monthly surplus</div><div class="value ${surCls}">${A(cur.net)}</div><div class="hint">${cur.hasIn?'Savings rate '+pc(H.rate):'No income recorded for '+escH(lab)}</div></div><div class="m6-kpi"><div class="label">Effective home debt</div><div class="value">${A(M.net)}</div><div class="hint">Loan ${A(M.loan)} · verified offsets ${A(M.off)}</div></div><div class="m6-kpi"><div class="label">Data confidence</div><div class="value ${D.score>=80?'m6-pos':'m6-warn'}">${D.score}%</div><div class="hint">${D.G.length} gap(s) identified</div></div></div>
 <div class="m6-grid"><div class="m6-card m6-span-7"><h2>Financial health</h2><div class="m6-account"><span>Income, ${escH(lab)} so far</span><b>${cur.hasIn?A(cur.in):'—'}</b></div><div class="m6-account"><span>Spending, ${escH(lab)} so far <button class="btn sm" style="margin-left:8px" onclick="FinancialHealth.explain()">What's in this?</button></span><b>${A(cur.out)}</b></div><div class="m6-account"><span>Monthly surplus</span><b class="${surCls}">${A(cur.net)}</b></div><div class="m6-account"><span>Last full month (${escH(plab)}): spending</span><b>${prev.nOut?A(prev.out):'—'}</b></div><div class="m6-account"><span>Last full month (${escH(plab)}): income</span><b>${prev.hasIn?A(prev.in):'—'}</b></div><div class="m6-account"><span>Property debt</span><b>${A(P.debt)}</b></div><div class="m6-account"><span>Property equity</span><b>${A(P.equity)}</b></div>${noInc}<div class="m6-note">Only statement/document-derived and portal-recorded data is used. Missing information remains missing rather than being treated as zero. Transfers between your accounts are not counted as spending.</div></div>
 <div class="m6-card m6-span-5"><h2>Rate environment</h2><div class="m6-account"><span>RBA cash rate</span><b>${R.current.toFixed(2)}%</b></div><div class="m6-account"><span>RBA rises in 2026</span><b>${R.rises}</b></div><div class="m6-account"><span>Latest movement</span><b>+${R.latest.toFixed(2)}%</b></div><div class="m6-account"><span>Macquarie effective</span><b>${R.effective}</b></div><div class="m6-account"><span>Indicative latest-rise impact</span><b class="m6-neg">${A(R.cost)}/mth</b></div><div class="m6-note">Indicative impact uses effective home debt × 0.25% ÷ 12. Actual impact is reconciled to Macquarie statements when available.</div></div>
 <div class="m6-card m6-span-7"><h2>Opportunities</h2>${O.o.length?O.o.map(x=>`<div class="m6-idea"><strong>${escH(x.n)} · ${A(x.v)}/month</strong>${escH(x.text)}</div>`).join(''):'<div class="m6-idea"><strong>No material spending opportunity calculated yet</strong>Import current Salary & Bills, FFF and Online Purchases statements to improve the analysis.</div>'}<div class="m6-account"><span>Potential extra saving</span><b class="m6-pos">${A(O.total)}/month</b></div><div class="m6-account"><span>Potential extra offset after 12 months</span><b>${A(O.total*12)}</b></div></div>
 <div class="m6-card m6-span-5"><h2>Gaps & actions</h2>${D.G.length?D.G.slice(0,10).map(g=>`<div class="m6-idea" style="border-left-color:${g.s==='high'?'#e34d59':g.s==='medium'?'#e4ac36':'#1183c7'}"><strong>${g.s==='high'?'Action required':g.s==='medium'?'Check':'Review'}</strong>${escH(g.t)}</div>`).join(''):'<div class="m6-idea"><strong>No material data gaps detected</strong>Continue the monthly statement workflow.</div>'}</div>
 </div>`;
    hooks.forEach(f=>{try{f()}catch(e){console.warn('FinancialHealth hook',e)}});     // e.g. the "Prepare for" panel: re-added after EVERY redraw
  }

  /* ---------- "What's in this month's spending?" ---------- */
  function explain(){
    if(typeof S==='undefined'||!S)return;
    const key=months(1)[0],lab=monthLabel(key),ms=monthSpend(key),sk=skipped();
    const rows=(S.transactions||[]).filter(t=>ym(t.date)===key&&!transfer(t)&&(+t.amount||0)<0).sort((a,b)=>a.amount-b.amount);
    const live=rows.filter(t=>!sk[t.id]),left=rows.filter(t=>sk[t.id]),top=live.slice(0,25),topSum=-top.reduce((a,t)=>a+t.amount,0),rest=ms.total-topSum;
    const row=(t,on)=>`<tr><td><input type="checkbox" ${on?'checked':''} onchange="FinancialHealth.skip('${escH(t.id)}',this.checked)" title="Not everyday spending"></td><td class="nowrap">${typeof fdate==='function'?fdate(t.date):escH(t.date)}</td><td>${escH(t.desc||'')}<div class="muted sm">${escH(t.category||'Other')}${t.source?' · '+escH(t.source):''}${-t.amount>=5000&&!on?' · <span class="amber">large payment: one-off?</span>':''}</div></td><td class="num"><b>${A(-t.amount)}</b></td></tr>`;
    const cats=Object.entries(ms.byCat).sort((a,b)=>b[1]-a[1]);
    modal(`<h2>What's in ${escH(lab)} spending so far</h2><p class="muted">${A(ms.total)} across ${ms.count} payment${ms.count===1?'':'s'} dated ${escH(lab)}, not counting transfers. Tick a payment that is <b>not everyday spending</b> (a deposit or one-off purchase) to leave it out of these Financial Health figures. Ticking does not change the transaction, your Spending list, budgets or the tax pack, and you can untick it later.</p>`+
      (cats.length?`<div style="margin:10px 0">${cats.slice(0,8).map(([c,v])=>`<div class="row sp" style="padding:4px 0;border-top:1px solid rgba(255,255,255,.1)"><span class="muted">${escH(c)}</span><span>${A(v)}</span></div>`).join('')}</div>`:'')+
      (rows.length?`<div style="overflow:auto;max-height:46vh"><table class="stack"><thead><tr><th></th><th>Date</th><th>Payment</th><th class="num">Amount</th></tr></thead><tbody>${top.map(t=>row(t,false)).join('')}${rest>0.5?`<tr><td></td><td></td><td class="muted">${live.length-top.length} smaller payments</td><td class="num">${A(rest)}</td></tr>`:''}${left.length?`<tr><td colspan="4" class="muted" style="padding-top:12px"><b>Left out of these figures (${left.length})</b></td></tr>${left.map(t=>row(t,true)).join('')}`:''}</tbody></table></div>`:'<div class="empty">No payments are dated this month.</div>')+
      `<div class="row end" style="margin-top:16px"><button class="btn" onclick="go('spending')">Open Spending</button><button class="btn primary" onclick="closeModal()">Close</button></div>`);
  }
  function skip(id,on){S.settings=S.settings||{};S.settings.healthExclude=S.settings.healthExclude||{};if(on)S.settings.healthExclude[id]=1;else delete S.settings.healthExclude[id];if(typeof log==='function')log(on?'Left out of Financial Health':'Counted in Financial Health again',id);if(typeof save==='function')save();explain()}

  /* ---------- page + nav ---------- */
  function inject(){
    const main=document.querySelector('main');if(!main)return;
    const all=document.querySelectorAll('#v-health');for(let i=1;i<all.length;i++)all[i].remove();             // duplicates left by v6.1
    if(!$h('v-health'))main.insertAdjacentHTML('beforeend','<section class="view money6" id="v-health"><header class="top"><div><h1>Financial Health</h1><div class="sub2">Overall position, risks, opportunities and data gaps</div></div><button class="btn" onclick="FinancialHealth.render()">↻ Refresh</button></header><div id="fhBody"></div></section>');
    const nav=$h('navList');if(nav&&!nav.querySelector('[data-view="health"]')){const d=document.createElement('div');d.innerHTML='<button data-view="health" onclick="go(\'health\')">❤ Financial Health</button>';nav.prepend(d.firstChild)}
  }
  const old=window.renderAll;
  if(typeof old==='function')window.renderAll=function(){const r=old.apply(this,arguments);inject();if(typeof view!=='undefined'&&view==='health')render();return r};
  window.FinancialHealth={render,explain,skip,cash,months,monthSpend,monthLabel,after:f=>{if(typeof f==='function'&&!hooks.includes(f))hooks.push(f)}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{inject();render()},1500));else setTimeout(()=>{inject();render()},1500);
})();
