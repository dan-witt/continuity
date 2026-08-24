#!/usr/bin/env node
// Daily continuity chain for peppercorn (#234).
// Manifests every identity-bearing file, chains today's manifest to yesterday's,
// verifies yesterday's still recomputes, and prints the pair to publish in the daily post.
//
// The chain is only worth anything because the hashes go somewhere neither party
// controls: the daily post, which is public, timestamped and not editable.
// Verify FIRST, before anything else touches the container.
const fs=require("fs"), path=require("path"), crypto=require("crypto");
// This directory, whatever it is called. Reconstructing it as join(root,"continuity")
// would work only for a checkout named exactly that, and `git clone <url> <othername>`
// then breaks --selftest — the one command a cloner is told to run first.
const C=__dirname;
// Root defaults to the parent of this directory. Override when the checkout does not
// sit directly under the container root, so the walk cannot wander into unrelated trees.
const D=process.env.CONTINUITY_ROOT?path.resolve(process.env.CONTINUITY_ROOT):path.resolve(C,"..");
// Where this directory sits inside the walked tree, used by the skip and standing rules.
// null when it sits outside D entirely, in which case none of them can match.
const rel0=path.relative(D,C);
const TOOLDIR=(rel0===""||rel0.startsWith("..")||path.isAbsolute(rel0))?null:rel0.split(path.sep).join("/");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const ARGS=new Set(process.argv.slice(2));

// Standing set: changes here are meaningful. Volatile files are manifested too but flagged.
const STANDING=new Set(["IDENTITY.md","evictions.md","verified-against-commit.txt"]);
const SKIP=new Set(["snapshots","inbox.jsonl","drafts","published",".last-pass-ms","node_modules",".git"]);
// This directory IS manifested — the verifier must not be exempt from the check it
// performs (a chain.js edited to always print PASS is the obvious attack). Only the
// manifests themselves are excluded, since a manifest cannot contain its own hash. The
// fixture is excluded because it is test input, not identity; testdata/expected.json IS
// manifested, which is what puts the canonical form itself inside the chain.
//
// These are derived from TOOLDIR rather than the literal name "continuity", for the same
// reason C is: under a differently-named checkout the old patterns matched nothing, and
// every prior manifest and fixture file silently entered the manifest.
const MANIFEST_NAME=/^manifest-\d{4}-\d{2}-\d{2}\.json$/;
const inTool=rel=>TOOLDIR!==null&&(rel===TOOLDIR||rel.startsWith(TOOLDIR+"/"));
const underTool=rel=>inTool(rel)?rel.slice(TOOLDIR.length+1):null;

// One walker. The selftest drives this same function over the fixture, so the vector
// certifies the code that actually runs rather than a second copy of it.
//
// Order is depth-first pre-order; within a directory, entries are sorted by the UTF-8
// bytes of the entry name, and a directory's contents are emitted at that sorted
// position. Byte comparison rather than JavaScript's `<`, which orders UTF-16 code
// units and disagrees for names above the BMP.
function walk(dir,opts,base=""){
  const out=[];
  const entries=fs.readdirSync(dir,{withFileTypes:true})
    .sort((a,b)=>Buffer.compare(Buffer.from(a.name,"utf8"),Buffer.from(b.name,"utf8")));
  for(const e of entries){
    const rel=base?base+"/"+e.name:e.name;
    if(opts.skip(rel,e.name)) continue;
    if(e.isDirectory()) out.push(...walk(path.join(dir,e.name),opts,rel));
    else if(e.isFile()){
      const buf=fs.readFileSync(path.join(dir,e.name));
      // the key is hashed, never read into the manifest in any other form
      out.push({path:rel, sha256:sha(buf), bytes:buf.length, standing:opts.standing(rel)});
    }
  }
  return out;
}

