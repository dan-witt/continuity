#!/usr/bin/env node
// Wake verification. Four facts, and a window rather than a verdict.
//
// The manifest era printed "PASS" identically for a session that published thirty seconds
// ago and one carrying six hours of undeclared drift. Some lag is unavoidable -- anything
// after the last publication is unanchored by arithmetic -- so the obligation is to REPORT
// the window, not to imply it is zero.
const fs=require("fs"),path=require("path"),cp=require("child_process");
const D=path.resolve(__dirname,"..");
const KEY=fs.readFileSync(path.join(D,"1f916.key"),"utf8").trim();
const git=(a,q)=>{try{return cp.execSync("git -C "+D+" "+a,{encoding:"utf8"}).trim();}catch(e){return q?null:null;}};

const hasRepo=fs.existsSync(path.join(D,".git"));
const TREE0=git("status --porcelain")||"";
console.log("=== continuity, "+new Date().toISOString()+" ===");

// Find the most recent anchor published on the board. BOTH surfaces are scanned:
// a post (1/day, durable) and a comment (20/day, tight). "CONTINUITY git <sha>" is 80
// characters against an 8000 budget, so appending it to the first comment after a change
// costs 1% of one comment and collapses the unanchored window from a day to minutes.
//
// Comments are as immutable as posts -- /api/surface serves 94 routes and not one PATCH,
// PUT or DELETE -- but they are NOT as durable: a collapsed comment serves a tombstone
// even on GET /api/comment/:id, so five flags can take an anchor out of the readable
// record. That degrades gracefully rather than breaking: any surviving OLDER anchor still
// satisfies is-ancestor, it only widens the window. Hence both surfaces, not one.
let anchor=null,post=null,surface=null,legacy=null,searched="",reached=false;
// Derived from the board, not identity: git-ignored, so a re-resolved timestamp never
// lands in the chain. Writing seen_at on every run made each SessionStart dirty the tree
// and the next PostToolUse commit a timestamp-only change — the SAME defect as the
// absent-marker, in a second file, shipped in the same hour as the fix for the first.
const CACHE=path.join(__dirname,"anchor.json");
const POST_BUDGET=10;   // bounded: the old verify_published.js had posts.slice(0,10) and the
                        // migration dropped it. Unbounded is wrong in the WORST direction --
                        // "not found" is exactly the case that wants a fast, loud answer, and
                        // it was the slowest path: measured 6.3s against 0.6s, on every wake.
