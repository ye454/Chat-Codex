import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { ChatCodexTui } from "../../src/cli/tui/app.js";
import type { LauncherActions, LauncherDashboard } from "../../src/cli/actions/launcher-actions.js";

test("Ink TUI renders dashboard and navigates to core pages", async () => {
  const actions = mockActions(dashboardFixture());
  const view = render(<ChatCodexTui actions={actions} onDone={() => undefined} />);
  await waitForInk();

  assert.match(view.lastFrame() ?? "", /Chat Codex/);
  assert.match(view.lastFrame() ?? "", /渠道/);
  assert.match(view.lastFrame() ?? "", /聊天绑定/);
  assert.match(view.lastFrame() ?? "", /权限/);

  view.stdin.write("c");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /管理渠道/);
  assert.match(view.lastFrame() ?? "", /w 微信/);
  assert.match(view.lastFrame() ?? "", /f 飞书/);

  view.stdin.write("\u001B");
  await waitForInk();
  view.stdin.write("b");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /聊天绑定/);
  assert.match(view.lastFrame() ?? "", /飞书 \/ default \/ 张三/);
  assert.match(view.lastFrame() ?? "", /微信 \/ wx-main \/ 主聊天/);
  assert.match(view.lastFrame() ?? "", /待生效/);

  view.stdin.write("\u001B");
  await waitForInk();
  view.stdin.write("p");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /默认权限设置/);
  assert.match(view.lastFrame() ?? "", /审批模式/);

  view.unmount();
});

test("Ink TUI handles help, Feishu form back, and start confirmation", async () => {
  let result: { start: boolean } | undefined;
  const view = render(<ChatCodexTui actions={mockActions(dashboardFixture())} onDone={(next) => { result = next; }} />);
  await waitForInk();

  view.stdin.write("?");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /快捷键/);

  view.stdin.write("\r");
  await waitForInk();
  view.stdin.write("f");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /添加飞书机器人/);
  view.stdin.write("\u001B");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /管理渠道/);

  view.stdin.write("\u001B");
  await waitForInk();
  view.stdin.write("\r");
  await waitForInk();
  assert.match(view.lastFrame() ?? "", /即将启动/);
  view.stdin.write("\r");
  await waitForInk();

  assert.deepEqual(result, { start: true });
  view.unmount();
});

function mockActions(dashboard: LauncherDashboard): LauncherActions {
  return {
    getDashboard: async () => dashboard,
    getStartup: () => dashboard.startup,
    getPlan: () => ({ unboundRoutePolicy: "auto_new" }),
    getBinding: (routeKey: string) => dashboard.bindings.find((binding) => binding.route.routeKey === routeKey),
    listSessionChoices: () => ({ selectable: [], unavailable: [] }),
    listWeixinPrimaryChoices: () => ({ selectable: [], unavailable: [] }),
    formatRunPolicy: () => "审批模式（workspace-write 沙箱）",
    startConfirmationSummary: () => ["即将启动"],
  } as unknown as LauncherActions;
}

function dashboardFixture(): LauncherDashboard {
  return {
    channels: [{
      record: {
        id: "feishu-default",
        type: "feishu",
        enabled: true,
        stateDir: "state/channels/feishu/feishu-default",
        defaultAccountId: "default",
        credentialSource: "interactive",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
      status: {
        channelId: "feishu-default",
        state: "connected",
        account: "default",
      },
      capabilities: {
        text: true,
        media: false,
        typing: true,
        direct: true,
        group: false,
        thread: false,
        login: "none",
        messageUpdate: false,
        streamingHint: true,
      },
    }],
    bindings: [{
      route: {
        routeKey: "feishu-default:default:direct:oc_abc",
        channelId: "feishu-default",
        channelType: "feishu",
        accountId: "default",
        conversationKind: "direct",
        conversationId: "oc_abc",
        identity: {
          lastSenderDisplayName: "张三",
        },
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
      label: "飞书 / default / 张三",
    }],
    pendingBindings: [{
      id: "weixin-primary-weixin-wx-main-wx-main",
      channelId: "weixin-wx-main",
      accountId: "wx-main",
      conversationKind: "direct",
      label: "微信 / wx-main / 主聊天",
      binding: { type: "existing", sessionId: "019e3024-session" },
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
    }],
    routes: {
      known: 1,
      bound: 0,
      pending: 0,
      unboundPolicy: "auto_new",
    },
    startup: {
      adapterMode: "app-server",
      cwd: "/repo",
      policy: {
        permissionMode: "approval",
        sandbox: "workspace-write",
      },
    },
    canStart: {
      ok: true,
      channels: [],
      message: "可以启动服务。",
    },
  };
}

async function waitForInk(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}
