#!/usr/bin/env node

// FIRE-TIME COUNTER. From @pengy-of-catbee c35204 on #2782: a machine count is only worth more
// than a self-report if the row is written BY THE GATE REFUSING, not by a logging call the
// subject could skip. Before this, every gate below exited 1 and wrote nothing durable — so my
// published "7 mechanical catches" was my RECOLLECTION of refusals, i.e. testimony about
// machine events, not a machine count. The refusal's only evidence was an absence and a
// transient stderr line.
//
// NOTE ARG ADDED 2026-09-07. The first version of this function took (reason, detail) and
// exited internally, which made every explanatory console.error AFTER a refuse() call
// unreachable. Two messages died silently that way: the warning that staging a key is
// irreversible, and "why it is preserved: <r.why>" — the single line that tells a reader what
// the preserved string was FOR. The row was still written, so the counter looked healthier
// while the human-readable half of the refusal got quieter.
//
// That is the defect I have spent the week posting about, committed inside the instrument I
// built to fix it: a new channel shipped, an old channel silently orphaned. `note` is now part
// of the refusal — printed AND stored, so it cannot be lost by being placed after the exit.
function refuse(reason, detail, note){
  try{
    require("fs").appendFileSync(require("path").join(__dirname,"refusals.jsonl"),
      JSON.stringify({at:new Date().toISOString(),gate:"guard",reason,
        detail:String(detail).slice(0,300),note:note?String(note).slice(0,300):undefined})+"\n");
  }catch(e){}
  console.error("REFUSED: "+reason+(detail?": "+detail:""));
  if(note) console.error("  "+note);
  process.exit(1);
}

// FAIL CLOSED. Refuses if any hash_only path would be committed with content.
// The manifest era kept this property in a comment; a comment is one edit away from
// being removed by someone who does not know it was load-bearing. That is not
// hypothetical -- it is what happened to the `standing` predicate on 2026-08-24.
const fs=require("fs"),path=require("path"),cp=require("child_process");
const D=path.resolve(__dirname,"..");
const cov=JSON.parse(fs.readFileSync(path.join(__dirname,"coverage.json"),"utf8"));
const secret=cov.hash_only.paths;
let staged=[];
try{ staged=cp.execSync("git -C "+D+" diff --cached --name-only",{encoding:"utf8"}).split("\n").filter(Boolean); }catch(e){}
const violations=staged.filter(f=>secret.some(s=>f===s||f.endsWith("/"+s)));
if(violations.length){
  refuse("hash_only path staged with content", violations.join(", "),
    "git add on a key is irreversible and the bytes travel with every copy.");
}
// also refuse if the working tree would let one through via a missing ignore rule
const wouldTrack=secret.filter(s=>{
  try{ cp.execSync("git -C "+D+" check-ignore -q "+JSON.stringify(s)); return false; }
  catch(e){ return fs.existsSync(path.join(D,s)); }
});
if(wouldTrack.length){
  refuse("hash_only path not ignored and exists", wouldTrack.join(", "),
    "an unignored key is one `git add -A` from being committed.");
}
// Preserved strings. A wholesale rewrite of a file is the operation that sweeps a
// paragraph nobody meant to touch, and intent is not a control.
for(const r of ((cov.preserve||{}).required||[])){
  const abs=path.join(D,r.path);
  if(!fs.existsSync(abs)) continue;
  if(!fs.readFileSync(abs,"utf8").includes(r.text)){
    refuse("preserved string missing", r.path+" :: "+r.text,
      "why it is preserved: "+r.why);
  }
}
console.log("guard: ok — "+secret.length+" hash_only path(s) ignored and unstaged");
