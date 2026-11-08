/* CJP Portal v5.5 - Money Insights: Salary/Wages + FFF */
'use strict';
(function(){
 const $i=id=>document.getElementById(id), M=n=>typeof m0==='function'?m0(n):'$'+Math.round(n||0).toLocaleString('en-AU');
 const ym=d=>(d||'').slice(0,7), now=()=>new Date(), months=n=>{let a=[];let d=new Date();d.setDate(1);for(let i=0;i<n;i++){a.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));d.setMonth(d.getMonth()-1)}return a};
 const accountName=t=>{const a=(S.settings?.bankAccounts||[]).find(a=>a.id===t.bankAcc);return a?.name||''};
 const isFFF=t=>/\bfff\b|food.?fuel.?fun/i.test(accountName(t)+' '+(t.note||'')+' '+(t.desc||'')) && !/salary|wages|payroll/i.test(t.desc||'');
 const isSalary=t=>/salary|wages|payroll|salary and wages/i.test(accountName(t)+' '+(t.desc||''));
 const transfer=t=>/transfer|\btfr\b|from account|to account|osko/i.test(t.desc||'')||t.category==='Transfers';
 const fun=t=>/dining|entertainment|shopping|subscription/i.test(t.category||'');
 const food=t=>/grocer|food/i.test(t.category||'');
 const fuel=t=>/fuel|transport/i.test(t.category||'');
 function data(){
  const ms=months(12), tx=S.transactions||[];
  return ms.map(m=>{let all=tx.filter(t=>ym(t.date)===m),salary=all.filter(t=>t.amount>0&&isSalary(t)).reduce((a,t)=>a+t.amount,0),fff=all.filter(t=>isFFF(t)&&!transfer(t)),fund=all.filter(t=>isFFF(t)&&transfer(t)&&t.amount>0).reduce((a,t)=>a+t.amount,0);
   let out=-fff.filter(t=>t.amount<0).reduce((a,t)=>a+t.amount,0), fo=-fff.filter(t=>t.amount<0&&food(t)).reduce((a,t)=>a+t.amount,0), fu=-fff.filter(t=>t.amount<0&&fuel(t)).reduce((a,t)=>a+t.amount,0), fn=-fff.filter(t=>t.amount<0&&fun(t)).reduce((a,t)=>a+t.amount,0);
   let expenses=-all.filter(t=>t.amount<0&&!transfer(t)&&!isFFF(t)&&t.category!=='Mortgage & Loans').reduce((a,t)=>a+t.amount,0);
   return {m,salary,fund,out,food:fo,fuel:fu,fun:fn,other:Math.max(0,out-fo-fu-fn),expenses,saved:salary-expenses-out};
  }).reverse();
 }
 function render(){
  const h=$i('moneyInsightsBody');if(!h||!window.S)return;const D=data(),cur=D.at(-1)||{},last3=D.slice(-3),avg=k=>last3.length?last3.reduce((a,x)=>a+x[k],0)/last3.length:0;
  const target=+(S.settings.moneyInsights?.weeklyFFF||250), monthlyTarget=target*52/12, saveTarget=+(S.settings.moneyInsights?.monthlySavingTarget||0), spent=cur.out||0, pace=monthlyTarget?spent/monthlyTarget:0;
  const max=Math.max(1,...D.map(x=>Math.max(x.salary,x.expenses+x.out)));
  h.innerHTML=`<div class="grid k5"><div class="card kpi"><div class="lbl">FFF this month</div><div class="val ${pace>1?'red':pace>.85?'amber':'green'}">${M(spent)}</div><div class="hint">Target ${M(monthlyTarget)} · ${target?M(target)+'/wk':''}</div></div><div class="card kpi"><div class="lbl">3-month FFF average</div><div class="val">${M(avg('out'))}</div><div class="hint">${avg('out')>monthlyTarget?'Above':'Below'} target by ${M(Math.abs(avg('out')-monthlyTarget))}/mth</div></div><div class="card kpi"><div class="lbl">Income this month</div><div class="val green">${M(cur.salary)}</div><div class="hint">Salary/wages account</div></div><div class="card kpi"><div class="lbl">Available to save</div><div class="val ${cur.saved>=0?'green':'red'}">${M(cur.saved)}</div><div class="hint">Income − non-transfer expenses − FFF</div></div><div class="card kpi"><div class="lbl">Saving target</div><div class="val">${M(saveTarget)}</div><div class="hint">Gap ${M(Math.max(0,saveTarget-cur.saved))}</div></div></div>
  <div class="grid c2" style="margin-top:16px"><div class="card"><h2>FFF split this month</h2>${[['Food',cur.food,'#2ecc8f'],['Fuel',cur.fuel,'#f5b942'],['Fun',cur.fun,'#a78bfa'],['Other',cur.other,'#5b9dff']].map(([n,v,c])=>`<div style="margin:10px 0"><div class="row sp"><span>${n}</span><b>${M(v)}</b></div><div class="bar"><i style="background:${c};width:${spent?Math.min(100,v/spent*100):0}%"></i></div></div>`).join('')}<div class="note info">Transfers into FFF are funding, not spending. Only purchases out of the FFF account count here.</div></div>
  <div class="card"><h2>Savings opportunities</h2>${ideas(cur,avg('out'),monthlyTarget,saveTarget)}</div></div>
  <div class="card" style="margin-top:16px"><div class="row sp"><h2>12-month income vs spending</h2><div class="row"><label style="margin:0">FFF weekly target</label><input class="mini" type="number" value="${target}" onchange="MI.set('weeklyFFF',this.value)"><label style="margin:0">Save / month</label><input class="mini" type="number" value="${saveTarget}" onchange="MI.set('monthlySavingTarget',this.value)"></div></div>${D.map(x=>`<div style="display:grid;grid-template-columns:70px 1fr 95px;gap:8px;align-items:center;margin:7px 0"><span class="muted sm">${x.m}</span><div><div class="bar"><i style="background:var(--green);width:${x.salary/max*100}%"></i></div><div class="bar" style="margin-top:2px"><i style="background:var(--red);width:${(x.expenses+x.out)/max*100}%"></i></div></div><span class="num sm">${M(x.saved)}</span></div>`).join('')}<div class="legend"><span><i style="background:var(--green)"></i>Income</span><span><i style="background:var(--red)"></i>Spending</span><span>Right column = amount left</span></div></div>`;
 }
 function ideas(c,a,t,goal){let x=[];if(a>t&&t)x.push(`<b>FFF:</b> 3-month average is ${M(a-t)}/mth above your ${M(t)} target. Bringing it back to target frees about <b>${M((a-t)*12)}/yr</b>.`);if(c.fun>0)x.push(`<b>Fun:</b> ${M(c.fun)} this month. A 20% reduction would free ${M(c.fun*.2)}/mth.`);if(goal&&c.saved<goal)x.push(`<b>Savings goal:</b> another ${M(goal-c.saved)} is needed this month to hit the target.`);if(c.saved>0)x.push(`<b>Sweep:</b> current model leaves ${M(c.saved)} available. Keep this in the Neale offset rather than the everyday/FFF account once near-term bills are covered.`);return x.length?x.map(v=>`<div class="note info">${v}</div>`).join(''):'<div class="note info">Import FFF and Salary/Wages statements to generate personalised savings suggestions.</div>'}
 function inject(){const v=$i('v-spending');if(!v||$i('moneyInsights'))return;const first=v.querySelector('.grid.c2');if(!first)return;first.insertAdjacentHTML('beforebegin','<div id="moneyInsights" style="margin-bottom:16px"><div class="row sp"><h2>💡 Money insights</h2><span class="muted sm">FFF + Salary/Wages</span></div><div id="moneyInsightsBody"></div></div>');render()}
 window.MI={set(k,v){S.settings.moneyInsights||={};S.settings.moneyInsights[k]=+v||0;if(typeof save==='function')save();render()},render};
 const old=window.renderAll;if(typeof old==='function')window.renderAll=function(){const r=old.apply(this,arguments);inject();render();return r};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(inject,1000));else setTimeout(inject,1000);
})();