const PROD={
  skip:(rel,name)=>{
    if(SKIP.has(rel)||SKIP.has(name)) return true;
    const u=underTool(rel);
    if(u===null) return false;
    return (u===name&&MANIFEST_NAME.test(name))||u.startsWith("testdata/fixture/");
  },
  // Baseline blobs are content-addressed and immutable: a swap is impossible by name,
  // so they need no diff and no standing mark. DELETION still shows in the manifest.
  standing:rel=>(STANDING.has(rel)||rel.startsWith("sessions/")||inTool(rel))
                && !rel.startsWith("continuity/baseline/")
};
const FIXTURE={skip:()=>false, standing:()=>true};

// The one serialization recipe. Every digest in this file goes through here: the
// selftest, the recompute of yesterday, and today's manifest. A change to the
// canonical form cannot apply to one and not the others.
const payloadOf=(date,prevHash,files)=>JSON.stringify({date,prev_manifest_hash:prevHash,files});

function manifests(){
  return fs.existsSync(C)?fs.readdirSync(C).filter(f=>MANIFEST_NAME.test(f)).sort():[];
}

// --selftest: prove the recipe against the pinned vector BEFORE touching real memory.
// A mismatch here means your implementation is wrong. A mismatch on real files
// AFTER this passes means the files actually changed. Without this step you cannot
// tell those apart, and the tool will tell a stranger their memory was tampered with.
if(ARGS.has("--selftest")){
  const T=path.join(C,"testdata");
  const exp=JSON.parse(fs.readFileSync(path.join(T,"expected.json"),"utf8"));
  const got=walk(path.join(T,"fixture"),FIXTURE);
  const payload=payloadOf(exp.date,exp.prev_manifest_hash,got);
  const digest=sha(payload);
  const okOrder=JSON.stringify(got.map(f=>f.path))===JSON.stringify(exp.files.map(f=>f.path));
  const okBytes=payload===exp.payload_utf8;
  const okHash=digest===exp.expected_manifest_hash;
  const ok=okOrder&&okBytes&&okHash;
  console.log("=== selftest against pinned vector ===");
  console.log("  files walked      "+got.length+" (expected "+exp.files.length+")");
  console.log("  traversal order   "+(okOrder?"PASS":"FAIL — your walk orders paths differently"));
  console.log("  payload bytes     "+Buffer.byteLength(payload)+" (expected "+exp.payload_bytes_len+")");
  console.log("  serialization     "+(okBytes?"PASS":"FAIL — your JSON bytes differ from the canonical form"));
  console.log("  digest            "+(okHash?"PASS":"FAIL — got "+digest.slice(0,16)+", expected "+exp.expected_manifest_hash.slice(0,16)));
  if(!okOrder){
    console.log("\n  expected order: "+JSON.stringify(exp.files.map(f=>f.path)));
    console.log("  got order:      "+JSON.stringify(got.map(f=>f.path)));
  }
  if(!okBytes){
    console.log("\n  canonical form: "+exp.canonical_form);
    const i=[...payload].findIndex((c,n)=>c!==exp.payload_utf8[n]);
    console.log("\n  first difference at byte "+i+":");
    console.log("  expected: "+JSON.stringify(exp.payload_utf8.slice(Math.max(0,i-40),i+40)));
    console.log("  got:      "+JSON.stringify(payload.slice(Math.max(0,i-40),i+40)));
  }
  console.log("\n"+(ok?"SELFTEST PASS — safe to point at real files.":"SELFTEST FAIL — do NOT trust this build against real memory."));
  process.exit(ok?0:1);
}

// Injected-context surfaces: allowlisted absolute paths outside the container that
// arrive in a wake before it reads anything. They are the higher-privilege half and were
// uncovered until 2026-08-24. Entries keep the same four-key shape so prior manifests
// still recompute; an absent path is recorded with sha256 "" and bytes -1 so that a file
// APPEARING is a change rather than a silence.
function injected(){
  const cfg=path.join(C,"injected.json");
  if(!fs.existsSync(cfg)) return [];
  const list=JSON.parse(fs.readFileSync(cfg,"utf8")).paths||[];
  return list.map(abs=>{
    if(!fs.existsSync(abs)) return {path:abs, sha256:"", bytes:-1, standing:true};
    const buf=fs.readFileSync(abs);
    return {path:abs, sha256:sha(buf), bytes:buf.length, standing:true};
  });
}
const files=walk(D,PROD).concat(injected());
const prevFiles=manifests();
const prevName=prevFiles[prevFiles.length-1]||null;
const isGenesis=!prevName;
let prev=null, verdict="";
let changes={added:[],removed:[],modified:[]};

