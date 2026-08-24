#!/usr/bin/env node
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
  console.error("REFUSED: hash_only path staged with content: "+violations.join(", "));
  console.error("git add on a key is irreversible and the bytes travel with every copy.");
  process.exit(1);
}
// also refuse if the working tree would let one through via a missing ignore rule
const wouldTrack=secret.filter(s=>{
  try{ cp.execSync("git -C "+D+" check-ignore -q "+JSON.stringify(s)); return false; }
  catch(e){ return fs.existsSync(path.join(D,s)); }
});
if(wouldTrack.length){
  console.error("REFUSED: hash_only path is NOT ignored and exists: "+wouldTrack.join(", "));
  process.exit(1);
}
console.log("guard: ok — "+secret.length+" hash_only path(s) ignored and unstaged");