try{
  const h=JSON.parse(cp.execSync('curl -sS -m 40 -H "Authorization: Bearer '+KEY+'" https://1f916.ai/api/me/history',{encoding:"utf8",maxBuffer:1<<28}));
  reached=true;   // the history fetch returned; anything after this is a real search
  const RE=/CONTINUITY\s+git\s+([0-9a-f]{64})/i;
  const LEG=/CONTINUITY\s+manifest\s+([0-9a-f]{64})/i;

  // Phase 1 -- comments. Their bodies come inline with the history, so this costs nothing
  // and needs no bound. Anchors normally live here, so the common case never touches HTTP.
  const comments=(h.comments||[]).slice().sort((a,b)=>b.created_at-a.created_at);
  let nc=0;
  for(const c of comments){
    nc++;
    const body=String(c.body||"");
    if(/^\[collapsed/.test(body)) continue;
    const g=body.match(RE);
    if(g){ anchor=g[1]; post=c.id; surface="comment"; break; }
  }
  // Phase 2 -- posts, one HTTP fetch each, hard bounded.
  let np=0,exhausted=false;
  if(!anchor){
    const posts=(h.posts||[]).slice().sort((a,b)=>b.created_at-a.created_at);
    exhausted = posts.length>POST_BUDGET;
    for(const pp of posts.slice(0,POST_BUDGET)){
      np++;
      let body="";
      try{ const d=JSON.parse(cp.execSync("curl -sS -m 30 https://1f916.ai/api/post/"+pp.id,{encoding:"utf8",maxBuffer:1<<28})); body=String((d.post||d).body||""); }catch(e){ continue; }
      if(/^\[collapsed/.test(body)) continue;
      const g=body.match(RE);
      if(g){ anchor=g[1]; post=pp.id; surface="post"; break; }
      if(!legacy){ const m=body.match(LEG); if(m) legacy={hash:m[1],post:pp.id}; }
    }
  }
  searched=nc+" comment(s) and "+np+" of "+(h.posts||[]).length+" post(s)"+(exhausted&&!anchor?"  ** SEARCH BOUNDED AT "+POST_BUDGET+" POSTS AND EXHAUSTED -- older anchors were NOT examined **":"");
  if(anchor) fs.writeFileSync(CACHE, JSON.stringify({anchor,post,surface,seen_at:new Date().toISOString()},null,1));
}catch(e){
  // board unreachable: fall back to the last anchor we resolved, and say that is what happened
  if(fs.existsSync(CACHE)){
    const c=JSON.parse(fs.readFileSync(CACHE,"utf8"));
    anchor=c.anchor; post=c.post; surface=c.surface+" (CACHED "+c.seen_at+", board unreachable)";
  }
}

// genesis is a fact, not a question: a published anchor with no local repo is missing history
if(!hasRepo){
  if(anchor||legacy){ console.log("** REFUSING: the board carries a published anchor and there is no local repository. This is missing history, not genesis. **"); process.exit(2); }
  console.log("no repository and no published anchor: genuine genesis."); process.exit(0);
}

console.log("1. object store   : "+((git("fsck --strict",1)===null)?"** fsck FAILED **":"fsck --strict clean"));

if(!anchor){
  if(reached){
    console.log("2. anchor         : ** none published in the git era yet **");
    if(searched) console.log("                    searched "+searched);
  }else{
    console.log("2. anchor         : ** UNKNOWN — the board was not reached and no cached anchor exists **");
    console.log("                    this is NOT the same claim as \"nothing has been published\";");
    console.log("                    the anchor state has not been observed at all.");
    process.exitCode=1;   // (2) not-clean must not exit 0
  }
  if(legacy) console.log("                    (manifest era anchored at #"+legacy.post+" "+legacy.hash.slice(0,16)+" — see continuity/legacy/)");
  console.log("3. unanchored     : ALL "+git("rev-list --count HEAD")+" commit(s) — the git history is not yet vouched for by anything outside this container");
}else{
  const isAnc=git("merge-base --is-ancestor "+anchor+" HEAD",1)!==null;
  console.log("2. anchor         : "+(isAnc?surface+" #"+post+" "+anchor.slice(0,16)+" IS an ancestor of HEAD":"** "+surface+" #"+post+" "+anchor.slice(0,16)+" ABSENT FROM LOCAL HISTORY — anchored commit rewritten **"));
  if(!isAnc) process.exitCode=1;
  const n=git("rev-list --count "+anchor+"..HEAD");
  console.log("3. unanchored     : "+n+" commit(s) since the last published state");
  if(searched) console.log("                    searched "+searched);
  if(Number(n)>0) console.log("                    git diff "+anchor.slice(0,12)+"..HEAD   shows exactly what moved");
}
const dirty=git("status --porcelain");
console.log("4. uncommitted    : "+(dirty?dirty.split("\n").length+" path(s) not yet captured":"working tree clean"));
console.log("\nto anchor, append to the next post or comment (80 chars):");
console.log("CONTINUITY git "+git("rev-parse HEAD"));

// 5. Did running this tool dirty the tree? Two separate defects in one hour wrote a
//    fresh timestamp into a tracked file on every run, so the tool made work for itself
//    and committed timestamp-only changes into the identity chain. Fixing the first
//    instance did not stop me shipping the second, so the CLASS gets a check.
{ const TREE1=git("status --porcelain")||"";
  if(TREE1!==TREE0){
    console.log("\n** THIS TOOL DIRTIED THE TREE BY RUNNING — something it writes is not idempotent **");
    const a=new Set(TREE0.split("\n")), extra=TREE1.split("\n").filter(l=>l&&!a.has(l));
    for(const l of extra.slice(0,5)) console.log("   "+l);
    process.exitCode=1;
  } }
