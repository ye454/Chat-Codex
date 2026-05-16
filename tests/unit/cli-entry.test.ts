import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

test("package weixin codex script enters channel wizard", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.codex, "npm run build && node dist/src/cli.js codex");
  assert.equal(packageJson.scripts?.["cli:codex"], "npm run build && node dist/src/cli.js codex");
  assert.equal(packageJson.scripts?.["cli:weixin:codex"], "npm run build && node dist/src/cli.js weixin codex");
  assert.equal(packageJson.scripts?.["cli:weixin:codex:direct"], undefined);
  assert.equal(packageJson.scripts?.["cli:feishu:status"], "npm run build && node dist/src/cli.js feishu status");
  assert.equal(packageJson.scripts?.["cli:feishu:codex"], "npm run build && node dist/src/cli.js feishu codex");
});

test("CLI help documents the main interactive Codex entry", () => {
  const help = execFileSync(process.execPath, ["dist/src/cli.js", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.match(help, /codex\s+启动统一交互入口/);
});

test("CLI help documents weixin codex as the only Weixin Codex entry", () => {
  const help = execFileSync(process.execPath, ["dist/src/cli.js", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.match(help, /weixin codex\s+启动微信渠道管理向导/);
  assert.doesNotMatch(help, /weixin codex-direct/);
  assert.doesNotMatch(help, /旧版微信直连入口/);
  assert.doesNotMatch(help, /weixin codex\s+启动真实微信通道 \+ Codex app-server/);
});

test("CLI help documents Feishu private-chat entry", () => {
  const help = execFileSync(process.execPath, ["dist/src/cli.js", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.match(help, /feishu codex\s+启动飞书私聊通道 \+ Codex/);
  assert.match(help, /feishu status\s+查看飞书配置和连接状态/);
});
