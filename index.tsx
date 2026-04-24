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
let   _propsLogged  = false;

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

// Shared style — identical to Discord's own "Active X ago"
const subStyle: React.CSSProperties = {
    display:      "block",
    fontSize:     "12px",
    fontWeight:   400,
    lineHeight:   "16px",
    color:        "var(--text-muted)",
    overflow:     "hidden",
    whiteSpace:   "nowrap",
    textOverflow: "ellipsis",
    userSelect:   "none",
};

function LastSeenText({ userId }: { userId: string; }) {
    const [, tick] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => { const t = setInterval(tick, 30_000); return () => clearInterval(t); }, []);
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
    description: "Shows 'Active X ago' below usernames in DM list and member list, matching Discord's style. Resets on restart.",
    authors: [{ name: "You", id: 0n }],
    dependencies: ["MemberListDecoratorsAPI", "ContextMenuAPI"],

    patches: [
        // ── DM list left sidebar ─────────────────────────────────────────────
        // Module 149741: renders each DM row. Props object is `e`,
        // secondaryText is aliased to `d`, passed as subText:d into the row.
        // We intercept subText:d and pass the full props `e` so we can
        // extract the userId from whatever field Discord stores it in.
        {
            find: "friendsWidgetRowRecentlyAdded",
            replacement: {
                match: /subText:(\w+),hovered/,
                replace: "subText:$self.dmSubtext($1,e),hovered",
            },
            optional: true,
        },
    ],

    // Called from the patched DM row render.
    // `original` = Discord's own secondaryText (e.g. "Active 5m ago") or null.
    // `props`    = the full component props object `e`.
    dmSubtext(original: React.ReactNode, props: any): React.ReactNode {
        // Log props keys once so we can see what's available in DevTools.
        if (!_propsLogged) {
            _propsLogged = true;
            console.log("[LastOnlineTracker] DM row props keys:", Object.keys(props ?? {}), props);
        }

        // Try every known field that might carry the userId.
        const userId: string | undefined =
            props?.user?.id          ??
            props?.userId            ??
            props?.recipient?.id     ??
            props?.channel?.recipients?.[0];

        // If we have no userId or user is currently online, show Discord's original text.
        if (!userId || !isOffline(userId)) return original ?? null;

        const ts = lastSeenMap.get(userId);
        // No tracked data yet — show Discord's original text if any.
        if (!ts) return original ?? null;

        // Show our "Active X ago" in place of Discord's subtext.
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
        // Right-side member list decorator (confirmed working)
        addMemberListDecorator("LastOnlineTracker", props => {
            const user = (props as any).user;
            if (!user?.id || !isOffline(user.id)) return null;
            const ts = lastSeenMap.get(user.id);
            if (!ts) return null;
            return (
                <span style={{ fontSize: "11px", color: "var(--text-muted)", userSelect: "none" }}>
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
        _propsLogged = false;
    },
});
