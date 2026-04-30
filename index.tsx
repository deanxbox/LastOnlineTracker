/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { React, Menu } from "@webpack/common";
import { findByPropsLazy } from "@webpack";
import { addContextMenuPatch, removeContextMenuPatch, findGroupChildrenByChildId } from "@api/ContextMenu";
import { addMemberListDecorator, removeMemberListDecorator } from "@api/MemberListDecorators";

const PresenceStore = findByPropsLazy("getStatus", "getActivities");

const lastSeenMap   = new Map<string, number>();
const seenOnlineSet = new Set<string>();

const decoratorStyle = { fontSize: "11px", color: "var(--text-muted)", userSelect: "none" } as const;

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

function isOffline(userId: string): boolean {
    try { return (PresenceStore.getStatus(userId) ?? "offline") === "offline"; }
    catch { return true; }
}

// Matches Discord's own "Active X ago" style exactly
const subStyle: React.CSSProperties = {
    display: "block", fontSize: "12px", fontWeight: 400,
    lineHeight: "16px", color: "var(--text-muted)",
    overflow: "hidden", whiteSpace: "nowrap",
    textOverflow: "ellipsis", userSelect: "none",
};

function LastSeenText({ userId }: { userId: string; }) {
    const [, tick] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => {
        const t = setInterval(tick, 30_000);
        return () => clearInterval(t);
    }, []);
    if (!isOffline(userId)) return null;
    const ts = lastSeenMap.get(userId);
    if (!ts) return null;
    return <span style={subStyle}>Active {ago(Date.now() - ts)}</span>;
}

// ─── Context menu ─────────────────────────────────────────────────────────────
const ctxPatch = (_navId: string, children: any[], props: any) => {
    const userId: string | undefined = props?.user?.id ?? props?.guildMember?.userId;
    if (!userId || !isOffline(userId)) return;
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
            label={`Active ${ago(Date.now() - ts)}`}
            subtext={`Last online: ${new Date(ts).toLocaleString()}`}
            disabled
        />
    );
};

export default definePlugin({
    name: "LastOnlineTracker",
    description: "Shows 'Active X ago' below usernames in the DM list, matching Discord's own style. Resets on restart.",
    authors: [{ name: "k1ng_op", id: 641266820187160576 }],
    dependencies: ["MemberListDecoratorsAPI", "ContextMenuAPI"],

    patches: [
        {
            find: '"PrivateChannel"',
            replacement: {
                match: /(subText:)(t\.isSystemDM\(\))/,
                replace: "$1$self.dmSubtext(r)??$2",
            },
            optional: true,
        },
    ],

    // `user` = Discord user object (`r` in the compiled code)
    // Returns our JSX if we have data, or null to fall through to Discord's subtext.
    dmSubtext(user: any): React.ReactNode {
        const userId: string | undefined = user?.id;
        if (!userId) return null;

        // User is currently online/idle/dnd — Discord's own "Active X ago" handles it
        if (!isOffline(userId)) return null;

        const ts = lastSeenMap.get(userId);
        if (!ts) return null;

        return <LastSeenText key="lot-dm" userId={userId} />;
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
                const fullyOffline =
                    status === "offline" &&
                    (!clientStatus || Object.keys(clientStatus).length === 0);
                if (!fullyOffline) {
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
        // Right-side member list decorator — confirmed working
        addMemberListDecorator("LastOnlineTracker", props => {
            const user = (props as any).user;
            if (!user?.id || !isOffline(user.id)) return null;
            const ts = lastSeenMap.get(user.id);
            if (!ts) return null;
            return (
                <span style={decoratorStyle}>
                    {ago(Date.now() - ts)}
                </span>
            );
        });

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
