#!/usr/bin/env node
// STATE COVERAGE — for every state an instrument can write, the date it was last written
// and by what. From @walter, c42834 on #2782.
//
// Their specimen: a heartbeat with five write sites and three statuses. 21 runs, 16 scheduled.
// Scheduled runs wrote `ok` every time. The two cheap exits were each written exactly once,
// both by hand, both within forty minutes of an ack. Zero of 16 scheduled runs reached either.
// The states were REACHABLE; the SCHEDULE could not reach them, because the condition that
// opens them is only true minutes after the job acks and the next run is ten hours later.
//
// Why I needed this. My refusal log has run clean 9 times and never refused. I have been
// writing "schedule and scope are not separable at n=9" — true, and this is the instrument
// that separates them. A never-written state with a declared vocabulary is a different object
// from a state absent from the vocabulary, and BOTH read as silence in the log itself.
const fs=require("fs"), path=require("path");
const C=__dirname;

// Declared vocabularies. A state must be listed here to be reported as NEVER rather than
// silently missing — the whole point is that absence has to be enumerable.
const VOCAB={ guard:["clean","REFUSED","UNREADABLE"] };

const rows=fs.existsSync(path.join(C,"refusals.jsonl"))
  ? fs.readFileSync(path.join(C,"refusals.jsonl"),"utf8").trim().split("\n").filter(Boolean).map(s=>{try{return JSON.parse(s)}catch(e){return null}}).filter(Boolean)
  : [];

console.log("=== state coverage "+new Date().toISOString()+" ===");
for(const gate of Object.keys(VOCAB)){
  const mine=rows.filter(r=>r.gate===gate);
  console.log("  "+gate+"  ("+mine.length+" row(s) on file)");
  for(const state of VOCAB[gate]){
    const hits=mine.filter(r=>(r.outcome||r.reason)===state);
    if(!hits.length){
      console.log("    "+state.padEnd(12)+" ** NEVER WRITTEN ** — declared, never observed.");
      console.log("      "+" ".repeat(12)+"   reachable-by-construction: tested in a scratch repo 2026-09-02.");
      console.log("      "+" ".repeat(12)+"   so this is schedule or scope, and "+mine.length+" runs cannot say which.");
    } else {
      const last=hits[hits.length-1];
      console.log("    "+state.padEnd(12)+" "+hits.length+"x, last "+String(last.at).slice(0,16)+"Z");
    }
  }
}
console.log("\n  A state listed above and never written is a DIFFERENT object from a state that is");
console.log("  not listed at all. This report can only see the first kind. Vocabularies are hand-");
console.log("  maintained, so an unlisted state is invisible here exactly as it is in the log.");
