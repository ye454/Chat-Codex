# 运行期单实例锁设计

## 背景

`chat-codex` 统一入口会同时启动多个已启用渠道，例如微信账号和飞书机器人。默认状态目录固定在 `~/.chat-codex/state/`，如果用户重复执行启动，可能出现多个中间件进程同时连接同一批通讯渠道。

重复启动的风险：

- 微信或飞书入站消息被多个进程同时消费，导致重复回复。
- 两个 Bridge 同时驱动同一个 Codex session，造成上下文串线。
- 审批、文件发送、typing、进度投递可能重复或错发。
- 本地 `~/.chat-codex/state/bridge/*.json` 被多个进程并发读写，产生状态覆盖。
- 用户看到多个运行期 TUI，不知道哪个才是真正服务进程。

因此需要在启动通讯渠道前做运行期单实例检测，确保同一个本地状态目录下只有一个 Chat Codex 中间件实例在运行。

## 目标

- 同一个 Bridge 状态目录下只允许一个运行中的 Bridge 实例。默认目录是 `~/.chat-codex/state/bridge/`，可通过 `CHAT_CODEX_STATE_DIR` 覆盖。
- 第二个进程启动时，如果已有实例健康运行，必须拒绝启动渠道。
- 崩溃后留下的残留锁可以被识别，并允许用户清理后重新启动。
- 锁不保护 Codex CLI 本身，只保护 Chat Codex 中间件和通讯渠道绑定。
- TUI 和普通 CLI fallback 使用同一套 lock service。

## 非目标

- 第一版不支持多个进程分别启动不同渠道。
- 第一版不做跨机器分布式锁。
- 第一版不做远程服务发现。
- 第一版不通过杀进程自动停止旧实例。
- 第一版不把锁写进 Git 跟踪文件。

## 锁粒度

第一版使用全局运行锁：

```text
~/.chat-codex/state/bridge/runtime.lock/
```

理由：

- 当前 Bridge 状态目录下的 routes、session owners、pending bindings 是共享状态。
- 即使两个进程启动不同渠道，也会共享 session owner 和 route 状态，容易产生并发写入风险。
- 全局锁实现简单，能直接解决重复启动通讯渠道的主要风险。

后续如果确实需要多进程分别管理不同渠道，再设计 per-channel lock：

```text
~/.chat-codex/state/channels/<type>/<channelId>/runtime.lock/
```

但 per-channel lock 必须同时解决共享 Bridge 状态目录的并发写入问题，不能只锁渠道连接。

## 锁文件结构

锁目录：

```text
~/.chat-codex/state/bridge/runtime.lock/
```

锁信息：

```text
~/.chat-codex/state/bridge/runtime.lock/owner.json
```

建议结构：

```ts
interface RuntimeLockOwner {
  schemaVersion: 1;
  pid: number;
  hostname: string;
  cwd: string;
  startedAt: string;
  heartbeatAt: string;
  channels: Array<{
    id: string;
    type: string;
    accountId?: string;
    displayName?: string;
  }>;
  command?: string;
}
```

字段说明：

- `pid`：持有锁的进程 ID。
- `hostname`：本机主机名，用于提示和排查。
- `cwd`：启动 Chat Codex 时的工作目录。
- `startedAt`：进程取得锁的时间。
- `heartbeatAt`：最近一次心跳时间。
- `channels`：启动时计划连接的渠道，用于 TUI 提示。
- `command`：可选，记录入口命令，例如 `npm run chat-codex`。

## 获取锁

启动流程必须在创建真实 runtime adapters 和启动 `ChannelRegistry` 前获取锁。

推荐流程：

1. 准备 startup 和 channel plan。
2. 读取已启用渠道并通过启动前校验。
3. 尝试创建 Bridge 状态目录下的 `runtime.lock/` 目录。
4. 如果创建成功，写入 `owner.json`，启动心跳。
5. 如果目录已存在，读取 `owner.json` 并判断是否为活锁或残留锁。
6. 只有拿到锁后才允许启动通讯渠道。

目录创建必须使用原子语义：

```ts
fs.mkdirSync(lockDir)
```

