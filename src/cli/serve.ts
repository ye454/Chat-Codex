import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { Bridge, type InitialRouteBinding, type ProgressDeliveryMode, type UnboundRoutePolicy } from "../bridge/bridge.js";
import { LimitedTurnScheduler } from "../bridge/turn-scheduler.js";
import { WeixinAdapter } from "../channels/weixin/weixin-adapter.js";
import { displayWeixinQrCode } from "../channels/weixin/weixin-qr-display.js";
import { AppServerCodexAdapter } from "../codex/app-server-codex-adapter.js";
import {
  checkCodexCli,
  discoverCodexSessions,
  findCodexSessionById,
  formatCodexSessionTitleForDisplay,
  type CodexPermissionMode,
  type CodexRunPolicy,
  type DiscoveredCodexSession,
} from "../codex/codex-cli.js";
import { ExecCodexAdapter } from "../codex/exec-codex-adapter.js";
import type { CodexAdapter } from "../codex/types.js";
import { resolveNewSessionWorkdir } from "../codex/workdir.js";
import { ConsoleLogger } from "../logging/logger.js";
import { ConsoleTranscriptSink } from "../logging/transcript.js";
import type { ChannelStatus } from "../protocol/channel.js";
import {
  formatAdapterModeForUser,
  formatChannelCapabilities,
  formatChannelManagementMenu,
  formatChannelStateForUser,
  formatChannelStatusDetails,
  formatCodexSettingsMenu,
  formatFirstRouteBindingMenu,
  formatFirstRoutePresetForUser,
  formatMaxConcurrentTurnsForUser,
  formatPermissionModeForUser,
  formatProgressModeForUser,
  formatRouteBindingMenu,
  formatServeHomeSummary,
  formatStartConfirmation,
  formatUnboundRoutePolicyForUser,
  formatUnboundRoutePolicyMenu,
  parseChannelManageChoice,
  parseCodexSettingsChoice,
  parseFirstRouteSetupChoice,
  parseRouteManageChoice,
  parseServeHomeChoice,
  parseUnboundRoutePolicyChoice,
  type FirstRouteBindingChoice,
  type ServeChannelSummary,
  type ServeRouteSummary,
} from "./serve-wizard.js";

