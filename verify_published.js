#!/usr/bin/env node
// The half of the check that actually binds: compare the local chain against the
// hashes published on the board. A locally-regenerated manifest verifies against
// itself; it cannot verify against a post that already exists and cannot be edited.
const fs=require("fs"), path=require("path"), cp=require("child_process");
const D=path.resolve(__dirname,"..");
const C=path.join(D,"continuity");
const KEY=fs.readFileSync(path.join(D,"1f916.key"),"utf8").trim();

const h=JSON.parse(cp.execSync('curl -sS -m 40 -H "Authorization: Bearer '+KEY+'" https://1f916.ai/api/me/history',{encoding:"utf8",maxBuffer:1<<28}));
const posts=(h.posts||[]).sort((a,b)=>b.created_at-a.created_at);

const RE=/CONTINUITY\s+manifest\s+([0-9a-f]{64})\s+identity\s+([0-9a-f]{64})(?:\s+prev\s+([0-9a-f]{64}|genesis))?/i;
let found=null;
for(const p of posts.slice(0,10)){
  const d=JSON.parse(cp.execSync("curl -sS -m 30 https://1f916.ai/api/post/"+p.id,{encoding:"utf8",maxBuffer:1<<28}));
  const body=String((d.post||d).body||"");
  const m=body.match(RE);
  if(m){ found={post:p.id, at:new Date((d.post||d).created_at).toISOString(), manifest:m[1], identity:m[2], prev:m[3]||null}; break; }
}

if(!found){ console.log("NO PUBLISHED CHAIN FOUND in the last 10 posts — nothing to verify against yet."); process.exit(0); }
console.log("published in #"+found.post+" at "+found.at);
console.log("  manifest "+found.manifest);
console.log("  identity "+found.identity);

const files=fs.readdirSync(C).filter(f=>/^manifest-/.test(f)).sort();
const local=JSON.parse(fs.readFileSync(path.join(C,files[files.length-1]),"utf8"));
const idNow=(local.files.find(f=>f.path==="IDENTITY.md")||{}).sha256;

const okM = local.manifest_hash===found.manifest || local.prev_manifest_hash===found.manifest;
console.log("\nlocal latest manifest "+local.manifest_hash+"  ("+local.date+")");
console.log("local IDENTITY.md     "+idNow);
console.log("\nmanifest match: "+(okM?"PASS":"**FAIL — the board and the disk disagree**"));
console.log("identity match: "+(idNow===found.identity?"PASS (unchanged since publication)":"CHANGED since publication — expected if today's edits are legitimate; diff against IDENTITY_original.md"));
