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
            width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0 }}
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );
}

function useRerender(interval = 60_000) {
    const [, rerender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        const t = setInterval(rerender, interval);
        return () => clearInterval(t);
    }, []);
}

// ─── Below-name subtext ──────────────────────────────────────────────────────
function LastSeenSubtext({ userId }: { userId?: string; }) {
    useRerender();

    if (!userId) return null;

    try {
        const currentStatus: string = PresenceStore.getStatus(userId) ?? "offline";
        if (currentStatus !== "offline") return null;
    } catch { return null; }

    const ts = lastSeenMap.get(userId);
    if (!ts) return null;

    return (
        <div
            title={`Last online: ${new Date(ts).toLocaleString()}`}
            style={{
                display:      "flex",
                alignItems:   "center",
                gap:          "4px",
                fontSize:     "12px",
                fontWeight:   400,
                lineHeight:   "16px",
                color:        "var(--text-muted)",
                marginTop:    "2px",
                overflow:     "hidden",
                whiteSpace:   "nowrap",
                textOverflow: "ellipsis",
                userSelect:   "none",
            }}
        >
            <ClockIcon />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                last seen {ago(Date.now() - ts)}
            </span>
        </div>
    );
}

// ─── Right-side decorator ────────────────────────────────────────────────────
function LastSeenDecorator({ user }: { user?: { id: string; }; }) {
    useRerender();

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
                gap:          "3px",
                fontSize:     "11px",
                fontWeight:   500,
                lineHeight:   "12px",
                color:        "var(--text-muted)",
                background:   "var(--background-secondary)",
                borderRadius: "8px",
                padding:      "2px 6px",
                marginLeft:   "4px",
                flexShrink:   0,
                whiteSpace:   "nowrap",
                userSelect:   "none",
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

    try {
        const currentStatus: string = PresenceStore.getStatus(userId) ?? "offline";
        if (currentStatus !== "offline") return;
    } catch { return; }

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
    description: "Shows when offline users were last online. Only tracks transitions — no false data on startup. Resets on restart.",
    authors: [{ name: "k1ng_op", id: 641266820187160576 }],
    dependencies: ["MemberListDecoratorsAPI", "ContextMenuAPI"],

    patches: [
        {
            find: ".nameAndDecorators",
            replacement: [
                {
                    match: /(nameAndDecorators[^}]*?children:\[)([^\]]*?)(\])/,
                    replace: (_, open, inner, close) =>
                        `${open}${inner}${close},$self.renderSubtext(arguments[0])`,
                },
            ],
            noWarn: true,
        },
    ],

    renderSubtext(props: any) {
        const userId: string | undefined =
            props?.user?.id ??
            props?.member?.userId ??
            props?.guildMember?.userId ??
            props?.channel?.recipients?.[0];
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
                    seenOnlineSet.add(user.id);
                    lastSeenMap.delete(user.id);
                } else {
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
