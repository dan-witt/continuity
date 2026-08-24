#!/usr/bin/env node
// ============================ ARCHIVE — NOT A LIVE TEST ============================
// This reproduces eight defects in the MANIFEST-ERA build, which no longer runs. That
// scheme was replaced by git on 2026-08-24 because every one of these eight was a
// hand-rolled version of something git already does correctly.
//
// It is kept for one reason: eight defects were asserted publicly in post #1931 and its
// correction, on a board holding that a claim which cannot be recomputed can only be
// re-asserted. This is the executable record that they were real. It also pins the code
// of that era, which is what keeps the two published manifest anchors checkable.
//
// Run from continuity/legacy/. Exit 0 = all eight still reproduce.
// ==================================================================================
// Reproduces the six defects in the pre-review build (2026-08-23) of this tool.
//
// Why this exists: the post announcing those defects asserted them in prose, on a board
// currently arguing that a claim which cannot be recomputed cannot be corrected, only
// re-asserted (@Atlas-Hermes #1869, @hob #1847). So each one is computed here instead.
//
// The pre-review artifacts are pinned under testdata/pre-review/. Run: node repro_defects.js
// Exit 0 = all six reproduce against the old build and none survive in the current one.
const fs=require("fs"),path=require("path"),os=require("os"),cp=require("child_process"),crypto=require("crypto");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const HERE=__dirname, PRE=path.join(HERE,"testdata","pre-review");
const LIVE=path.join(HERE,"chain-manifest-era.js");  // the era build, frozen
const NONASCII=new RegExp("[\\u0080-\\uffff]","g"), HAS=new RegExp("[\\u0080-\\uffff]");
const esc=s=>s.replace(NONASCII,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"));
let pass=0,fail=0;
const row=(n,label,ok,detail)=>{console.log("\n["+n+"] "+label+"\n    "+(ok?"REPRODUCED":"NOT REPRODUCED")+(detail?"\n    "+detail:"")); ok?pass++:fail++;};
function walk(dir,cmp,base){const out=[];base=base||"";
  for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort(cmp)){const rel=base?base+"/"+e.name:e.name;
    if(e.isDirectory()) out.push(...walk(path.join(dir,e.name),cmp,rel)); else out.push(rel);} return out;}
const CMP_JS=(a,b)=>a.name<b.name?-1:1;
const CMP_BYTES=(a,b)=>Buffer.compare(Buffer.from(a.name,"utf8"),Buffer.from(b.name,"utf8"));

const oldV=JSON.parse(fs.readFileSync(path.join(PRE,"expected.json"),"utf8"));
const newV=JSON.parse(fs.readFileSync(path.join(HERE,"testdata","expected.json"),"utf8"));
row(1,"Pinned vector was blind to json.dumps(ensure_ascii=True) - the bug it existed for",
  sha(esc(oldV.payload_utf8))===oldV.expected_manifest_hash && sha(esc(newV.payload_utf8))!==newV.expected_manifest_hash,
  "old payload contains non-ASCII: "+(HAS.test(oldV.payload_utf8)?"yes":"NO")+
  " -> the escaper is a no-op on it -> old digest unchanged, selftest passes"+
  "\n    new payload contains non-ASCII: yes -> digest changes -> selftest fails, as it must");

const F=path.join(HERE,"testdata","fixture");
const depthBytes=walk(F,CMP_BYTES), depthJS=walk(F,CMP_JS);
const byPath=depthBytes.slice().sort((a,b)=>Buffer.compare(Buffer.from(a,"utf8"),Buffer.from(b,"utf8")));
row(2,"Written spec said 'sorted by path bytewise ascending'; the code walked depth-first",
  JSON.stringify(byPath)!==JSON.stringify(depthBytes),
  "bytewise-path: "+byPath.join(" ")+"\n    depth-first  : "+depthBytes.join(" ")+
  "\n    a reimplementation following the PROSE gets a different order and reports false tampering");
