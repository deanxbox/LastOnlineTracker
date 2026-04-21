/*
 * LastOnlineTracker - tracks when ppl go offline
 * by Mubashir
 */

import definePlugin from "@utils/types";
import { React } from "@webpack/common";
import { findByPropsLazy } from "@webpack";
import { addContextMenuPatch, removeContextMenuPatch, findGroupChildrenByChildId } from "@api/ContextMenu";
import { addMemberListDecorator, removeMemberListDecorator } from "@api/MemberListDecorators";
import { Menu } from "@webpack/common";

const presence = findByPropsLazy("getStatus", "getActivities");

const offlineTimes = new Map<string, number>();
const wasOnline = new Set<string>();

function formatTime(ms: number) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return "just now";

    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;

    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;

    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;

    return `${Math.floor(day / 7)}w ago`;
}

function isOffline(id: string) {
    try {
        return (presence.getStatus(id) ?? "offline") === "offline";
    } catch {
        return false;
    }
}

function Clock() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );
}

// rerender every minute so the time updates
function useTick() {
    const [, tick] = React.useReducer((x: number) => x + 1, 0);
    React.useEffect(() => {
        const id = setInterval(tick, 60000);
        return () => clearInterval(id);
    }, []);
}

function Subtext({ userId }: { userId?: string }) {
    useTick();
    if (!userId || !isOffline(userId)) return null;

    const ts = offlineTimes.get(userId);
    if (!ts) return null;

    return (
        <div
            title={`Last online: ${new Date(ts).toLocaleString()}`}
            style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "12px",
                lineHeight: "16px",
                color: "var(--text-muted)",
                marginTop: "2px",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                userSelect: "none"
            }}
        >
            <Clock />
            <span>last seen {formatTime(Date.now() - ts)}</span>
        </div>
    );
}

function Pill({ user }: { user?: { id: string } }) {
    useTick();
    if (!user?.id || !isOffline(user.id)) return null;

    const ts = offlineTimes.get(user.id);
    if (!ts) return null;

    return (
        <span
            title={`Last online: ${new Date(ts).toLocaleString()}`}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                fontSize: "11px",
                fontWeight: 500,
                color: "var(--text-muted)",
                background: "var(--background-secondary)",
                borderRadius: "8px",
                padding: "2px 6px",
                marginLeft: "4px",
                whiteSpace: "nowrap",
                userSelect: "none"
            }}
        >
            <Clock />
            {formatTime(Date.now() - ts)}
        </span>
    );
}

function menuPatch(_: string, children: any[], props: any) {
    const id = props?.user?.id ?? props?.guildMember?.userId;
    if (!id || !isOffline(id)) return;

    const ts = offlineTimes.get(id);
    if (!ts) return;

    const group = findGroupChildrenByChildId("user-profile", children)
        ?? findGroupChildrenByChildId("mark-as-read", children)
        ?? children;

    group.push(
        <Menu.MenuSeparator key="lot-sep" />,
        <Menu.MenuItem
            key="lot-item"
            id="lot-item"
            label={`Last seen ${formatTime(Date.now() - ts)}`}
            subtext={new Date(ts).toLocaleString()}
            disabled
        />
    );
}

export default definePlugin({
    name: "LastOnlineTracker",
    description: "Shows when offline users were last online. resets when u restart discord",
    authors: [{ name: "mubashir", id: 641266820187160576n }],
    dependencies: ["MemberListDecoratorsAPI", "ContextMenuAPI"],

    patches: [
        {
            find: ".nameAndDecorators",
            replacement: {
                match: /(nameAndDecorators[^}]*?children:\[)([^\]]*?)(\])/,
                replace: (_, a, b, c) => `${a}${b}${c},$self.renderSubtext(arguments[0])`
            },
            noWarn: true
        }
    ],

    renderSubtext(props: any) {
        const id = props?.user?.id
            ?? props?.member?.userId
            ?? props?.guildMember?.userId
            ?? props?.channel?.recipients?.[0];

        return <Subtext key="lot-sub" userId={id} />;
    },

    flux: {
        PRESENCE_UPDATES({ updates }: any) {
            if (!Array.isArray(updates)) return;

            for (const u of updates) {
                const id = u.user?.id;
                if (!id) continue;

                const fullyOffline = u.status === "offline"
                    && (!u.clientStatus || Object.keys(u.clientStatus).length === 0);

                if (!fullyOffline) {
                    wasOnline.add(id);
                    offlineTimes.delete(id);
                    continue;
                }

                // only save if we actually saw them online before
                // otherwise discord floods us with offline ppl on startup
                if (wasOnline.has(id)) {
                    offlineTimes.set(id, Date.now());
                    wasOnline.delete(id);
                }
            }
        }
    },

    start() {
        addMemberListDecorator("LastOnlineTracker", (p: any) => <Pill user={p.user} />);
        addContextMenuPatch("user-context", menuPatch);
        addContextMenuPatch("gdm-context", menuPatch);
    },

    stop() {
        removeMemberListDecorator("LastOnlineTracker");
        removeContextMenuPatch("user-context", menuPatch);
        removeContextMenuPatch("gdm-context", menuPatch);
        offlineTimes.clear();
        wasOnline.clear();
    }
});
