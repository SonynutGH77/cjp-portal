/* Property Portal - plannerguard.js (v7.0 Alpha 4.1)
   Stops the Collins Settlement planner's saved settings from nesting inside themselves.
   Symptom it fixes: "Save failed: Maximum call stack size exceeded" with the cause at
   S.settings.collinsPlanner.scenario x thousands of levels.

   What it does
   - Every 300 ms (and when the tab becomes visible) it looks at each object directly under S.settings.
     If its "scenario" value is an object (a copy of the settings stored inside themselves) it follows
     that chain with a loop (no recursion), keeps the TOP level (the most recent inputs), and replaces
     the nested copy with the innermost scenario name if there is one, otherwise removes it.
   - It never wraps saveData(), never replaces JSON.stringify, and never touches any other data.
   - It only asks for a save when it removed a real pile-up (3+ levels), at most once a minute, so a
     planner that nests again by one level on each redraw cannot cause a save loop. */
(() => {
  'use strict';
  const KEY = 'scenario', SAVE_AFTER_LEVELS = 3, SAVE_GAP_MS = 60000, LOOP_CAP = 2000000;
  let lastSave = 0, totalRepairs = 0, lastRepair = null;

  const data = () => { try { return typeof S !== 'undefined' ? S : null; } catch (e) { return null; } };

  // Iterative. Returns how many nested copies were removed.
  function flatten(holder) {
    let depth = 0, node = holder;
    while (node && typeof node[KEY] === 'object' && node[KEY] !== null && depth < LOOP_CAP) { node = node[KEY]; depth++; }
    if (!depth) return 0;
    const inner = typeof node[KEY] === 'string' ? node[KEY] : undefined;   // the last real scenario name, if any
    if (inner !== undefined) holder[KEY] = inner; else delete holder[KEY];
    return depth;
  }

  function check() {
    const d = data(); if (!d || !d.settings || typeof d.settings !== 'object') return 0;
    let worst = 0; const keys = [];
    for (const k of Object.keys(d.settings)) {
      let v; try { v = d.settings[k]; } catch (e) { continue; }
      if (v && typeof v === 'object' && !Array.isArray(v) && v[KEY] && typeof v[KEY] === 'object') {
        const n = flatten(v); if (n) { keys.push(k); if (n > worst) worst = n; }
      }
    }
    if (!worst) return 0;
    totalRepairs++; lastRepair = { at: new Date().toISOString(), levels: worst, keys };
    if (worst >= SAVE_AFTER_LEVELS) {
      try { if (typeof log === 'function') log('Data repaired', 'Removed ' + worst + ' nested copies from ' + keys.map(k => 'settings.' + k).join(', ') + ' (it stopped saving)', { actor: 'portal', status: 'warn' }); } catch (e) { }
      try { if (typeof toast === 'function') toast('Planner settings repaired. Saving\u2026'); } catch (e) { }
      if (Date.now() - lastSave > SAVE_GAP_MS) { lastSave = Date.now(); try { if (typeof save === 'function') save(); } catch (e) { } }
    }
    return worst;
  }

  const api = { check, flatten, get repairs() { return totalRepairs; }, get last() { return lastRepair; } };
  if (typeof window !== 'undefined') window.PlannerGuard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof setInterval === 'function') setInterval(() => { try { check(); } catch (e) { } }, 300);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) { try { check(); } catch (e) { } } });
})();
