/* CJP Portal v5.4.2 - one-time account mapping/data repair
   Repairs erroneous classification of Macquarie 018939207 as an offset.
   Idempotent: records migration flag and will not run twice.
*/
'use strict';
(function(){
  const FLAG='mappingRepair_20261107_9207';
  function run(){
    if(typeof S==='undefined'||!S?.settings||S.settings[FLAG]) return;
    const accounts=S.settings.bankAccounts||[];
    const a9207=accounts.find(a=>a?.identifiers?.accountNumber==='018939207'||a?.identifiers?.last4==='9207'||(a.match||[]).includes('018939207'));
    if(!a9207) return;

    // 018939207 is the Macquarie Offset Home Loan itself, not an offset deposit account.
    a9207.name='Macquarie Neale Home Loan ••••9207';
    a9207.type='loan';
    a9207.propertyId='p1';
    a9207.loanId='2vey1cm5';
    a9207.identifiers={...(a9207.identifiers||{}),accountNumber:'018939207',last4:'9207',bank:'macquarie',product:'offset home loan'};

    // Convert only rows created by the bad 9207 import. Leave migrated/Rapid Repay history untouched.
    (S.mortgage||[]).forEach(r=>{
      if(r.propertyId==='p1' && /Bank · Macquarie Neale Street/i.test(r.source||'') && r.loan==null && typeof r.offset==='number' && r.offset<0){
        r.loan=Math.abs(r.offset);
        r.offset=null;
        r.net=null; // no genuine offset statement for this month yet
        r.quality='Bank loan only';
        r.source='Bank · Macquarie Neale Home Loan ••••9207';
      }
    });

    // Preserve the Collins split as its own analytic series, but explicitly record security vs purpose.
    const a9124=accounts.find(a=>a?.identifiers?.accountNumber==='018939124'||a?.identifiers?.last4==='9124'||(a.match||[]).includes('018939124'));
    if(a9124){
      a9124.name='Macquarie Collins Wharf Equity Split ••••9124';
      a9124.type='loan';
      a9124.propertyId='p2'; // analytic/tax purpose series remains Collins Wharf
      a9124.identifiers={...(a9124.identifiers||{}),accountNumber:'018939124',last4:'9124',bank:'macquarie',product:'offset home loan'};
      a9124.securedPropertyId='p1';
      a9124.purposePropertyId='p2';
    }

    // Confirm the two SMSF cash accounts without changing their transactions.
    const a3269=accounts.find(a=>a?.identifiers?.last4==='3269');
    if(a3269){a3269.type='smsf';a3269.propertyId='p3';a3269.identifiers={...(a3269.identifiers||{}),accountNumber:'000972793269',last4:'3269',bank:'macquarie',product:'cash management account'}}
    const a3997=accounts.find(a=>a?.identifiers?.last4==='3997');
    if(a3997){a3997.type='smsf';a3997.propertyId='p3';a3997.identifiers={...(a3997.identifiers||{}),accountNumber:'000941433997',last4:'3997',bank:'macquarie',product:'cash management accelerator account'}}

    // Remember linked offset account numbers discovered on the 9207 loan statement.
    S.settings.bankAccountHints={...(S.settings.bankAccountHints||{}),
      '018939132':{last4:'9132',type:'offset',propertyId:'p1',loanId:'2vey1cm5',name:'Macquarie Neale Offset ••••9132',status:'awaiting first statement'},
      '018938993':{last4:'8993',type:'offset',propertyId:'p1',loanId:'2vey1cm5',name:'Macquarie Neale Offset / repayment ••••8993',status:'awaiting first statement'}
    };

    S.settings[FLAG]={at:new Date().toISOString(),note:'Corrected 9207 loan-vs-offset mapping; verified 3269/3997 SMSF mappings; annotated 9124 security/purpose; registered linked offset hints 9132/8993.'};
    if(typeof log==='function') log('Account mapping repaired','9207 classified as Neale Home Loan; invalid negative offsets converted to loan-only history; 9124 annotated as Collins Wharf purpose secured by Neale; 3269/3997 verified.',{actor:'system',status:'ok'});
    if(typeof save==='function') save();
    setTimeout(()=>{try{if(typeof renderAll==='function')renderAll()}catch(e){}},250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(run,1200));else setTimeout(run,1200);
  window.CJPMappingRepair={run};
})();