export interface ServeStartupOptions {
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

interface PreparedServeStartup {
  policy: CodexRunPolicy;
  adapterMode: RealCodexAdapterMode;
  cwd: string;
  progressMode?: ProgressDeliveryMode;
  maxConcurrentTurns?: number;
}

interface ServeChannelPlan {
  status: ChannelStatus;
  unboundRoutePolicy: UnboundRoutePolicy;
  initialRouteBinding?: InitialRouteBinding;
  initialSessionId?: string;
  initialSessionTitle?: string;
  firstRouteBindingChoice?: FirstRouteBindingChoice;
}

export async function runServe(options: ServeStartupOptions = {}): Promise<void> {
  const interactive = Boolean(stdin.isTTY && stdout.isTTY && !options.noInteractive);
  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : undefined;
  let startup: PreparedServeStartup | undefined;
  let plan: ServeChannelPlan | undefined;
  try {
    startup = await prepareCodexServeStartup(options, rl);
    const setupChannel = new WeixinAdapter({
      pollOnStart: false,
      verifyCodeProvider: rl ? questionWithReadline(rl) : undefined,
    });
    await setupChannel.start();
    plan = createInitialChannelPlan(await setupChannel.getStatus(), options);
    if (interactive) {
      const shouldStart = await runServeHomeLoop(rl as Interface, startup, plan, setupChannel);
      if (!shouldStart) return;
    } else if (plan.status.state !== "connected") {
      throw new Error("未发现可启动的微信渠道。请先在交互式终端运行 npm run cli:weixin:codex 完成微信登录，或运行 npm run cli:weixin:login。");
    }
  } finally {
    rl?.close();
  }
  if (!startup || !plan) return;
  await startServeBridge(startup, plan);
}

async function prepareCodexServeStartup(options: ServeStartupOptions, rl?: Interface): Promise<PreparedServeStartup> {
  const status = await checkCodexCli();
  if (!status.available) {
    throw new Error(`Codex 不可用: ${status.error ?? "unknown error"}`);
  }
  console.log("");
  console.log("Codex 已就绪");
  console.log(`- CLI: ${status.version ?? status.codexBin}`);

  const adapterMode = options.codexAdapter ?? "app-server";
  const cwd = await resolveStartupWorkdir(options);
  const permissionMode = options.permission ?? "approval";
  if (permissionMode === "full") {
    await confirmFullPermission(rl, Boolean(options.yesDangerouslyFull));
  }
  const policy: CodexRunPolicy = {
    permissionMode,
    sandbox: permissionMode === "approval" ? "workspace-write" : undefined,
  };
  return {
    policy,
    adapterMode,
    cwd,
    progressMode: options.progressMode,
    maxConcurrentTurns: options.maxConcurrentTurns,
  };
}

async function resolveStartupWorkdir(options: ServeStartupOptions): Promise<string> {
  const resolved = resolveNewSessionWorkdir(options.cwd, process.cwd());
  if (resolved.created) {
    console.log(`工作目录不存在，已创建: ${resolved.cwd}`);
  }
  return resolved.cwd;
}

async function confirmFullPermission(rl: Interface | undefined, alreadyConfirmed: boolean): Promise<void> {
  const warning = "警告：完全权限会让 Codex 跳过审批和沙箱，能够直接执行命令并修改文件。只有在你完全信任当前任务时才继续。";
  console.log(warning);
  if (alreadyConfirmed) return;
  if (!rl) throw new Error("完全权限需要交互确认，或传入 --yes-dangerously-full");
  const answer = await rl.question("如确认继续，请输入 YES: ");
  if (answer.trim() !== "YES") {
    throw new Error("已取消完全权限启动");
  }
}

function createInitialChannelPlan(status: ChannelStatus, options: ServeStartupOptions): ServeChannelPlan {
  const plan: ServeChannelPlan = {
    status,
    unboundRoutePolicy: "auto_new",
  };
  if (!options.session) return plan;
  if (options.session === "new") {
    setFirstRouteNew(plan);
    return plan;
  }
  const session = options.session === "last"
    ? discoverCodexSessions({ limit: 1 })[0]
    : findCodexSessionById(options.session);
  if (!session) {
    throw new Error(`未找到 --session 指定的 Codex session: ${options.session}`);
  }
  setFirstRouteExisting(plan, session.id, session);
  return plan;
}

async function runServeHomeLoop(
  rl: Interface,
  startup: PreparedServeStartup,
  plan: ServeChannelPlan,
  channel: WeixinAdapter,
): Promise<boolean> {
  for (;;) {
    plan.status = await channel.getStatus();
    console.log("");
    console.log(formatServeHomeSummary({
      codex: codexSummary(startup),
      channels: [weixinChannelSummary(plan.status)],
      routes: routeSummary(plan),
    }));
    const choice = parseServeHomeChoice(await rl.question("请选择 [5]: "));
    if (choice === "exit") return false;
    if (choice === "manage_channels") {
      await runChannelManagementLoop(rl, plan, channel);
      continue;
    }
    if (choice === "manage_routes") {
      await runRouteBindingLoop(rl, plan);
      continue;
    }
    if (choice === "codex_settings") {
      await runCodexSettingsLoop(rl, startup);
      continue;
    }
    if (choice === "status") {
      await printChannelStatus(plan, channel);
      continue;
    }
    if (await confirmStart(rl, startup, plan)) return true;
  }
}

async function runChannelManagementLoop(rl: Interface, plan: ServeChannelPlan, channel: WeixinAdapter): Promise<void> {
  for (;;) {
    plan.status = await channel.getStatus();
    console.log("");
    console.log(formatChannelManagementMenu(weixinChannelSummary(plan.status)));
    const choice = parseChannelManageChoice(await rl.question("请选择 [1]: "));
    if (choice === "back") return;
    if (choice === "status") {
      await printChannelStatus(plan, channel);
      continue;
    }
    if (choice === "add") {
      console.log("");
      console.log("当前版本只支持微信渠道；飞书等第二渠道会在后续适配。");
      continue;
    }
    await loginWeixinChannel(plan, channel);
  }
}

async function loginWeixinChannel(plan: ServeChannelPlan, channel: WeixinAdapter): Promise<void> {
  console.log("");
  console.log("微信扫码登录");
  console.log(formatChannelCapabilities(channel.getCapabilities()));
  try {
    const started = await channel.startLogin();
    console.log(started.message);
    if (started.qrCodeText) {
      await displayWeixinQrCode(started.qrCodeText);
    }
    const loginResult = await channel.waitLogin(started.sessionKey);
    console.log(loginResult.message);
    plan.status = await channel.getStatus();
    if (loginResult.state !== "connected") {
      console.log("微信登录未完成，可以稍后重新进入“管理渠道”重试。");
    }
  } catch (error) {
    console.log(`微信登录失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function printChannelStatus(plan: ServeChannelPlan, channel: WeixinAdapter): Promise<void> {
  plan.status = await channel.getStatus();
  console.log("");
  console.log(formatChannelStatusDetails(plan.status, channel.getCapabilities()));
}

async function runRouteBindingLoop(rl: Interface, plan: ServeChannelPlan): Promise<void> {
  for (;;) {
    console.log("");
    console.log(formatRouteBindingMenu(routeSummary(plan)));
    const choice = parseRouteManageChoice(await rl.question("请选择 [1]: "));
    if (choice === "back") return;
    if (choice === "policy") {
      await configureUnboundRoutePolicy(rl, plan);
      continue;
    }
    if (choice === "first_route") {
      await configureFirstRouteBinding(rl, plan);
      continue;
    }
    console.log("");
    console.log([
      "当前聊天绑定",
      "- 启动前不会把整个微信账号绑定到一个 Codex session。",
      "- 每个微信聊天会在第一次发消息时按策略创建或切换 session。",
      `- 新聊天策略: ${formatUnboundRoutePolicyForUser(plan.unboundRoutePolicy)}`,
      `- 首个微信私聊: ${formatFirstRoutePresetForUser(plan.firstRouteBindingChoice, plan.initialSessionId, plan.initialSessionTitle)}`,
    ].join("\n"));
  }
}

async function configureUnboundRoutePolicy(rl: Interface, plan: ServeChannelPlan): Promise<void> {
  console.log("");
  console.log(formatUnboundRoutePolicyMenu(plan.unboundRoutePolicy));
  const answer = await rl.question("请选择 [0 返回]: ");
  if (!answer.trim()) return;
  const choice = parseUnboundRoutePolicyChoice(answer);
  if (choice === "back") return;
  plan.unboundRoutePolicy = choice;
  console.log(`已设置新聊天策略: ${formatUnboundRoutePolicyForUser(plan.unboundRoutePolicy)}`);
}

async function configureFirstRouteBinding(rl: Interface, plan: ServeChannelPlan): Promise<void> {
  console.log("");
  console.log(formatFirstRouteBindingMenu(routeSummary(plan)));
  const answer = await rl.question("请选择 [0 返回]: ");
  if (!answer.trim()) return;
  const choice = parseFirstRouteSetupChoice(answer);
  if (choice === "back") return;
  if (choice === "none") {
    clearFirstRouteBinding(plan);
    console.log("已取消首个微信私聊预设绑定。");
    return;
  }
  if (choice === "new_first_route") {
    setFirstRouteNew(plan);
    console.log("已设置：启动后第一个微信私聊创建新 session。");
    return;
  }
  const selected = await selectExistingSessionForFirstRoute(rl);
  if (!selected) return;
  setFirstRouteExisting(plan, selected.sessionId, selected.session);
  console.log(`已设置首个微信私聊绑定: ${formatFirstRoutePresetForUser(plan.firstRouteBindingChoice, plan.initialSessionId, plan.initialSessionTitle)}`);
}

async function selectExistingSessionForFirstRoute(rl: Interface): Promise<{ sessionId: string; session?: DiscoveredCodexSession } | undefined> {
  const sessions = discoverCodexSessions({ limit: 15 });
  for (;;) {
    console.log("");
    console.log("选择已有 Codex session");
    if (sessions.length === 0) {
      console.log("未发现历史 session。可以粘贴本机存在的 Session ID，或输入 0 返回。");
    } else {
      sessions.forEach((session, index) => {
        console.log(formatSessionChoice(index + 1, session));
      });
    }
    const answer = (await rl.question("请选择编号或输入 Session ID [0 返回]: ")).trim();
    if (!answer || answer === "0" || isBackText(answer)) return undefined;
    if (/^\d+$/.test(answer)) {
      const index = Number.parseInt(answer, 10);
      const session = sessions[index - 1];
      if (session) return { sessionId: session.id, session };
      console.log(`没有第 ${index} 项，请重新选择。`);
      continue;
    }
    const session = sessions.find((item) => item.id === answer) ?? findCodexSessionById(answer);
    if (session) return { sessionId: session.id, session };
    console.log("没有找到这个 session。请重新输入编号或有效 Session ID；输入 0 返回。");
  }
}

async function runCodexSettingsLoop(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  for (;;) {
    console.log("");
    console.log(formatCodexSettingsMenu({
      ...codexSummary(startup),
      cwd: startup.cwd,
    }));
    const choice = parseCodexSettingsChoice(await rl.question("请选择 [1]: "));
    if (choice === "back") return;
    if (choice === "adapter") {
      await configureAdapterMode(rl, startup);
      continue;
    }
    if (choice === "permission") {
      await configurePermissionMode(rl, startup);
      continue;
    }
    if (choice === "workdir") {
      await configureWorkdir(rl, startup);
      continue;
    }
    await configureMaxConcurrentTurns(rl, startup);
  }
}

async function configureAdapterMode(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  console.log("");
  console.log([
    "Codex 接入方式",
    `当前: ${formatAdapterModeForUser(startup.adapterMode)}`,
    "",
    "1. Codex app-server（推荐，支持微信审批）",
    "2. Codex exec（备用模式）",
    "0. 返回",
  ].join("\n"));
  const answer = normalizeText(await rl.question("请选择 [0 返回]: "));
  if (!answer || answer === "0" || isBackText(answer)) return;
  if (answer === "1" || answer === "app-server") {
    startup.adapterMode = "app-server";
    console.log("已设置 Codex 接入方式: app-server");
    return;
  }
  if (answer === "2" || answer === "exec") {
    startup.adapterMode = "exec";
    console.log("已设置 Codex 接入方式: exec");
    return;
  }
  console.log("未识别选择，保持原设置。");
}

async function configurePermissionMode(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  console.log("");
  console.log([
    "Codex 权限模式",
    `当前: ${formatPolicyForCli(startup.policy)}`,
    "",
    "1. 审批模式（workspace-write 沙箱，推荐）",
    "2. 完全权限（跳过审批和沙箱，高风险）",
    "0. 返回",
  ].join("\n"));
  const answer = normalizeText(await rl.question("请选择 [0 返回]: "));
  if (!answer || answer === "0" || isBackText(answer)) return;
  if (answer === "2" || answer === "full") {
    try {
      await confirmFullPermission(rl, false);
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
      return;
    }
    startup.policy = { permissionMode: "full" };
    console.log("已设置权限模式: 完全权限");
    return;
  }
  startup.policy = { permissionMode: "approval", sandbox: "workspace-write" };
  console.log("已设置权限模式: 审批模式");
}

async function configureWorkdir(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  console.log("");
  console.log(`当前新 session 工作目录: ${startup.cwd}`);
  const answer = (await rl.question("请输入新目录路径 [留空保持，0 返回]: ")).trim();
  if (!answer || answer === "0" || isBackText(answer)) return;
  try {
    const resolved = resolveNewSessionWorkdir(answer, process.cwd());
    startup.cwd = resolved.cwd;
    console.log(`${resolved.created ? "已创建并设置" : "已设置"}新 session 工作目录: ${startup.cwd}`);
  } catch (error) {
    console.log(`工作目录设置失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function configureMaxConcurrentTurns(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  console.log("");
  console.log(`当前并发上限: ${formatMaxConcurrentTurnsForUser(startup.maxConcurrentTurns)}`);
  const answer = (await rl.question("请输入正整数；留空表示不限制；输入 0 返回: ")).trim();
  if (answer === "0" || isBackText(answer)) return;
  if (!answer) {
    startup.maxConcurrentTurns = undefined;
    console.log("已设置并发上限: 不限制不同聊天并行");
    return;
  }
  const parsed = Number.parseInt(answer, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || !/^\d+$/.test(answer)) {
    console.log("并发上限需要正整数，或留空表示不限制。");
    return;
  }
  startup.maxConcurrentTurns = parsed;
  console.log(`已设置并发上限: ${formatMaxConcurrentTurnsForUser(startup.maxConcurrentTurns)}`);
}

async function confirmStart(rl: Interface, startup: PreparedServeStartup, plan: ServeChannelPlan): Promise<boolean> {
  if (plan.status.state !== "connected") {
    console.log("");
    console.log("微信还没有连接。请先进入“管理渠道”完成扫码登录，再启动服务。");
    return false;
  }
  console.log("");
  console.log(formatStartConfirmation({
    codex: {
      ...codexSummary(startup),
      cwd: startup.cwd,
    },
    channel: weixinChannelSummary(plan.status),
    routes: routeSummary(plan),
  }));
  const answer = normalizeText(await rl.question("请选择 [1]: "));
  return !answer || answer === "1" || answer === "start" || answer === "启动";
}

function setFirstRouteExisting(plan: ServeChannelPlan, sessionId: string, session?: DiscoveredCodexSession): void {
  plan.firstRouteBindingChoice = "bind_existing_first_route";
  plan.initialRouteBinding = { type: "existing", sessionId };
  plan.initialSessionId = sessionId;
  plan.initialSessionTitle = session ? formatCodexSessionTitleForDisplay(session) : undefined;
}

function setFirstRouteNew(plan: ServeChannelPlan): void {
  plan.firstRouteBindingChoice = "new_first_route";
  plan.initialRouteBinding = { type: "new" };
  plan.initialSessionId = undefined;
  plan.initialSessionTitle = undefined;
}

function clearFirstRouteBinding(plan: ServeChannelPlan): void {
  plan.firstRouteBindingChoice = undefined;
  plan.initialRouteBinding = undefined;
  plan.initialSessionId = undefined;
  plan.initialSessionTitle = undefined;
}

function codexSummary(startup: PreparedServeStartup) {
  return {
    adapterMode: startup.adapterMode,
    permissionMode: startup.policy.permissionMode,
    progressMode: startup.progressMode,
    progressDisabled: true,
    maxConcurrentTurns: startup.maxConcurrentTurns,
  };
}

function routeSummary(plan: ServeChannelPlan): ServeRouteSummary {
  return {
    known: 0,
    bound: 0,
    unboundPolicy: plan.unboundRoutePolicy,
    firstRouteBindingChoice: plan.firstRouteBindingChoice,
    initialSessionId: plan.initialSessionId,
    initialSessionTitle: plan.initialSessionTitle,
  };
}

function weixinChannelSummary(status: ChannelStatus): ServeChannelSummary {
  return {
    id: status.channelId,
    type: "weixin",
    enabled: true,
    status,
    capabilities: new WeixinAdapter({ pollOnStart: false }).getCapabilities(),
  };
}

async function startServeBridge(startup: PreparedServeStartup, plan: ServeChannelPlan): Promise<void> {
  const channel = new WeixinAdapter({ verifyCodeProvider: askStdin });
  const codex = createRealCodexAdapter(startup);
  const bridge = new Bridge({
    channel,
    codex,
    logger: new ConsoleLogger(false),
    transcript: new ConsoleTranscriptSink(),
    cwd: startup.cwd,
    initialRouteBinding: plan.initialRouteBinding,
    unboundRoutePolicy: plan.unboundRoutePolicy,
    progressMode: startup.progressMode,
    turnScheduler: startup.maxConcurrentTurns ? new LimitedTurnScheduler(startup.maxConcurrentTurns) : undefined,
  });

  await bridge.start();
  printRuntimeSummary("多渠道 Codex 中间件", startup, { progressDisabled: true });
  console.log(`- 微信渠道: ${formatChannelStateForUser(plan.status.state)}${plan.status.account ? `，账号 ${plan.status.account}` : ""}`);
  console.log(`- 新聊天策略: ${formatUnboundRoutePolicyForUser(plan.unboundRoutePolicy)}`);
  console.log(`- 首个微信私聊: ${formatFirstRoutePresetForUser(plan.firstRouteBindingChoice, plan.initialSessionId, plan.initialSessionTitle)}`);
  await waitForShutdownSignal();
  await bridge.stop();
}

async function askStdin(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

function questionWithReadline(rl: Interface): (prompt: string) => Promise<string> {
  return async (prompt: string) => (await rl.question(prompt)).trim();
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

function printRuntimeSummary(
  title: string,
  startup: PreparedServeStartup,
  display: { progressDisabled?: boolean } = {},
): void {
  console.log("");
  console.log(`${title}已启动`);
  console.log("- 会话: 按微信聊天分别绑定；首条消息按策略处理");
  console.log(`- 工作目录: ${startup.cwd}`);
  console.log(`- Codex 接入: ${formatAdapterModeForUser(startup.adapterMode)}`);
  console.log(`- 权限模式: ${formatPolicyForCli(startup.policy)}`);
  console.log(`- 阶段进度: ${formatProgressModeForUser(startup.progressMode, display.progressDisabled)}`);
  console.log(`- 并发上限: ${formatMaxConcurrentTurnsForUser(startup.maxConcurrentTurns)}`);
  console.log("- 退出: Ctrl+C");
}

function formatSessionChoice(index: number, session: DiscoveredCodexSession): string {
  const title = formatCodexSessionTitleForDisplay(session);
  const parts = [`${index}. ${title ?? session.id}`];
  parts.push(`   Session ID: ${session.id}`);
  if (session.updatedAt) parts.push(`   最近更新: ${session.updatedAt}`);
  if (session.cwd) parts.push(`   工作目录: ${session.cwd}`);
  return parts.join("\n");
}

function formatPolicyForCli(policy: CodexRunPolicy): string {
  if (policy.permissionMode === "full") return formatPermissionModeForUser(policy.permissionMode);
  return `审批模式（${policy.sandbox ?? "workspace-write"} 沙箱，推荐）`;
}

function createRealCodexAdapter(startup: PreparedServeStartup): CodexAdapter {
  const runPolicy = startup.policy;
  if (startup.adapterMode === "exec") {
    return new ExecCodexAdapter({ runPolicy });
  }
  return new AppServerCodexAdapter({ runPolicy });
}

function normalizeText(input: string): string {
  return input.trim().toLowerCase();
}

function isBackText(input: string): boolean {
  const normalized = normalizeText(input);
  return normalized === "0" || normalized === "back" || normalized === "返回" || normalized === "q" || normalized === "quit";
}
