import { spawnSync } from "node:child_process";
const commands = [
  ["run", "typecheck:libs"],
  [
    "--filter",
    "@workspace/api-server",
    "--filter",
    "@workspace/comp-dashboard",
    "run",
    "typecheck",
  ],
  ["test"],
  ["--filter", "@workspace/api-server", "run", "build"],
  ["--filter", "@workspace/comp-dashboard", "run", "build"],
];
for (const args of commands) {
  console.log(`Release check: pnpm ${args.join(" ")}`);
  const run = spawnSync("pnpm", args, {
    stdio: "inherit",
    env: { ...process.env, PORT: process.env.PORT ?? "4317", BASE_PATH: "/" },
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
console.log(
  "Code checks passed. Hosted authentication, production backup/migrations and live smoke tests are separate release gates.",
);