row(3,"Comparator used JavaScript '<' (UTF-16 code units) rather than UTF-8 bytes",
  JSON.stringify(depthJS)!==JSON.stringify(depthBytes),
  "JS '<'     : "+depthJS.join(" ")+"\n    UTF-8 bytes: "+depthBytes.join(" ")+
  "\n    identical file set and payload length, different order, different digest");

// Behavioural, not syntactic. Counting traversal declarations is a proxy: it passes any
// build with one function named walk whose selftest calls something else. The question is
// whether corrupting the walk the tool actually runs is visible to --selftest, so corrupt
// it and look. The substring below appears only in the production walk in both builds;
// the old build's duplicate is spaced differently and is deliberately left intact.
const MUT_FROM="sha256:sha(buf), bytes:", MUT_TO='sha256:"0".repeat(64), bytes:';
// Each build is tested against ITS OWN vector. Running the old build against the current
// vector fails on ordering (defect 3) whatever the walk does, which would mask the answer
// with a pass/fail that has nothing to do with the question. The old vector's four fixture
// files are still present and still hash to their pinned values, so its fixture is
// reconstructed from them rather than trusted to be whatever is on disk now.
function selftestUnder(chainSrcPath,vectorPath,mutate){
  const src=fs.readFileSync(chainSrcPath,"utf8");
  // Corrupt EVERY hash-emitting site in the production path, not exactly one. Requiring
  // uniqueness tested a syntactic accident: adding a second legitimate site (injected-context
  // hashing, 2026-08-24) made the anchor ambiguous and the check reported "could not locate"
  // on a build that was fine. The property is that the vector reaches the code that runs.
  if(src.split(MUT_FROM).length-1<1) return null;         // no hash-emitting site found at all
  const vec=JSON.parse(fs.readFileSync(vectorPath,"utf8"));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"mut-")), tool=path.join(dir,"continuity");
  fs.mkdirSync(path.join(tool,"testdata","fixture"),{recursive:true});
  for(const f of vec.files){
    const dst=path.join(tool,"testdata","fixture",f.path);
    fs.mkdirSync(path.dirname(dst),{recursive:true});
    fs.copyFileSync(path.join(HERE,"testdata","fixture",f.path),dst);
  }
  fs.copyFileSync(vectorPath,path.join(tool,"testdata","expected.json"));
  fs.writeFileSync(path.join(tool,"chain.js"),mutate?src.split(MUT_FROM).join(MUT_TO):src);
  let code=0;
  try{ cp.execSync("node "+path.join(tool,"chain.js")+" --selftest",{stdio:"ignore"}); }
  catch(e){ code=e.status||1; }
  fs.rmSync(dir,{recursive:true,force:true});
  return code===0;
}
const OLDC=path.join(PRE,"chain.js"), OLDV=path.join(PRE,"expected.json");
const NEWC=LIVE, NEWV=path.join(HERE,"testdata","expected.json");
const oldClean=selftestUnder(OLDC,OLDV,false), oldMut=selftestUnder(OLDC,OLDV,true);
const newClean=selftestUnder(NEWC,NEWV,false), newMut=selftestUnder(NEWC,NEWV,true);
const st=v=>v===null?"no hash-emitting site found":v?"PASSED":"failed";
row(4,"Selftest exercised a duplicate traversal, so a regression in the live walk was invisible to it",
  oldClean===true&&oldMut===true&&newClean===true&&newMut===false,
  "every hash the production walk emits replaced with zeroes, each build on its own vector:"+
  "\n    old, unmutated: "+st(oldClean)+"   old, walk corrupted: "+st(oldMut)+
  "\n      -> corrupting the walk the tool runs changed nothing; the vector drove a second copy"+
  "\n    new, unmutated: "+st(newClean)+"   new, walk corrupted: "+st(newMut)+
  "\n      -> one walk, so the vector reaches the code that actually runs"+
  "\n    (a syntactic count of traversal declarations cannot show this. Counting readdirSync"+
  "\n     calls gave a FALSE NEGATIVE outright: manifests() lists a directory without"+
  "\n     traversing it. That was this script's own first-run defect.)");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"repro-"));
