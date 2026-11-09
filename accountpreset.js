/* CJP Portal v5.7 - authoritative account presets (Macquarie + the Arthurmac SMSF loan on The Canopy)
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
  // v5.6: loans with another lender. Kept in their own list so Macquarie-only logic (report matching, nicknames) never treats them as Macquarie.
  // The property is found from the loan itself (the loan whose account number is 500046385, else a property called "Canopy") - no property id is assumed.
  const LENDERS=[
    {accountNumber:'500046385',last4:'6385',name:'Arthurmac SMSF Loan ••••6385',type:'loan',propertyId:'',propertyMatch:/canopy/i,role:'smsf-loan',bank:'arthurmac',lender:'Arthurmac',fullMatchOnly:true}
  ];
  const norm=v=>String(v||'').replace(/\D/g,'');
  function apply(){
    if(typeof S==='undefined'||!S?.settings)return;
    S.settings.bankAccounts ||= [];
    const A=S.settings.bankAccounts;
    const loanByAcct=acct=>{for(const pr of (S.properties||[])){const l=(pr.loans||[]).find(x=>norm(x.acct)===acct);if(l)return {pr,l}}return null};
    const find=p=>A.find(a=>norm(a?.identifiers?.accountNumber)===p.accountNumber || a?.identifiers?.last4===p.last4 || (a.match||[]).some(m=>norm(m)===p.accountNumber||norm(m)===p.last4));
    // establish the home-loan id if known so both operational offsets point to it
    const homeProp=(S.properties||[]).find(p=>p.id==='p1');
    const homeLoan=homeProp?.loans?.find(l=>/home loan/i.test(l.name||'')&&!/equity/i.test(l.name||'')) || homeProp?.loans?.[0];
    let changed=0;
    for(const p of PRESETS.concat(LENDERS)){
      let a=find(p);
      if(!a){a={id:'ba'+Math.random().toString(36).slice(2,10),seen:[],match:[]};A.push(a);changed++}
      const before=JSON.stringify(a);
      let propertyId=p.propertyId, loanId=null;
      if(p.propertyMatch){
        const hit=loanByAcct(p.accountNumber);
        const pr=hit?.pr||(S.properties||[]).find(x=>p.propertyMatch.test(x.name||''));
        propertyId=pr?.id||'';
        const ln=hit?.l||pr?.loans?.find(l=>/smsf/i.test(l.name||''))||null;
        if(ln){ if(!norm(ln.acct))ln.acct=p.accountNumber; ln.lender=p.lender; loanId=ln.id; }
      }
      Object.assign(a,{name:p.name,type:p.type,propertyId,role:p.role});
      if(p.lender)a.lender=p.lender;
      if(loanId)a.loanId=loanId;
      a.identifiers={...(a.identifiers||{}),accountNumber:p.accountNumber,last4:p.last4,bank:p.bank||'macquarie'};
      a.match=[...new Set([...(a.match||[]),p.accountNumber,...(p.fullMatchOnly?[]:[p.last4])])];
      if(p.loanLast4&&homeLoan)a.loanId=homeLoan.id;
      // v5.7: tie each Macquarie LOAN account to its loan record (and write the account number on the record) so statements, reports and the Dashboard all agree.
      // The equity split's loan record sits on the property that SECURES it (8 Neale Street) even though the money was used for Collins Wharf.
      if(p.type==='loan'&&!p.propertyMatch){
        const sec=(S.properties||[]).find(x=>x.id===(p.securedPropertyId||p.propertyId));
        let ln=sec?.loans?.find(l=>norm(l.acct)===p.accountNumber)
          ||(p.role==='investment-equity-split'?sec?.loans?.find(l=>/equity|collins/i.test(l.name||'')&&!norm(l.acct)):null)
          ||(p.role==='home-loan'?homeLoan:null);
        if(ln){
          if(norm(ln.acct)!==p.accountNumber){ln.acct=p.accountNumber;changed++}
          if(p.role==='investment-equity-split'&&!ln.purposePropertyId&&p.purposePropertyId){ln.purposePropertyId=p.purposePropertyId;changed++}
          a.loanId=ln.id;
        }
      }
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
    S.settings.macquarieAccountPreset='2026-11-09-v3';
    if(changed&&typeof log==='function')log('Macquarie account mappings updated','Salary & Bills ••••8993; Food/Fun/Fuel ••••9132; Online Purchases ••••2048; Home Loan ••••9207; Collins equity split ••••9124; SMSF ••••3269/3997; Arthurmac SMSF loan ••••6385 (The Canopy).',{actor:'system',status:'ok'});
    if(changed&&typeof save==='function')save();
  }
  window.CJPAccountPreset={apply,presets:PRESETS,lenders:LENDERS};
  // v5.5.2: keep trying until the portal data has loaded (e.g. after the encrypted vault is unlocked), instead of one attempt at 1.4s
  let tries=0;
  function boot(){
    if(typeof S!=='undefined'&&S?.settings){apply();return}
    if(++tries<80)setTimeout(boot,1500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1400));else setTimeout(boot,1400);
})();
