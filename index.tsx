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

// ─── Stores ──────────────────────────────────────────────────────────────────
// Used to read the user's CURRENT live status so we never show "last seen"
// while they are actually online/idle/dnd.
const PresenceStore = findByPropsLazy("getStatus", "getActivities");

// lastSeenMap  : userId → unix timestamp of when they went offline
// seenOnlineSet: userId → we saw them come online this session
//                Only users in this set can get a lastSeen entry.
//                This prevents the startup flood (Discord sends PRESENCE_UPDATES
//                for every offline member on load — we ignore those).
const lastSeenMap   = new Map<string, number>();
const seenOnlineSet = new Set<string>();

function ago(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d < 7 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`;
}

function ClockIcon() {
    return (
        <svg
            width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ display: "inline-block", verticalAlign: "middle", marginRight: "3px", flexShrink: 0, marginBottom: "1px" }}
        >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );
}

// ─── Below-name subtext ───────────────────────────────────────────────────────
function LastSeenSubtext({ userId }: { userId?: string; }) {
    const [, rerender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        const t = setInterval(rerender, 60_000);
        return () => clearInterval(t);
    }, []);

    if (!userId) return null;

    // Hide if the user is currently online / idle / dnd
    try {
        const currentStatus: string = PresenceStore.getStatus(userId) ?? "offline";
        if (currentStatus !== "offline") return null;
    } catch { return null; }

    const ts = lastSeenMap.get(userId);
    if (!ts) return null;

    return (
        <div style={{
            display:      "flex",
            alignItems:   "center",
            fontSize:     "11px",
            fontWeight:   400,
            lineHeight:   "14px",
            color:        "var(--channels-default)",
            marginTop:    "1px",
            overflow:     "hidden",
            whiteSpace:   "nowrap",
            textOverflow: "ellipsis",
            userSelect:   "none",
            cursor:       "default",
            opacity:      0.8,
        }}>
            <ClockIcon />
            {ago(Date.now() - ts)}
        </div>
    );
}

// ─── Right-side decorator (fallback if patch doesn't match) ───────────────────
function LastSeenDecorator({ user }: { user?: { id: string; }; }) {
    const [, rerender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        const t = setInterval(rerender, 60_000);
        return () => clearInterval(t);
    }, []);

    if (!user?.id) return null;

    try {
        const currentStatus: string = PresenceStore.getStatus(user.id) ?? "offline";
        if (currentStatus !== "offline") return null;
    } catch { return null; }

    const ts = lastSeenMap.get(user.id);
    if (!ts) return null;

    return (
        <span
            title={`Last online: ${new Date(ts).toLocaleString()}`}
            style={{
                display:      "inline-flex",
                alignItems:   "center",
                fontSize:     "11px",
                fontWeight:   500,
                lineHeight:   1,
                color:        "var(--interactive-muted)",
                background:   "var(--background-modifier-hover)",
                border:       "1px solid var(--background-modifier-accent)",
                borderRadius: "3px",
                padding:      "2px 5px",
                marginLeft:   "6px",
                flexShrink:   0,
                whiteSpace:   "nowrap",
                userSelect:   "none",
                cursor:       "default",
            }}
        >
            <ClockIcon />
            {ago(Date.now() - ts)}
        </span>
    );
}

// ─── Context menu ─────────────────────────────────────────────────────────────
const ctxPatch = (_navId: string, children: any[], props: any) => {
    const userId: string | undefined = props?.user?.id ?? props?.guildMember?.userId;
    if (!userId) return;

    // Don't show if currently online
    try {
        const currentStatus: string = PresenceStore.getStatus(userId) ?? "offline";
        if (currentStatus !== "offline") return;
    } catch { return; }

    const ts = lastSeenMap.get(userId);
    if (!ts) return; // only show when we actually have data

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
    description: "Shows when offline users were last online. Only tracks transitions — no false data on startup. Resets on restart.",
    authors: [{ name: "k1ng_op", id: 641266820187160576 }],
    dependencies: ["MemberListDecoratorsAPI", "ContextMenuAPI"],

    patches: [
        {
            find: ".nameAndDecorators,",
            replacement: {
                match: /(\.nameAndDecorators,children:\[)([\s\S]*?)(\])/,
                replace: (_, open, inner, close) =>
                    `${open}${inner}${close},$self.renderSubtext(arguments[0])`,
            },
        },
    ],

    renderSubtext(props: any) {
        const userId: string | undefined =
            props?.user?.id ??
            props?.member?.userId ??
            props?.guildMember?.userId;
        return <LastSeenSubtext key="lot-sub" userId={userId} />;
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
                    // User is online / idle / dnd — mark as seen online
                    // and clear any stale last-seen entry
                    seenOnlineSet.add(user.id);
                    lastSeenMap.delete(user.id);
                } else {
                    // User went offline — only record if we saw them online
                    // this session (prevents recording the startup flood)
                    if (seenOnlineSet.has(user.id)) {
                        lastSeenMap.set(user.id, Date.now());
                        seenOnlineSet.delete(user.id);
                    }
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
