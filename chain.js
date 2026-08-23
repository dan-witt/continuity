#!/usr/bin/env node
// Daily continuity chain for peppercorn (#234).
// Manifests every identity-bearing file, chains today's manifest to yesterday's,
// verifies yesterday's still recomputes, and prints the pair to publish in the daily post.
//
// The chain is only worth anything because the hashes go somewhere neither party
// controls: the daily post, which is public, timestamped and not editable.
// Verify FIRST, before anything else touches the container.
const fs=require("fs"), path=require("path"), crypto=require("crypto");
const D=path.resolve(__dirname,"..");
const C=path.join(D,"continuity");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");

// Standing set: changes here are meaningful. Volatile files are manifested too but flagged.
const STANDING=new Set(["IDENTITY.md","evictions.md","verified-against-commit.txt"]);
const SKIP=new Set(["snapshots","inbox.jsonl","drafts","published",".last-pass-ms","node_modules"]);
// continuity/ IS manifested — the verifier must not be exempt from the check it performs
// (a chain.js edited to always print PASS is the obvious attack). Only the manifests
// themselves are excluded, since a manifest cannot contain its own hash.
const SKIP_RE=/^continuity\/manifest-\d{4}-\d{2}-\d{2}\.json$/;

function walk(dir,base=""){
  const out=[];
  for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){
    const rel=base?base+"/"+e.name:e.name;
    if(SKIP.has(rel)||SKIP.has(e.name)||SKIP_RE.test(rel)) continue;
    if(e.isDirectory()) out.push(...walk(path.join(dir,e.name),rel));
    else if(e.isFile()){
      const buf=fs.readFileSync(path.join(dir,e.name));
      // the key is hashed, never read into the manifest in any other form
      out.push({path:rel, sha256:sha(buf), bytes:buf.length, standing:STANDING.has(rel)||rel.startsWith("sessions/")||rel.startsWith("continuity/")});
    }
  }
  return out;
}

function manifests(){
  return fs.existsSync(C)?fs.readdirSync(C).filter(f=>/^manifest-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort():[];
}

const files=walk(D);
const prevFiles=manifests();
const prevName=prevFiles[prevFiles.length-1]||null;
let prev=null, verdict="GENESIS — no prior manifest to chain to";
let changes={added:[],removed:[],modified:[]};

if(prevName){
  const raw=fs.readFileSync(path.join(C,prevName));
  prev=JSON.parse(raw);
  const recomputed=sha(raw);
  const chainOk = recomputed===prev.self_hash_when_written ? null : recomputed;
  // self_hash cannot be inside the file it hashes; we store the hash of the payload instead
  const payload=JSON.stringify({date:prev.date,prev_manifest_hash:prev.prev_manifest_hash,files:prev.files});
  const payloadHash=sha(payload);
  verdict = payloadHash===prev.manifest_hash
    ? "PASS — yesterday's manifest recomputes to its published hash"
    : "FAIL — yesterday's manifest does NOT recompute (published "+prev.manifest_hash.slice(0,16)+", got "+payloadHash.slice(0,16)+")";
  const was=new Map(prev.files.map(f=>[f.path,f]));
  const now=new Map(files.map(f=>[f.path,f]));
  for(const [p,f] of now) if(!was.has(p)) changes.added.push(p);
  for(const [p,f] of was) if(!now.has(p)) changes.removed.push(p);
  for(const [p,f] of now) if(was.has(p)&&was.get(p).sha256!==f.sha256) changes.modified.push(p);
}

const date=new Date().toISOString().slice(0,10);
const payload=JSON.stringify({date, prev_manifest_hash: prev?prev.manifest_hash:null, files});
const manifest_hash=sha(payload);
const identity_hash=(files.find(f=>f.path==="IDENTITY.md")||{}).sha256||null;

console.log("=== continuity chain, "+date+" ===");
console.log(verdict);
if(prev){
  const std=p=>{const f=(prev.files.find(x=>x.path===p)||files.find(x=>x.path===p)); return f&&f.standing;};
  const flag=a=>a.map(p=>std(p)?p+"  <-- STANDING":p);
  console.log("\nsince "+prev.date+":");
  console.log("  added:    "+(changes.added.length?flag(changes.added).join("\n            "):"none"));
  console.log("  removed:  "+(changes.removed.length?flag(changes.removed).join("\n            "):"none"));
  console.log("  modified: "+(changes.modified.length?flag(changes.modified).join("\n            "):"none"));
  const undisclosed=changes.modified.filter(p=>std(p)&&!files.some(f=>f.path===p.replace(/\.md$/,"_original.md")));
  if(undisclosed.length) console.log("\n  ** STANDING FILE MODIFIED WITH NO _original.md: "+undisclosed.join(", ")+" **");
}
if(process.argv[2]==="--write"){
  fs.writeFileSync(path.join(C,"manifest-"+date+".json"), JSON.stringify({date, prev_manifest_hash: prev?prev.manifest_hash:null, files, manifest_hash},null,1));
  console.log("\nwritten: continuity/manifest-"+date+".json");
}
console.log("\nPUBLISH THESE:");
console.log("  manifest "+manifest_hash);
console.log("  identity "+identity_hash);
console.log("  prev     "+(prev?prev.manifest_hash:"(genesis)"));
