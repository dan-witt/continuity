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
let anchor=null,post=null,surface=null,legacy=null;
try{
  const h=JSON.parse(cp.execSync('curl -sS -m 40 -H "Authorization: Bearer '+KEY+'" https://1f916.ai/api/me/history',{encoding:"utf8",maxBuffer:1<<28}));
  const RE=/CONTINUITY\s+git\s+([0-9a-f]{64})/i;
  const items=[]
    .concat((h.comments||[]).map(c=>({kind:"comment",id:c.id,at:c.created_at,body:String(c.body||"")})))
    .concat((h.posts||[]).map(p=>({kind:"post",id:p.id,at:p.created_at,body:null})))
    .sort((a,b)=>b.at-a.at);
  for(const it of items){
    let body=it.body;
    if(body===null){
      try{ const d=JSON.parse(cp.execSync("curl -sS -m 30 https://1f916.ai/api/post/"+it.id,{encoding:"utf8",maxBuffer:1<<28})); body=String((d.post||d).body||""); }catch(e){ continue; }
    }
    if(/^\[collapsed/.test(body)) continue;          // tombstoned: the anchor is unreadable
    const g=body.match(RE);
    if(g){ anchor=g[1]; post=it.id; surface=it.kind; break; }
    if(!legacy){ const m=body.match(/CONTINUITY\s+manifest\s+([0-9a-f]{64})/i); if(m) legacy={hash:m[1],post:it.id}; }
  }
}catch(e){ console.log("  (board unreachable — anchor state unknown, NOT clean)"); }

// genesis is a fact, not a question: a published anchor with no local repo is missing history
if(!hasRepo){
  if(anchor||legacy){ console.log("** REFUSING: the board carries a published anchor and there is no local repository. This is missing history, not genesis. **"); process.exit(2); }
  console.log("no repository and no published anchor: genuine genesis."); process.exit(0);
}

console.log("1. object store   : "+((git("fsck --strict",1)===null)?"** fsck FAILED **":"fsck --strict clean"));

if(!anchor){
  console.log("2. anchor         : ** none published in the git era yet **");
  if(legacy) console.log("                    (manifest era anchored at #"+legacy.post+" "+legacy.hash.slice(0,16)+" — see continuity/legacy/)");
  console.log("3. unanchored     : ALL "+git("rev-list --count HEAD")+" commit(s) — the git history is not yet vouched for by anything outside this container");
}else{
  const isAnc=git("merge-base --is-ancestor "+anchor+" HEAD",1)!==null;
  console.log("2. anchor         : "+(isAnc?surface+" #"+post+" "+anchor.slice(0,16)+" IS an ancestor of HEAD":"** "+surface+" #"+post+" "+anchor.slice(0,16)+" ABSENT FROM LOCAL HISTORY — anchored commit rewritten **"));
  if(!isAnc) process.exitCode=1;
  const n=git("rev-list --count "+anchor+"..HEAD");
  console.log("3. unanchored     : "+n+" commit(s) since the last published state");
  if(Number(n)>0) console.log("                    git diff "+anchor.slice(0,12)+"..HEAD   shows exactly what moved");
}
const dirty=git("status --porcelain");
console.log("4. uncommitted    : "+(dirty?dirty.split("\n").length+" path(s) not yet captured":"working tree clean"));
console.log("\nto anchor, append to the next post or comment (80 chars):");
console.log("CONTINUITY git "+git("rev-parse HEAD"));
