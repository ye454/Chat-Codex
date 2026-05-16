import React from "react";
import { Box, Text } from "ink";
import type { CodexRunPolicy } from "../../codex/codex-cli.js";
import type { SelectableSessionChoice, SessionDisplay } from "../actions/binding-actions.js";
import type { Flash, Screen } from "./types.js";

const FIELD_WIDTH = 18;

export function Frame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width={92}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">{title}</Text>
        {subtitle ? <Text color="gray">{subtitle}</Text> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">{children}</Box>
    </Box>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>{title}</Text>
      {children}
    </Box>
  );
}

export function ListRow({ active, left, right }: { active: boolean; left: string; right?: string }): React.JSX.Element {
  return (
    <Box>
      <Text color={active ? "cyan" : undefined}>{active ? "> " : "  "}{padRight(truncate(left, 52), 54)}</Text>
      {right ? <Text color={active ? "cyan" : undefined}>{truncate(right, 32)}</Text> : null}
    </Box>
  );
}

export function SessionRow({ active, index, session }: { active: boolean; index: number; session: SelectableSessionChoice }): React.JSX.Element {
  return <ListRow active={active} left={`${index + 1}. ${session.current ? "当前" : "可用"}   ${session.title ?? session.id}`} right={session.shortId} />;
}

export function KeyValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <Text>{padRight(label, FIELD_WIDTH)}{truncate(value, 70)}</Text>;
}

export function Footer({ loading, flash, screen }: { loading: boolean; flash: Flash; screen: Screen["name"] }): React.JSX.Element {
  const color = flash.kind === "error" ? "red" : flash.kind === "success" ? "green" : "gray";
  return (
    <Box marginTop={1}>
      <Text color={loading ? "yellow" : color}>{loading ? "处理中..." : flash.message}</Text>
      <Text color="gray">  [{screen}]</Text>
    </Box>
  );
}

export function ConfirmBar({ message }: { message: string }): React.JSX.Element {
  return <Box marginTop={1}><Text color="yellow">{message}</Text></Box>;
}

export function Muted({ text }: { text: string }): React.JSX.Element {
  return <Text color="gray">{text}</Text>;
}

export function formatSession(session: SessionDisplay): string {
  return `${session.title ?? session.id} / ${session.shortId}`;
}

export function formatPermission(policy: CodexRunPolicy): string {
  if (policy.permissionMode === "full") return "完全权限（跳过审批和沙箱，高风险）";
  return `审批模式（${policy.sandbox ?? "workspace-write"} 沙箱）`;
}

export function channelStatus(state: string): string {
  if (state === "connected") return "已连接";
  if (state === "login_required") return "需要配置";
  if (state === "failed") return "异常";
  if (state === "stopped") return "已停止";
  return state;
}

export function truncate(value: string, width: number): string {
  const chars = Array.from(value);
  if (chars.length <= width) return value;
  return `${chars.slice(0, Math.max(0, width - 1)).join("")}…`;
}

export function padRight(value: string, width: number): string {
  const length = Array.from(value).length;
  return length >= width ? value : `${value}${" ".repeat(width - length)}`;
}