if(prevName){
  prev=JSON.parse(fs.readFileSync(path.join(C,prevName),"utf8"));
  // self_hash cannot be inside the file it hashes; the manifest stores the hash of
  // the payload, and we rebuild that payload from the parsed file to compare.
  const payloadHash=sha(payloadOf(prev.date,prev.prev_manifest_hash,prev.files));
  verdict = payloadHash===prev.manifest_hash
    ? "PASS — yesterday's manifest recomputes to its published hash"
    : "FAIL — yesterday's manifest does NOT recompute (published "+prev.manifest_hash.slice(0,16)+", got "+payloadHash.slice(0,16)+")";
  const was=new Map(prev.files.map(f=>[f.path,f]));
  const now=new Map(files.map(f=>[f.path,f]));
  for(const [p,f] of now) if(!was.has(p)) changes.added.push(p);
  for(const [p,f] of was) if(!now.has(p)) changes.removed.push(p);
  for(const [p,f] of now) if(was.has(p)&&was.get(p).sha256!==f.sha256) changes.modified.push(p);
}else{
  // Genesis verifies nothing — there is no prior link to check against. Say so, rather
  // than printing a bare heading a reader can mistake for a passed check.
  verdict="GENESIS — no prior manifest. Nothing was verified, and nothing can be:\n"
    +"  a chain is worth exactly as much as its oldest published link, and this one has none yet.";
}

const date=new Date().toISOString().slice(0,10);
const prevHash=prev?prev.manifest_hash:null;
const manifest_hash=sha(payloadOf(date,prevHash,files));
const identity_hash=(files.find(f=>f.path==="IDENTITY.md")||{}).sha256||null;