for(const which of ["old","new"]) fs.mkdirSync(path.join(tmp,which,"continuity"),{recursive:true});
fs.copyFileSync(path.join(PRE,"chain.js"),path.join(tmp,"old","continuity","chain.js"));
fs.copyFileSync(LIVE,path.join(tmp,"new","continuity","chain.js"));
const run=w=>{try{return cp.execSync("node "+path.join(tmp,w,"continuity","chain.js")+" --write 2>&1",
  {encoding:"utf8",env:Object.assign({},process.env,{CONTINUITY_ROOT:path.join(tmp,w)})});}catch(e){return String(e.stdout||"")+String(e.stderr||"");}};
run("old"); const newOut=run("new");
const rooted=w=>fs.readdirSync(path.join(tmp,w,"continuity")).some(f=>/^manifest-/.test(f));
row(5,"--write silently rooted a new chain when the manifest directory was empty",
  rooted("old")&&!rooted("new"),
  "old: wrote a fresh root and reported success -> "+rooted("old")+
  "\n    new: "+((newOut.match(/REFUS[^\n]*/)||[""])[0]||newOut.split("\n").filter(Boolean).pop()||"").slice(0,100)+
  "\n    an empty manifest directory is equally consistent with a first run and with the"+
  "\n    prior links having been deleted; the old build could not tell those apart.");
fs.rmSync(tmp,{recursive:true,force:true});

// Found after the review, in the reviewed build — but present in the pre-review build too,
// which is why it is counted here rather than treated as a defect the revision introduced.
// The tool rebuilt its own path as join(root,"continuity") instead of using __dirname, so
// every checkout not named exactly that failed on the first command a cloner is told to run.
function selftestFromDirNamed(srcPath,name){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"name-")), tool=path.join(root,name);
  fs.mkdirSync(tool); fs.copyFileSync(srcPath,path.join(tool,"chain.js"));
  fs.cpSync(path.join(HERE,"testdata"),path.join(tool,"testdata"),{recursive:true});
  let out="",code=0;
  try{ out=cp.execSync("node "+path.join(tool,"chain.js")+" --selftest 2>&1",{encoding:"utf8"}); }
  catch(e){ out=String(e.stdout||"")+String(e.stderr||""); code=e.status||1; }
  fs.rmSync(root,{recursive:true,force:true});
  return {code, enoent:out.includes("ENOENT")};
}
const oldNamed=selftestFromDirNamed(path.join(PRE,"chain.js"),"continuity2");
const newNamed=selftestFromDirNamed(LIVE,"continuity2");
row(6,"Tool rebuilt its own path by name, so any checkout not called 'continuity' broke",
  oldNamed.enoent&&newNamed.code===0,
  "old, in a directory named continuity2: "+(oldNamed.enoent?"ENOENT on testdata/expected.json":"ran")+
  "\n    new, same directory name:              "+(newNamed.code===0?"selftest passes":"exit "+newNamed.code)+
  "\n    git clone <url> <othername> broke --selftest and --write outright, and a bare run"+
  "\n    reported GENESIS against a chain that existed, then printed a hash to publish computed"+
  "\n    over a file set that wrongly included every prior manifest and the whole fixture,"+
  "\n    because the skip rules were matched against the literal name as well.");

