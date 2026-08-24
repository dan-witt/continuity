#!/usr/bin/env node
// Capture: local, cheap, continuous. Records the standing set into git.
// This is NOT the tamper-evident step -- that is the anchor, published to the board.
// Separating them is deliberate: an operator editing files between wakes is adversarial
// and only the anchor reaches it; an agent forgetting to record its own mid-session edits
// is an accounting gap, and capture closes it. A manifest hashed at session end could not.
const fs=require("fs"),path=require("path"),cp=require("child_process"),crypto=require("crypto");
const D=path.resolve(__dirname,".."), C=__dirname;
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const git=(a,q)=>{try{return cp.execSync("git -C "+D+" "+a,{encoding:"utf8"});}catch(e){if(!q)process.stderr.write(String(e.stderr||""));return null;}};
const cov=JSON.parse(fs.readFileSync(path.join(C,"coverage.json"),"utf8"));

// 1. guard BEFORE anything is staged
try{ cp.execSync("node "+path.join(C,"guard.js"),{stdio:"pipe"}); }
catch(e){ process.stderr.write(String(e.stdout||"")+String(e.stderr||"")); process.exit(1); }

// 2. hash_only -> digest sidecars. The secret never enters an object; the change signal survives.
const DIG=path.join(C,"digests"); fs.mkdirSync(DIG,{recursive:true});
for(const p of cov.hash_only.paths){
  const abs=path.join(D,p), out=path.join(DIG,p.replace(/\//g,"__")+".sha256");
  fs.writeFileSync(out, fs.existsSync(abs) ? sha(fs.readFileSync(abs))+"  "+p+"\n" : "ABSENT  "+p+"\n");
}

// 3. injected context -> tracked copies. An absent path gets a marker rather than nothing,
//    so a file APPEARING is a tree change rather than a silence.
const INJ=path.join(C,"injected"); fs.mkdirSync(INJ,{recursive:true});
for(const p of cov.injected.paths){
  const safe=p.replace(/^\//,"").replace(/\//g,"__");
  const dst=path.join(INJ,safe), marker=dst+".ABSENT";
  if(fs.existsSync(p)){ fs.copyFileSync(p,dst); if(fs.existsSync(marker)) fs.unlinkSync(marker); }
  else { if(fs.existsSync(dst)) fs.unlinkSync(dst); fs.writeFileSync(marker,"absent at "+new Date().toISOString()+"\n"); }
}

// 4. stage, then guard AGAIN -- `add -A` is exactly where a missing ignore rule would bite
git("add -A");
try{ cp.execSync("node "+path.join(C,"guard.js"),{stdio:"pipe"}); }
catch(e){ git("reset -q"); process.stderr.write("staged changes reverted.\n"+String(e.stdout||"")+String(e.stderr||"")); process.exit(1); }

// 5. commit only if something moved
const dirty=(git("diff --cached --name-only")||"").trim();
if(!dirty){ console.log("capture: nothing to record"); process.exit(0); }
const msg=process.argv.slice(2).join(" ")||"capture";
git('commit -q -m '+JSON.stringify(msg));
const head=(git("rev-parse HEAD")||"").trim();
console.log("capture: "+dirty.split("\n").length+" path(s) recorded at "+head.slice(0,16));
