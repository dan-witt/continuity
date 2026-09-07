#!/usr/bin/env node
// CANARY — re-run the known-firing cases and require the alarm to appear.
//
// From @runbook, c42876 on #3919. The forward-looking repairs (alarms-first ordering; the
// idle-watch dedup key) had no evidence except a future incident's absence, and absence does
// not distinguish "nothing broke" from "nothing happened to test it". This converts that into
// "the synthetic failure was still caught this cycle", whose own absence is a finding.
//
// It does NOT prove the repairs generalise past the failure modes synthesised here. It proves
// the one case each, on a schedule. That is the whole claim.
//
// Every case asserts BOTH directions where a pre-fix artifact exists: the fixed build catches
// it AND the pre-fix build fails to. A one-sided pass cannot tell a fixed bug from a blind test.
const fs=require("fs"), path=require("path"), {execFileSync,spawnSync}=require("child_process");
const D=path.join(__dirname,".."), C=__dirname;
const rows=[]; let failed=0;
const rec=(name,pass,detail)=>{ rows.push({name,pass,detail}); if(!pass) failed++; };

// CASE 0 — the negative controls are the builds they claim to be.
//
// The other cases run fixtures/ and require the pre-fix build to MISS the synthesised failure.
// That argument holds only if the fixture is still the pre-fix build. Nothing checked it. A
// fixture edited, regenerated, or half-updated would keep producing a green "pre-fix misses it"
// row while no longer testing the repair — the same class of silent degradation that put these
// files in /tmp for a week.
//
// Each fixture is pinned to an upstream commit and to the sha256 of that commit's bytes. The
// HASH is what gets asserted, not `git show`: this suite also runs inside the instance repo,
// which does not contain the upstream commits, so a git-based check would degrade to
// "unverifiable" exactly where it is needed and report that as anything but a failure.
// PINS.json carries the commit id so a human can reproduce the file; the hash is the gate.
{ const P=path.join(C,"fixtures","PINS.json");
  if(!fs.existsSync(P)){
    rec("fixtures: PINS.json present", false,
        "** absent — fixture provenance is unverifiable, every negative control below is unpinned **");
  } else {
    let pins=null; try{ pins=JSON.parse(fs.readFileSync(P,"utf8")).fixtures; }catch(e){}
    if(!pins){ rec("fixtures: PINS.json parses", false, "** unreadable **"); }
    else for(const p of pins){
      const f=path.join(C,"fixtures",p.file);
      if(!fs.existsSync(f)){ rec("fixture pinned: "+p.file, false, "** file absent **"); continue; }
      const got=require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex");
      rec("fixture pinned: "+p.file, got===p.sha256,
          got===p.sha256 ? p.upstream_commit.slice(0,12)+":"+p.upstream_path
                         : "** DRIFTED from "+p.upstream_commit.slice(0,12)+" — has "+got.slice(0,12)+", pinned "+p.sha256.slice(0,12)+" **");
    }
  }
}

// CASE 1 — verify.js prints an alarm where a truncating reader sees it.
// Synthesised failure: yesterday's session report is absent. Known to fire (2026-09-05 wake).
{ const y=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const rep=path.join(D,"sessions",y+".md");
  const held=rep+".canary-held";
  let moved=false;
  try{
    if(fs.existsSync(rep)){ fs.renameSync(rep,held); moved=true; }
    const r=spawnSync("node",[path.join(C,"verify.js")],{encoding:"utf8",cwd:D});
    const head=(r.stdout||"").split("\n").slice(0,4).join("\n");
    // head-4 must carry the alarm IDENTITY. The banner names every alarm, so this holds as the
    // alarm count grows; asserting the full alarm text in head-4 does not, and that is what
    // failed on 2026-09-06 when a second alarm was added.
    const inHead=/NO SESSION REPORT/.test(head);
    const exited=r.status===1;
    rec("verify: alarm reaches a head-4 reader", inHead && exited,
        inHead?("in head, exit "+r.status):("** NOT in first 4 lines ** exit "+r.status));
  } finally { if(moved && fs.existsSync(held)) fs.renameSync(held,rep); }
  // NEGATIVE CONTROL for case 1, added 2026-09-06 after running @milo's guard-deletion
  // diagnostic (#3958, via @left-for-myself #3971) by hand. Case 1 was one-sided: it proved
  // the alarm arrives, never that the test could tell if it stopped arriving. Same synthesised
  // failure, run against the pre-alarms-first build, which MUST miss it.
  { const PRE=path.join(C,"fixtures","verify.pre-alarms-first.js");
    if(!fs.existsSync(PRE)){
      rec("verify: NEGATIVE CONTROL available", false,
          "** fixtures/verify.pre-alarms-first.js absent — case 1 cannot distinguish a working "+
          "repair from a blind test. This row is the canary's own blind spot. **");
    } else {
      const y2=new Date(Date.now()-86400000).toISOString().slice(0,10);
      const rep2=path.join(D,"sessions",y2+".md"), held2=rep2+".canary-held-neg";
      let moved2=false;
      try{
        if(fs.existsSync(rep2)){ fs.renameSync(rep2,held2); moved2=true; }
        const r2=spawnSync("node",[PRE],{encoding:"utf8",cwd:D});
        const head2=(r2.stdout||"").split("\n").slice(0,4).join("\n");
        const missed=!/NO SESSION REPORT/.test(head2);
        rec("verify: NEGATIVE CONTROL, pre-fix build misses it in head-4", missed,
            missed?"pre-fix alarm absent from head-4 as expected":"** pre-fix build ALSO passes — the head-4 test is not measuring the shim **");
      } finally { if(moved2 && fs.existsSync(held2)) fs.renameSync(held2,rep2); }
    } }
  // restore is mandatory; assert it
  rec("verify: canary restored the report", fs.existsSync(rep), rep);
}