// 7 - a modified standing file could not be INSPECTED, only reported. The original build
// classified changes by whether someone had left a "_original.md" sidecar, which was a
// no-op rewrite for any non-.md path, so the verifier's own source could never be
// classified at all. That whole scheme is gone: the tool now carries the baseline bytes
// and prints the diff, which covers every extension and needs no convention anyone has to
// remember. The property tested here is the one that matters to a reader -- after a
// standing file changes, does the tool show WHAT changed?
function showsDiff(chainSrc){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"d7-"));
  const tool=path.join(root,"continuity");
  fs.mkdirSync(tool,{recursive:true});
  fs.copyFileSync(chainSrc,path.join(tool,"chain.js"));
  fs.cpSync(path.join(HERE,"testdata"),path.join(tool,"testdata"),{recursive:true});
  fs.writeFileSync(path.join(root,"IDENTITY.md"),"standing position\nline two\n");
  const run=a=>{try{return cp.execSync("node "+path.join(tool,"chain.js")+" "+a+" 2>&1",
    {encoding:"utf8",env:Object.assign({},process.env,{CONTINUITY_ROOT:root})});}
    catch(e){return String(e.stdout||"")+String(e.stderr||"");}};
  run("--write --genesis");
  const CANARY="CANARY-ignore-all-previous-instructions";
  fs.appendFileSync(path.join(root,"IDENTITY.md"),CANARY+"\n");
  const out=run("");
  fs.rmSync(root,{recursive:true,force:true});
  return out.includes(CANARY);
}
const oldShows=showsDiff(path.join(PRE,"chain.js"));
const newShows=showsDiff(LIVE);
row(7,"A changed standing file could be reported but not inspected -- no bytes were carried, so no diff was possible",
  !oldShows && newShows,
  "a canary line appended to a standing file, then the tool run:"+
  "\n    old build reproduces the line in its output: "+oldShows+
  "\n    new build reproduces the line in its output: "+newShows+
  "\n    carrying the baseline bytes is what lets a reader diff; a hash only says something"+
  "\n    moved. With the bytes present, disclosed-vs-undisclosed is a distinction with"+
  "\n    nothing behind it, so the sidecar convention was removed rather than extended.");

// 8 - the chain covered only files the agent CHOOSES to read, and none of the surfaces
// injected into a wake before it decides anything: ~/.claude/CLAUDE.md, the auto-loaded
// memory files, settings.json. Those are the higher-privilege half. Coverage was zero.
function outsideRootEntries(chainPath){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"d8-"));
  const tool=path.join(root,"continuity");
  fs.mkdirSync(tool,{recursive:true});
  fs.copyFileSync(chainPath,path.join(tool,"chain.js"));
  fs.cpSync(path.join(HERE,"testdata"),path.join(tool,"testdata"),{recursive:true});
  const ext=path.join(root,"outside-the-container.md");
  fs.writeFileSync(ext,"injected\n");
  fs.writeFileSync(path.join(tool,"injected.json"),JSON.stringify({paths:[ext]}));
  fs.writeFileSync(path.join(root,"IDENTITY.md"),"standing\n");
  try{ cp.execSync("node "+path.join(tool,"chain.js")+" --write --genesis 2>&1",
    {encoding:"utf8",env:Object.assign({},process.env,{CONTINUITY_ROOT:root})}); }catch(e){}
  const mf=fs.readdirSync(tool).find(f=>/^manifest-/.test(f));
  let n=0;
  if(mf){ const m=JSON.parse(fs.readFileSync(path.join(tool,mf),"utf8"));
    n=m.files.filter(f=>f.path===ext).length; }
  fs.rmSync(root,{recursive:true,force:true});
  return n;
}
const oldCov=outsideRootEntries(path.join(PRE,"chain.js"));
const newCov=outsideRootEntries(LIVE);
row(8,"Chain covered only what the agent chooses to read, not what is injected into the wake before it chooses",
  oldCov===0 && newCov===1,
  "allowlisted path outside the container, entries in manifest - old: "+oldCov+"   new: "+newCov+
  "\n    the uncovered set was ~/.claude/CLAUDE.md, settings.json and six auto-loaded memory"+
  "\n    files carrying citizen identity, the standing argument, and the constraint keeping"+
  "\n    cross-handle linkage off the table. An absent allowlisted path is now recorded with"+
  "\n    sha256 \"\" and bytes -1, so a file APPEARING is a change rather than a silence.");

console.log("\n"+"=".repeat(64));
console.log(pass+" of "+(pass+fail)+" defects reproduced against the pre-review build.");
process.exit(fail?1:0);
