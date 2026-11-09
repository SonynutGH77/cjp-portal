/* CJP Portal v5.5.2 - authoritative Macquarie account presets
   Creates/updates account identity mappings only. NO balances or transactions are invented.
   Safe/idempotent: can run before bank statements are imported.
*/
'use strict';
(function(){
  const PRESETS=[
    {accountNumber:'018939207',last4:'9207',name:'Macquarie Neale Home Loan ••••9207',type:'loan',propertyId:'p1',role:'home-loan'},
    {accountNumber:'018938993',last4:'8993',name:'Macquarie Salary & Bills ••••8993',type:'offset',propertyId:'p1',role:'salary-bills',loanLast4:'9207'},
    {accountNumber:'018939132',last4:'9132',name:'Macquarie Food/Fun/Fuel ••••9132',type:'offset',propertyId:'p1',role:'fff',loanLast4:'9207'},
    {accountNumber:'019172048',last4:'2048',name:'Macquarie Online Purchases ••••2048',type:'everyday',propertyId:'',role:'online-purchases'},
    {accountNumber:'018939124',last4:'9124',name:'Macquarie Collins Wharf Equity Split ••••9124',type:'loan',propertyId:'p2',securedPropertyId:'p1',purposePropertyId:'p2',role:'investment-equity-split'},
    {accountNumber:'000972793269',last4:'3269',name:'Macquarie SMSF Cash Management ••••3269',type:'smsf',propertyId:'p3',role:'smsf-cash'},
    {accountNumber:'000941433997',last4:'3997',name:'Macquarie SMSF Accelerator ••••3997',type:'smsf',propertyId:'p3',role:'smsf-accelerator'}
  ];
  const norm=v=>String(v||'').replace(/\D/g,'');
  function apply(){
    if(typeof S==='undefined'||!S?.settings)return;
    S.settings.bankAccounts ||= [];
    const A=S.settings.bankAccounts;
    const find=p=>A.find(a=>norm(a?.identifiers?.accountNumber)===p.accountNumber || a?.identifiers?.last4===p.last4 || (a.match||[]).some(m=>norm(m)===p.accountNumber||norm(m)===p.last4));
    // establish the home-loan id if known so both operational offsets point to it
    const homeProp=(S.properties||[]).find(p=>p.id==='p1');
    const homeLoan=homeProp?.loans?.find(l=>/home loan/i.test(l.name||'')&&!/equity/i.test(l.name||'')) || homeProp?.loans?.[0];
    let changed=0;
    for(const p of PRESETS){
      let a=find(p);
      if(!a){a={id:'ba'+Math.random().toString(36).slice(2,10),seen:[],match:[]};A.push(a);changed++}
      const before=JSON.stringify(a);
      Object.assign(a,{name:p.name,type:p.type,propertyId:p.propertyId,role:p.role});
      a.identifiers={...(a.identifiers||{}),accountNumber:p.accountNumber,last4:p.last4,bank:'macquarie'};
      a.match=[...new Set([...(a.match||[]),p.accountNumber,p.last4])];
      if(p.loanLast4&&homeLoan)a.loanId=homeLoan.id;
      if(p.securedPropertyId)a.securedPropertyId=p.securedPropertyId;
      if(p.purposePropertyId)a.purposePropertyId=p.purposePropertyId;
      if(JSON.stringify(a)!==before)changed++;
    }
    S.settings.moneyAccounts={
      salaryBills:'018938993',
      fff:'018939132',
      onlinePurchases:'019172048',
      updatedAt:new Date().toISOString()
    };
    S.settings.macquarieAccountPreset='2026-11-08-v1';
    if(changed&&typeof log==='function')log('Macquarie account mappings updated','Salary & Bills ••••8993; Food/Fun/Fuel ••••9132; Online Purchases ••••2048; Home Loan ••••9207; Collins equity split ••••9124; SMSF ••••3269/3997.',{actor:'system',status:'ok'});
    if(changed&&typeof save==='function')save();
  }
  window.CJPAccountPreset={apply,presets:PRESETS};
  // v5.5.2: keep trying until the portal data has loaded (e.g. after the encrypted vault is unlocked), instead of one attempt at 1.4s
  let tries=0;
  function boot(){
    if(typeof S!=='undefined'&&S?.settings){apply();return}
    if(++tries<80)setTimeout(boot,1500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1400));else setTimeout(boot,1400);
})();
