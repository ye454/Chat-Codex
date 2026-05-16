import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { Bridge, type InitialRouteBinding, type ProgressDeliveryMode, type UnboundRoutePolicy } from "../bridge/bridge.js";
import { LimitedTurnScheduler } from "../bridge/turn-scheduler.js";
import { FeishuAdapter } from "../channels/feishu/feishu-adapter.js";
import {
  DEFAULT_FEISHU_ACCOUNT_ID,
  DEFAULT_FEISHU_DOMAIN,
  loadFeishuCredentialsFromEnv,
  missingFeishuCredentials,
  normalizeFeishuCredentials,
} from "../channels/feishu/feishu-message.js";
import type { FeishuCredentials } from "../channels/feishu/feishu-types.js";
import { AppServerCodexAdapter } from "../codex/app-server-codex-adapter.js";
import {
  checkCodexCli,
  discoverCodexSessions,
  findCodexSessionById,
  formatCodexSessionTitleForDisplay,
  type CodexPermissionMode,
  type CodexRunPolicy,
} from "../codex/codex-cli.js";
import { ExecCodexAdapter } from "../codex/exec-codex-adapter.js";
import type { CodexAdapter } from "../codex/types.js";
import { resolveNewSessionWorkdir } from "../codex/workdir.js";
import { ConsoleLogger } from "../logging/logger.js";
import { ConsoleTranscriptSink } from "../logging/transcript.js";
import { formatChannelStateForUser, formatChannelStatusDetails, formatPermissionModeForUser, formatProgressModeForUser } from "./serve-wizard.js";

export interface FeishuCliOptions {
  session?: string;
  permission?: CodexPermissionMode;
  codexAdapter?: RealCodexAdapterMode;
  yesDangerouslyFull?: boolean;
  cwd?: string;
  progressMode?: ProgressDeliveryMode;
  maxConcurrentTurns?: number;
  noInteractive?: boolean;
}

type RealCodexAdapterMode = "app-server" | "exec";

interface PreparedFeishuStartup {
  policy: CodexRunPolicy;
  adapterMode: RealCodexAdapterMode;
  cwd: string;
  progressMode?: ProgressDeliveryMode;
  maxConcurrentTurns?: number;
  initialRouteBinding?: InitialRouteBinding;
  unboundRoutePolicy: UnboundRoutePolicy;
  initialSessionId?: string;
  initialSessionTitle?: string;
}

export async function runFeishuStatus(): Promise<void> {
  const credentials = normalizeFeishuCredentials(loadFeishuCredentialsFromEnv());
  const adapter = new FeishuAdapter({
    ...credentials,
    connectOnStart: false,
  });
  await adapter.start();
  console.log(formatChannelStatusDetails(await adapter.getStatus(), adapter.getCapabilities()));
}

export async function runFeishuCodex(options: FeishuCliOptions = {}): Promise<void> {
  const interactive = Boolean(stdin.isTTY && stdout.isTTY && !options.noInteractive);
  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : undefined;
  let credentials: FeishuCredentials;
  let startup: PreparedFeishuStartup;
  try {
    credentials = await resolveFeishuCredentials(rl);
    const setupAdapter = new FeishuAdapter({ ...credentials, connectOnStart: false });
    await setupAdapter.start();
    const setupStatus = await setupAdapter.getStatus();
    if (setupStatus.state !== "connected") {
      throw new Error(setupStatus.lastError ?? "飞书配置检查失败，请确认 App ID、App Secret、机器人能力和权限。");
    }
    console.log("");
    console.log(formatChannelStatusDetails(setupStatus, setupAdapter.getCapabilities()));
    startup = await prepareFeishuStartup(options, rl);
  } finally {
    rl?.close();
  }
  await startFeishuBridge(credentials, startup);
}

async function resolveFeishuCredentials(rl?: Interface): Promise<FeishuCredentials> {
  let credentials = normalizeFeishuCredentials(loadFeishuCredentialsFromEnv());
  const missing = missingFeishuCredentials(credentials);
  if (missing.length === 0 || !rl) {
    if (missing.length > 0) {
      throw new Error([
        `缺少飞书配置: ${missing.join(", ")}`,
        "可以把变量写入本机 secrets/feishu.local.md，然后在启动前导出到环境变量；secrets/ 不会提交。",
      ].join("\n"));
    }
    return credentials;
  }
  console.log("");
  console.log("飞书渠道配置");
  console.log("- 当前阶段只启用私聊文本消息。");
  console.log("- App Secret 只用于本次进程，不会写入仓库。推荐长期放在本机 secrets/feishu.local.md 并导出环境变量。");
  const appId = credentials.appId ?? await askRequired(rl, "请输入 FEISHU_APP_ID: ");
  const appSecret = credentials.appSecret ?? await askRequired(rl, "请输入 FEISHU_APP_SECRET（输入会显示在终端）: ");
  const domain = await askOptional(rl, `飞书域 [${credentials.domain ?? DEFAULT_FEISHU_DOMAIN}]: `, credentials.domain ?? DEFAULT_FEISHU_DOMAIN);
  const accountId = await askOptional(rl, `账号标识 [${credentials.accountId ?? DEFAULT_FEISHU_ACCOUNT_ID}]: `, credentials.accountId ?? DEFAULT_FEISHU_ACCOUNT_ID);
  credentials = normalizeFeishuCredentials({
    ...credentials,
    appId,
    appSecret,
    domain,
    accountId,
  });
  return credentials;
}