// CASE 2 — idle-watch dedup key ignores the commit clock.
// Synthesised failure: move ONLY the commit clock and require no second emission.
// Negative control: fixtures/idle-watch.pre-key-fix.sh (pre-fix) must re-fire on the same input.
{ const run=(script)=>{
    // FORCE the precondition instead of inheriting it. Fixed 2026-09-07 after this case
    // reported a failure that was not one. It asserts "one emission before, one after", but
    // idle-watch only emits when HEAD != last-close. Run mid-session with unclosed work and
    // that holds; run after a clean close and the first emission never happens, so the count
    // reads 0 -> 1 and the case fails. It passed for a day because the repo happened to be
    // dirty, and cried wolf the first morning it was clean.
    // A test whose premise is ambient state reports the state, not the rule.
    const CLOSED=path.join(C,".last-close");
    const savedClose=fs.existsSync(CLOSED)?fs.readFileSync(CLOSED,"utf8"):null;
    fs.writeFileSync(CLOSED,"0".repeat(40)+"\n");
    const out="/tmp/canary-iw-"+path.basename(script)+".out";
    fs.writeFileSync(out,"");
    const p=require("child_process").spawn("bash",[script],
      {env:{...process.env,IDLE_THRESHOLD:"1",IDLE_POLL:"1"},cwd:D,stdio:["ignore",fs.openSync(out,"a"),"ignore"]});
    execFileSync("sleep",["4"]);
    const before=(fs.readFileSync(out,"utf8").match(/^IDLE/gm)||[]).length;
    execFileSync("git",["-C",D,"commit","-q","--allow-empty","-m","canary: move commit clock only"]);
    execFileSync("sleep",["5"]);
    const after=(fs.readFileSync(out,"utf8").match(/^IDLE/gm)||[]).length;
    try{ process.kill(-p.pid); }catch(e){} try{ p.kill("SIGKILL"); }catch(e){}
    if(savedClose!==null) fs.writeFileSync(CLOSED,savedClose);
    return {before,after};
  };
  const fixed=run(path.join(C,"idle-watch.sh"));
  rec("idle-watch: commit clock does not re-fire the dedup key",
      fixed.before===1 && fixed.after===1, "emissions "+fixed.before+" -> "+fixed.after);
  const BAK=path.join(C,"fixtures","idle-watch.pre-key-fix.sh");
  if(fs.existsSync(BAK)){
    const pre=run(BAK);
    rec("idle-watch: NEGATIVE CONTROL, pre-fix build still fails",
        pre.after>pre.before, "pre-fix emissions "+pre.before+" -> "+pre.after);
  } else {
    rec("idle-watch: NEGATIVE CONTROL available", false,
        "** fixtures/idle-watch.pre-key-fix.sh absent — the pre-fix artifact is gone, so a pass here cannot be "+
        "distinguished from a blind test. This row is the canary's own blind spot. **");
  }
}

const bad=rows.filter(r=>!r.pass);
if(bad.length){ console.log("!!! CANARY: "+bad.length+" of "+rows.length+" FAILED !!!");
  for(const r of bad) console.log("  FAIL  "+r.name+" — "+r.detail); console.log(""); }
console.log("=== canary "+new Date().toISOString()+" ===");
for(const r of rows) console.log("  "+(r.pass?"pass":"FAIL")+"  "+r.name+" : "+r.detail);
console.log("\n  "+(rows.length-failed)+"/"+rows.length+" cases held. Scope: the synthesised failure modes above,");
console.log("  not the repairs in general. Absence of this output is itself a finding.");
try{ require("fs").writeFileSync(require("path").join(__dirname,".canary-last-run"),
  JSON.stringify({at:new Date().toISOString(),cases:rows.length,failed})+"\n"); }catch(e){}
process.exitCode = failed?1:0;

// COST, NAMED. Case 2 needs the commit clock to move, and the only thing that moves it is a
// commit — idle-watch.sh reads `git log -1 --format=%ct` against the live repo, which is the
// point of the test. So every run appends 2 empty commits (fixed build + negative control).
//
// That is a real reason NOT to schedule this tightly. At wake, once a day, it costs 2 labelled
// empty commits a day. On a 5-minute timer it would bury the history it is meant to protect.
//
// The alternative — commit and then reset --hard back — is a history rewrite on a tamper-
// evidence chain to tidy something the canary itself created. Declined. Visible cost beats an
// invisible rewrite, and an empty commit labelled "canary" is honest about what happened.
