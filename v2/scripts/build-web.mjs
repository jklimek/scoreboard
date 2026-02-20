import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const entries = [
  {
    entry: "apps/control-panel/src/main.ts",
    outdir: "apps/control-panel/public",
    outfile: "main.js",
  },
  {
    entry: "apps/commentator-hub/src/main.ts",
    outdir: "apps/commentator-hub/public",
    outfile: "main.js",
  },
  {
    entry: "apps/obs-views/src/main.ts",
    outdir: "apps/obs-views/public",
    outfile: "main.js",
  },
];

const commonConfig = {
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  platform: "browser",
  minify: false,
  logLevel: "info",
};

async function run() {
  if (watch) {
    const contexts = [];
    for (const item of entries) {
      const ctx = await context({
        ...commonConfig,
        entryPoints: [item.entry],
        outfile: `${item.outdir}/${item.outfile}`,
      });
      contexts.push(ctx);
      await ctx.watch();
    }
    console.log("Watching frontend bundles...");
    process.stdin.resume();
    return;
  }

  for (const item of entries) {
    await build({
      ...commonConfig,
      entryPoints: [item.entry],
      outfile: `${item.outdir}/${item.outfile}`,
    });
  }

  console.log("Web build complete.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
