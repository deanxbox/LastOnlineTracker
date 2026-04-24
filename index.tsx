/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { React } from "@webpack/common";
import { findByPropsLazy } from "@webpack";
import { addContextMenuPatch, removeContextMenuPatch, findGroupChildrenByChildId } from "@api/ContextMenu";
import { addMemberListDecorator, removeMemberListDecorator } from "@api/MemberListDecorators";
import { Menu } from "@webpack/common";

const PresenceStore = findByPropsLazy("getStatus", "getActivities");

const lastSeenMap   = new Map<string, number>();
const seenOnlineSet = new Set<string>();

function ago(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d < 7 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`;
}

function isOnline(userId: string): boolean {
    try {
        const s: string = PresenceStore.getStatus(userId) ?? "offline";
        return s !== "offline";
    } catch { return false; }
}

// ─── Shared subtext style — matches Discord's "Active X ago" exactly ──────────
const subtextStyle: React.CSSProperties = {
    display:       "block",
    fontSize:      "12px",
    fontWeight:    400,
    lineHeight:    "16px",
    color:         "var(--text-muted)",
    overflow:      "hidden",
    whiteSpace:    "nowrap",
    textOverflow:  "ellipsis",
    userSelect:    "none",
    cursor:        "default",
};

// ─── Subtext for member list (right panel) ────────────────────────────────────
function LastSeenSubtext({ userId }: { userId?: string; }) {
    const [, tick] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => {
        const t = setInterval(tick, 30_000);
        return () => clearInterval(t);
    }, []);

    if (!userId || isOnline(userId)) return null;
    const ts = lastSeenMap.get(userId);
    if (!ts) return null;

    return <span style={subtextStyle}>Last seen {ago(Date.now() - ts)}</span>;
}

// ─── Subtext for DM list (left sidebar) ──────────────────────────────────────
function DmLastSeenSubtext({ userId }: { userId?: string; }) {
    const [, tick] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => {
        const t = setInterval(tick, 30_000);
        return () => clearInterval(t);
    }, []);

    if (!userId || isOnline(userId)) return null;
    const ts = lastSeenMap.get(userId);
    if (!ts) return null;

    return (
        <span style={{ ...subtextStyle, marginTop: "0px" }}>
            Last seen {ago(Date.now() - ts)}
        </span>
    );
}

// ─── Right-side decorator (always-on fallback) ────────────────────────────────
function LastSeenDecorator({ user }: { user?: { id: string; }; }) {
    const [, tick] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => {
        const t = setInterval(tick, 30_000);
        return () => clearInterval(t);
    }, []);

    if (!user?.id || isOnline(user.id)) return null;
    const ts = lastSeenMap.get(user.id);
    if (!ts) return null;

    return (
        <span
            title={`Last online: ${new Date(ts).toLocaleString()}`}
            style={{
                fontSize:     "11px",
                color:        "var(--text-muted)",
                userSelect:   "none",
                cursor:       "default",
                whiteSpace:   "nowrap",
                marginLeft:   "4px",
            }}
        >
            {ago(Date.now() - ts)}
        </span>
    );
}

// ─── Context menu ─────────────────────────────────────────────────────────────
const ctxPatch = (_navId: string, children: any[], props: any) => {
    const userId: string | undefined = props?.user?.id ?? props?.guildMember?.userId;
    if (!userId || isOnline(userId)) return;
    const ts = lastSeenMap.get(userId);
    if (!ts) return;

    const group = findGroupChildrenByChildId("user-profile", children)
        ?? findGroupChildrenByChildId("mark-as-read", children)
        ?? children;

    group.push(
        <Menu.MenuSeparator key="lot-sep" />,
        <Menu.MenuItem
            key="lot-lastseen"
            id="lot-lastseen"
            label={`Last seen ${ago(Date.now() - ts)}`}
            subtext={new Date(ts).toLocaleString()}
            disabled
        />
    );
};

export default definePlugin({
    name: "LastOnlineTracker",
    description: "Shows 'Last seen X ago' below usernames in the DM list and member list, exactly like Discord's own 'Active X ago'. Resets on restart.",
    authors: [{ name: "k1ng_op", id: 641266820187160576 }],
    dependencies: ["MemberListDecoratorsAPI", "ContextMenuAPI"],

    patches: [
        // ── Patch 1: Right-panel member list ─────────────────────────────────
        {
            find: ".nameAndDecorators,",
            replacement: {
                match: /(\.nameAndDecorators,children:\[)([\s\S]*?)(\])/,
                replace: (_, open, inner, close) =>
                    `${open}${inner}${close},$self.renderSubtext(arguments[0])`,
            },
        },

        // ── Patch 2: Left-sidebar DM list ─────────────────────────────────────
        // Targets the private channel list item name wrapper.
        // Discord renders each DM row with a name + optional subtext (e.g. "Active X ago").
        // We append our own subtext in the same slot.
        {
            find: ".privateChannelListItem,",
            replacement: {
                match: /(\([\s\S]{0,200}?\.name,[\s\S]{0,100}?children:)(\i)/,
                replace: (_, pre, name) =>
                    `${pre}$self.wrapDmName(${name}, arguments[0]?.channel?.recipients?.[0])`,
            },
        },
    ],

    renderSubtext(props: any) {
        const userId: string | undefined =
            props?.user?.id ??
            props?.member?.userId ??
            props?.guildMember?.userId;
        if (!userId) return null;
        return <LastSeenSubtext key="lot-sub" userId={userId} />;
    },

    wrapDmName(nameNode: React.ReactNode, userId?: string) {
        if (!userId) return nameNode;
        return (
            <div key="lot-dm-wrap" style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                {nameNode}
                <DmLastSeenSubtext userId={userId} />
            </div>
        );
    },

    flux: {
        PRESENCE_UPDATES({ updates }: {
            updates?: Array<{
                user:          { id: string };
                status:        string;
                clientStatus?: Record<string, string>;
            }>;
        }) {
            if (!Array.isArray(updates)) return;
            for (const { user, status, clientStatus } of updates) {
                const isFullyOffline =
                    status === "offline" &&
                    (!clientStatus || Object.keys(clientStatus).length === 0);

                if (!isFullyOffline) {
                    seenOnlineSet.add(user.id);
                    lastSeenMap.delete(user.id);
                } else if (seenOnlineSet.has(user.id)) {
                    lastSeenMap.set(user.id, Date.now());
                    seenOnlineSet.delete(user.id);
                }
            }
        },
    },

    start() {
        addMemberListDecorator("LastOnlineTracker", props =>
            <LastSeenDecorator user={(props as any).user} />
        );
        addContextMenuPatch("user-context", ctxPatch);
        addContextMenuPatch("gdm-context", ctxPatch);
    },

    stop() {
        removeMemberListDecorator("LastOnlineTracker");
        removeContextMenuPatch("user-context", ctxPatch);
        removeContextMenuPatch("gdm-context", ctxPatch);
        lastSeenMap.clear();
        seenOnlineSet.clear();
    },
});
