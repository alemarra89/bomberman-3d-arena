import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");

function run(name, command, args) {
  const [executable, executableArgs] = normalizeCommand(command, args);

  const child = spawn(executable, executableArgs, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    windowsHide: true
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[${name}] stopped by ${signal}`);
      return;
    }

    if (code !== 0) {
      console.log(`[${name}] exited with code ${code}`);
      process.exitCode = code ?? 1;
    }
  });

  return child;
}

function normalizeCommand(command, args) {
  if (process.platform !== "win32" || !command.endsWith(".cmd")) {
    return [command, args];
  }

  return [process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "call", command, ...args]];
}

const api = run("api", process.execPath, ["server/api.mjs"]);
const client = run("client", process.execPath, [viteBin, "--host", "0.0.0.0"]);

function shutdown() {
  api.kill();
  client.kill();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