async function prepareFeishuStartup(options: FeishuCliOptions, rl?: Interface): Promise<PreparedFeishuStartup> {
  const status = await checkCodexCli();
  if (!status.available) {
    throw new Error(`Codex 不可用: ${status.error ?? "unknown error"}`);
  }
  console.log("");
  console.log("Codex 已就绪");
  console.log(`- CLI: ${status.version ?? status.codexBin}`);
  const adapterMode = options.codexAdapter ?? "app-server";
  const cwd = resolveStartupWorkdir(options.cwd);
  const permissionMode = options.permission ?? "approval";
  if (permissionMode === "full") {
    await confirmFullPermission(rl, Boolean(options.yesDangerouslyFull));
  }
  const firstRoute = resolveInitialRouteBinding(options.session);
  return {
    policy: {
      permissionMode,
      sandbox: permissionMode === "approval" ? "workspace-write" : undefined,
    },
    adapterMode,
    cwd,
    progressMode: options.progressMode,
    maxConcurrentTurns: options.maxConcurrentTurns,
    unboundRoutePolicy: "auto_new",
    ...firstRoute,
  };
}

function resolveStartupWorkdir(input: string | undefined): string {
  const resolved = resolveNewSessionWorkdir(input, process.cwd());
  if (resolved.created) {
    console.log(`工作目录不存在，已创建: ${resolved.cwd}`);
  }
  return resolved.cwd;
}

function resolveInitialRouteBinding(sessionRef: string | undefined): Pick<PreparedFeishuStartup, "initialRouteBinding" | "initialSessionId" | "initialSessionTitle"> {
  if (!sessionRef) return {};
  if (sessionRef === "new") {
    return {
      initialRouteBinding: { type: "new" },
    };
  }
  const session = sessionRef === "last"
    ? discoverCodexSessions({ limit: 1 })[0]
    : findCodexSessionById(sessionRef);
  if (!session) {
    throw new Error(`未找到 --session 指定的 Codex session: ${sessionRef}`);
  }
  return {
    initialRouteBinding: { type: "existing", sessionId: session.id },
    initialSessionId: session.id,
    initialSessionTitle: formatCodexSessionTitleForDisplay(session),
  };
}

async function startFeishuBridge(credentials: FeishuCredentials, startup: PreparedFeishuStartup): Promise<void> {
  const channel = new FeishuAdapter(credentials);
  const codex = createRealCodexAdapter(startup);
  const bridge = new Bridge({
    channel,
    codex,
    logger: new ConsoleLogger(false),
    transcript: new ConsoleTranscriptSink(),
    cwd: startup.cwd,
    initialRouteBinding: startup.initialRouteBinding,
    unboundRoutePolicy: startup.unboundRoutePolicy,
    progressMode: startup.progressMode,
    turnScheduler: startup.maxConcurrentTurns ? new LimitedTurnScheduler(startup.maxConcurrentTurns) : undefined,
  });
  await bridge.start();
  const status = await channel.getStatus();
  console.log("");
  console.log("飞书 Codex 中间件已启动");
  console.log("- 会话: 按飞书私聊分别绑定；首条消息自动创建新 session");
  if (startup.initialSessionId) {
    console.log(`- 首个飞书私聊: 绑定 ${startup.initialSessionTitle ?? startup.initialSessionId}`);
  } else if (startup.initialRouteBinding?.type === "new") {
    console.log("- 首个飞书私聊: 创建新 session");
  }
  console.log(`- 飞书渠道: ${formatChannelStateForUser(status.state)}${status.account ? `，账号 ${status.account}` : ""}`);
  console.log(`- 工作目录: ${startup.cwd}`);
  console.log(`- Codex 接入: ${formatAdapterForCli(startup.adapterMode)}`);
  console.log(`- 权限模式: ${formatPolicyForCli(startup.policy)}`);
  console.log(`- 阶段进度: ${formatProgressModeForUser(startup.progressMode)}`);
  console.log(`- 并发上限: ${startup.maxConcurrentTurns ? `${startup.maxConcurrentTurns} 个任务` : "不限制不同聊天并行"}`);
  console.log("- 退出: Ctrl+C");
  await waitForShutdownSignal();
  await bridge.stop();
}

function createRealCodexAdapter(startup: PreparedFeishuStartup): CodexAdapter {
  if (startup.adapterMode === "exec") {
    return new ExecCodexAdapter({ runPolicy: startup.policy });
  }
  return new AppServerCodexAdapter({ runPolicy: startup.policy });
}

async function askRequired(rl: Interface, prompt: string): Promise<string> {
  for (;;) {
    const answer = (await rl.question(prompt)).trim();
    if (answer) return answer;
    console.log("不能为空，请重新输入。");
  }
}

async function askOptional(rl: Interface, prompt: string, fallback: string): Promise<string> {
  const answer = (await rl.question(prompt)).trim();
  return answer || fallback;
}

async function confirmFullPermission(rl: Interface | undefined, alreadyConfirmed: boolean): Promise<void> {
  console.log("警告：完全权限会让 Codex 跳过审批和沙箱，能够直接执行命令并修改文件。只有在你完全信任当前任务时才继续。");
  if (alreadyConfirmed) return;
  if (!rl) throw new Error("完全权限需要交互确认，或传入 --yes-dangerously-full");
  const answer = await rl.question("如确认继续，请输入 YES: ");
  if (answer.trim() !== "YES") {
    throw new Error("已取消完全权限启动");
  }
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

function formatPolicyForCli(policy: CodexRunPolicy): string {
  if (policy.permissionMode === "full") return formatPermissionModeForUser(policy.permissionMode);
  return `审批模式（${policy.sandbox ?? "workspace-write"} 沙箱，推荐）`;
}

function formatAdapterForCli(adapterMode: RealCodexAdapterMode): string {
  if (adapterMode === "app-server") return "Codex app-server（推荐，支持在飞书里处理审批）";
  return "Codex exec（备用模式，不支持飞书交互审批）";
}
