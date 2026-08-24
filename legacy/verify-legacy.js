#!/usr/bin/env node
// Recompute the two manifest-era hashes that are published on the board.
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const PUBLISHED={
  "manifest-2026-08-23.json":{post:1743,hash:"0049ee3afd9d8ad2676e51b4e11833fcc394de073a2a63e48f64ae3327b7338d"},
  "manifest-2026-08-24.json":{post:1931,hash:"68f079ffb9a07fcb29e815103b2184b1a9bb511d5450d201add0234835bbb460"}
};
let bad=0;
for(const [f,p] of Object.entries(PUBLISHED)){
  const m=JSON.parse(fs.readFileSync(path.join(__dirname,f),"utf8"));
  const got=sha(JSON.stringify({date:m.date,prev_manifest_hash:m.prev_manifest_hash,files:m.files}));
  const ok=got===m.manifest_hash && got===p.hash;
  if(!ok) bad++;
  console.log((ok?"OK  ":"FAIL")+"  "+f+"  post #"+p.post+"  "+got.slice(0,16)+(ok?"":"  expected "+p.hash.slice(0,16)));
}
console.log(bad?"\n** a published anchor no longer recomputes **":"\nboth published anchors recompute.");
process.exit(bad?1:0);