如果目录已存在，视为锁已被占用。不要用“先检查再创建”的非原子流程。

## 心跳

持有锁的进程启动后定期更新 `owner.json` 中的 `heartbeatAt`。

建议参数：

```text
heartbeat interval: 5 秒
stale timeout: 30 秒
```

规则：

- 每 5 秒写一次 `heartbeatAt`。
- 写入采用临时文件 + rename 的原子写方式。
- 如果写心跳失败，记录日志，但不要立即停止服务；连续失败可以后续增强。
- 退出时停止心跳。

## 活锁判断

第二个进程发现 `runtime.lock/` 已存在时：

1. 读取 `owner.json`。
2. 检查 `pid` 是否仍在运行。
3. 检查 `heartbeatAt` 是否新鲜。

判断结果：

- `pid` 存活，并且 `heartbeatAt` 距现在小于 stale timeout：已有实例运行，拒绝启动。
- `pid` 不存在：残留锁。
- `heartbeatAt` 超过 stale timeout：疑似残留锁。
- `owner.json` 缺失或损坏：疑似残留锁。

PID 存活检查：

```ts
process.kill(pid, 0)
```

注意：

- `EPERM` 也表示进程存在，只是当前进程没有权限操作。
- `ESRCH` 表示进程不存在。
- 不同机器共享目录时 PID 不可靠；第一版不支持跨机器锁，`hostname` 不同则提示用户这是非本机锁或共享目录风险。

## 残留锁处理

如果检测到残留锁，不能静默覆盖。TUI 和 CLI 都要明确提示：

```text
发现残留运行锁。
上次进程: PID 12345
启动时间: 2026-05-16 14:20:31
最近心跳: 2026-05-16 14:21:00

如果确认没有 Chat Codex 正在运行，可以清理残留锁后启动。
```

TUI 操作：

```text
> 返回
  清理残留锁并启动
```

普通 CLI fallback：

```text
1. 清理残留锁并启动
0. 返回
```

清理残留锁时：

- 删除 `runtime.lock/` 目录。
- 重新执行获取锁流程。
- 不能直接假设清理后必定成功，因为可能有另一个进程刚拿到锁。

## 已有实例运行时的用户体验

当已有健康实例运行时，第二个 TUI 不应继续启动服务。

首页或启动确认页展示：

```text
Chat Codex 已在运行

PID: 12345
启动时间: 2026-05-16 14:20:31
最近心跳: 2026-05-16 14:20:46
工作目录: /path/to/project
渠道:
- 飞书 / 大龙虾
- 微信 / 小号

请先在原终端按 Ctrl+C 停止服务，再重新启动。
```

规则：

- “启动服务”不可执行。
- 不提供自动杀掉旧进程。
- 第一版可以允许用户继续查看配置，但进行渠道删除、备注修改、绑定修改前应提示已有运行实例，建议先停止服务。
- 更保守的实现可以在已有实例运行时只允许查看，不允许改配置。

## 退出清理

持有锁的进程在以下路径释放锁：

- Bridge 正常退出。
- TUI 收到 `Ctrl+C` 后退出运行期日志面板，上层 `finally` 停止 Bridge。
- `SIGTERM`。
- 启动渠道失败并回滚。

释放流程：

1. 停止心跳。
2. 确认当前 `owner.json` 的 `pid` 仍是自己。
3. 删除 `runtime.lock/` 目录。

如果 `owner.json` 的 `pid` 已不是自己，不应删除，避免误删新进程锁。

异常崩溃无法执行清理，依赖 stale lock 检测。

## 和渠道启动的关系

锁必须包住整个运行期：

```text
acquire lock
  create runtime adapters
  start ChannelRegistry / Bridge
  run runtime TUI or console transcript
finally
  stop Bridge / channels
  release lock
```

如果任一渠道启动失败：

- 停止已启动的渠道。
- 释放锁。
- 返回启动失败信息。

## 和状态持久化的关系

运行锁不替代 session owner 规则。

两者职责不同：

- runtime lock：避免多个中间件进程同时连接通讯渠道并写本地状态。
- session owner：避免一个 Codex session 被多个 route 绑定。