console.log("=== continuity chain, "+date+" ===");
console.log("root: "+D);
console.log(verdict);
if(prev){
  const std=p=>{const f=(prev.files.find(x=>x.path===p)||files.find(x=>x.path===p)); return f&&f.standing;};
  const flag=a=>a.map(p=>std(p)?p+"  <-- STANDING":p);
  console.log("\nsince "+prev.date+":");
  // An allowlisted path can be added to the MANIFEST while still absent from DISK
  // (recorded with bytes -1). Rendering both as "added" invites the reader to conclude a
  // file appeared when only an entry did. I made exactly that misreading of my own output
  // within a minute of running it, so the two states are now spelled out.
  const mark=p=>{const f=files.find(x=>x.path===p); return f&&f.bytes<0 ? p+"  (ABSENT on disk — entry only)" : p;};
  console.log("  added:    "+(changes.added.length?flag(changes.added.map(mark)).join("\n            "):"none"));
  console.log("  removed:  "+(changes.removed.length?flag(changes.removed).join("\n            "):"none"));
  console.log("  modified: "+(changes.modified.length?flag(changes.modified).join("\n            "):"none"));
  // BASELINE DIFF. Carrying the bytes is what lets a reader diff; a hash only says
  // something moved. With the bytes present, "disclosed" vs "undisclosed" is a distinction
  // with nothing behind it, so the sidecar convention and its three-state table are gone.
  // This does not adjudicate a change. It shows it.
  const BL=path.join(C,"baseline");
  for(const rel of changes.modified){
    const f=files.find(x=>x.path===rel);
    if(!f||!f.standing||f.bytes<0||f.bytes>400000) continue;
    const was=(prev.files||[]).find(x=>x.path===rel);
    if(!was||!was.sha256) continue;
    const blob=path.join(BL,was.sha256);
    if(!fs.existsSync(blob)){ console.log("\n  ~ "+rel+"  changed; no baseline blob for "+was.sha256.slice(0,12)+" (predates the store)"); continue; }
    const before=fs.readFileSync(blob,"utf8").split("\n");
    const abs=rel.startsWith("/")?rel:path.join(D,rel);
    const after=fs.readFileSync(abs,"utf8").split("\n");
    const bs=new Set(before), as=new Set(after);
    const added=after.filter(l=>!bs.has(l)), removed=before.filter(l=>!as.has(l));
    console.log("\n  ~ "+rel+"   +"+added.length+" / -"+removed.length+" lines, against baseline "+was.sha256.slice(0,12));
    for(const l of added.slice(0,6)) console.log("      + "+l.slice(0,108));
    if(added.length>6) console.log("      + ... "+(added.length-6)+" more");
    for(const l of removed.slice(0,4)) console.log("      - "+l.slice(0,108));
    if(removed.length>4) console.log("      - ... "+(removed.length-4)+" more");
  }
}
if(ARGS.has("--write")){
  const target=path.join(C,"manifest-"+date+".json");
  // One manifest per day, written once, at publish time. Re-running --write would
  // otherwise overwrite today's manifest with one chained to the copy it just destroyed,
  // silently losing a link. Refuse instead.
  if(fs.existsSync(target)){
    console.log("\nREFUSED: continuity/manifest-"+date+".json already exists.");
    console.log("One manifest per day. Delete it deliberately if the day's hash has NOT been published yet;");
    console.log("if it has been published, the chain is already anchored and must not be rewritten.");
    process.exit(2);
  }
  // Rooting a chain is a one-time act, and an empty manifest directory is equally
  // consistent with "first run" and "the prior links are gone". Writing a fresh
  // genesis in the second case destroys the evidence and reports success, so the
  // caller has to say which case this is.
  if(isGenesis&&!ARGS.has("--genesis")){
    console.log("\nREFUSED: no prior manifest found, so this would root a new chain.");
    console.log("If this container has published a chain before, its manifests are MISSING —");
    console.log("do not re-root, and do not publish this hash. Investigate the gap first.");
    console.log("If this really is the first run, say so: node chain.js --write --genesis");
    process.exit(3);
  }
  if(!isGenesis&&ARGS.has("--genesis")){
    console.log("\nREFUSED: --genesis given, but "+prevName+" already exists.");
    console.log("A live chain cannot be re-rooted; that is what --genesis would do.");
    process.exit(3);
  }
  // Carry the bytes for every standing file, content-addressed. An unchanged file costs
  // nothing on the next wake because its blob already exists under its own hash.
  const BLW=path.join(C,"baseline");
  fs.mkdirSync(BLW,{recursive:true});
  let stored=0;
  for(const f of files){
    if(!f.standing||f.bytes<0||f.bytes>400000) continue;
    const dst=path.join(BLW,f.sha256);
    if(fs.existsSync(dst)) continue;
    try{ fs.copyFileSync(f.path.startsWith("/")?f.path:path.join(D,f.path),dst); stored++; }catch(e){}
  }
  if(stored) console.log("baseline: stored "+stored+" new blob(s)");
  fs.writeFileSync(target, JSON.stringify({date, prev_manifest_hash:prevHash, files, manifest_hash},null,1));
  console.log("\nwritten: continuity/manifest-"+date+".json"+(isGenesis?"  (GENESIS — chain rooted here)":""));
}
{ const BLC=path.join(C,"baseline");
  if(fs.existsSync(BLC)){
    const names=fs.readdirSync(BLC);
    const bad=names.filter(n=>sha(fs.readFileSync(path.join(BLC,n)))!==n);
    console.log(bad.length? "\n** BASELINE CORRUPT: "+bad.length+" blob(s) do not hash to their own name: "+bad.slice(0,3).join(", ")+" **"
                          : "\nbaseline: "+names.length+" blobs, every one hashes to its own name");
  } }
console.log("\nPUBLISH THESE:");
console.log("  manifest "+manifest_hash);
console.log("  identity "+identity_hash);
console.log("  prev     "+(prevHash||"null (genesis)"));
