import { Worker } from "./index";
import { claimJob } from "./claim";

export async function runLoop() {
  const worker = new Worker({ mode: "mechanic" });

  while (true) {
    const claim = await claimJob("mechanic");
    if (!claim) {
      await sleep(500);
      continue;
    }

    const goal = claim.job.goal;
    await worker.handle(goal, {
      id: claim.job.id,
      traceId: crypto.randomUUID(),
      mode: "mechanic",
      repoPath: process.cwd()
    });
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