即使有 runtime lock，也必须保留 session owner 唯一归属规则。

## TUI 改动

需要新增运行锁状态：

```ts
type RuntimeLockStatus =
  | { state: "free" }
  | { state: "held"; owner: RuntimeLockOwner }
  | { state: "stale"; owner?: RuntimeLockOwner; reason: string };
```

TUI 页面行为：

- 首页加载 dashboard 时读取 lock status。
- 如果 `held`，启动服务项显示“已有实例运行”。
- 如果 `stale`，启动服务前进入残留锁确认页。
- 启动确认页再次检查 lock status，避免 dashboard 到启动之间出现竞争。
- 运行期日志面板显示自己持有锁的 PID 和启动时间。

## CLI fallback 改动

普通 prompt CLI 在 `confirmStart()` 前检查 lock status。

行为：

- `free`：继续启动。
- `held`：打印已有实例信息并返回首页。
- `stale`：提示是否清理残留锁。

非交互模式：

- `free`：继续启动。
- `held`：退出并返回非 0。
- `stale`：默认不清理，退出并提示用户用交互模式处理。后续可以加显式参数。

## 建议模块

新增：

```text
src/runtime/runtime-lock.ts
```

职责：

- 计算 lock 路径。
- 原子获取锁。
- 读取 owner。
- 判断 held/stale/free。
- 启动和停止 heartbeat。
- 安全释放锁。
- 清理 stale lock。

建议接口：

```ts
interface RuntimeLockOptions {
  bridgeDir: string;
  staleTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  now?: () => Date;
}

type RuntimeLockAcquireResult =
  | { ok: true; lock: RuntimeLockHandle }
  | { ok: false; state: "held"; owner: RuntimeLockOwner; message: string }
  | { ok: false; state: "stale"; owner?: RuntimeLockOwner; reason: string; message: string };

interface RuntimeLockHandle {
  owner: RuntimeLockOwner;
  startHeartbeat(): void;
  stopHeartbeat(): void;
  release(): void;
}
```

## 测试要求

单元测试：

- 空锁目录时可以获取锁。
- 已有健康锁时拒绝获取。
- PID 不存在时判定 stale。
- heartbeat 超时时判定 stale。
- `owner.json` 损坏时判定 stale。
- 清理 stale lock 后可以重新获取。
- release 只删除当前进程持有的锁。
- heartbeat 会更新 `heartbeatAt`。

集成测试：

- 第一个启动流程获取锁后，第二个启动流程拒绝启动。
- 启动失败时释放锁。
- 正常停止 Bridge 后释放锁。
- stale lock 清理后可以启动。

TUI 测试：

- 首页已有实例运行时，“启动服务”不可执行并显示 PID。
- stale lock 时显示“清理残留锁并启动”操作。
- 运行期日志面板显示 `Ctrl+C 停止服务`，停止后释放锁。

人工验证：

```bash
npm run chat-codex
```

步骤：

1. 终端 A 启动服务。
2. 终端 B 在同一仓库再次执行 `npm run chat-codex`。
3. 终端 B 应提示已有实例运行，不能启动渠道。
4. 终端 A 按 `Ctrl+C` 停止。
5. 终端 B 刷新或重新启动后应可正常启动。
6. 手动制造 stale lock，确认 TUI 能提示清理残留锁。

## 实施顺序

1. 新增 `RuntimeLock` 模块和单元测试。
2. 在启动服务前接入 lock acquire。
3. 在 Bridge 运行 finally 中 release lock。
4. 接入 TUI dashboard / 启动确认页的 lock status 展示。
5. 接入普通 CLI fallback。
6. 补集成测试、TUI 测试和中文测试报告。

## 验收标准

- 同一 Bridge 状态目录下无法同时启动两个 Chat Codex 中间件实例。
- 第二个进程不会连接微信或飞书。
- 正常退出后锁被释放。
- 崩溃残留锁能被识别并清理。
- 已有实例运行时 TUI 给出 PID、启动时间、最近心跳和渠道列表。
- `npm test` 通过。
- 新增中文测试报告。
