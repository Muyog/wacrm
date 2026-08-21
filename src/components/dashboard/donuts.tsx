"use client";

import { Globe, MessageSquare, Users } from 'lucide-react';
import type { ChannelsDonutData, MessagesDonutData } from '@/lib/dashboard/types';

/* ------------------------------------------------------------------ */
/* Shared donut SVG (used by both donuts)                              */
/* ------------------------------------------------------------------ */

const SIZE = 140;
const STROKE = 28;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

interface DonutSlice {
  label: string;
  count: number;
  color: string;
}

function Donut({ slices }: { slices: DonutSlice[] }) {
  const total = slices.reduce((s, x) => s + x.count, 0);
  if (total === 0) {
    return (
      <svg width={SIZE} height={SIZE} className="block shrink-0">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="hsl(var(--border))" strokeWidth={STROKE} />
      </svg>
    );
  }
  let offset = 0;
  return (
    <svg width={SIZE} height={SIZE} className="block shrink-0" viewBox={`0 0 ${SIZE} ${SIZE}`}>
      {slices.map((s, i) => {
        const pct = s.count / total;
        const dash = pct * C;
        const gap = C - dash;
        const el = (
          <circle
            key={i}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth={STROKE}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            strokeLinecap="butt"
          />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Channels donut                                                      */
/* ------------------------------------------------------------------ */

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: '#25D366',
  website: '#7c3aed',
  email: '#f59e0b',
};

const CHANNEL_ICONS: Record<string, typeof Globe> = {
  whatsapp: MessageSquare,
  website: Globe,
  email: Users,
};

export function ChannelsDonut({ data }: { data: ChannelsDonutData | null }) {
  const slices = (data?.slices ?? []).map((s) => ({
    label: s.channel.charAt(0).toUpperCase() + s.channel.slice(1),
    count: s.count,
    color: CHANNEL_COLORS[s.channel] || '#7c3aed',
  }));
  const total = slices.reduce((s, x) => s + x.count, 0);
  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">Conversations by channel</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Where customers reach you</p>
      </header>
      <div className="flex flex-1 items-center gap-5 p-5">
        <Donut slices={slices} />
        <div className="min-w-0 flex-1 space-y-2">
          {slices.length === 0 && (
            <p className="text-xs text-muted-foreground">No conversations yet</p>
          )}
          {slices.map((s) => {
            const Icon = CHANNEL_ICONS[s.label.toLowerCase()] || Globe;
            const pct = total ? Math.round((s.count / total) * 100) : 0;
            return (
              <div key={s.label} className="flex items-center gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: s.color + '22' }}>
                  <Icon className="h-3 w-3" style={{ color: s.color }} />
                </span>
                <span className="flex-1 truncate">{s.label}</span>
                <span className="tabular-nums font-medium">{s.count}</span>
                <span className="w-8 text-right tabular-nums text-muted-foreground">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Messages by sender donut                                            */
/* ------------------------------------------------------------------ */

const SENDER_META: Record<string, { label: string; color: string; icon: typeof Globe }> = {
  customer: { label: 'Customers', color: '#3b82f6', icon: Users },
  agent: { label: 'Agents', color: '#f59e0b', icon: Users },
  bot: { label: 'AI / Bots', color: '#7c3aed', icon: MessageSquare },
};

export function MessagesDonut({ data }: { data: MessagesDonutData | null }) {
  const slices = (data?.slices ?? []).map((s) => ({
    label: s.label,
    count: s.count,
    color: SENDER_META[s.sender]?.color || '#7c3aed',
  }));
  const total = slices.reduce((s, x) => s + x.count, 0);
  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">Messages by sender</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Who is doing the talking</p>
      </header>
      <div className="flex flex-1 items-center gap-5 p-5">
        <Donut slices={slices} />
        <div className="min-w-0 flex-1 space-y-2">
          {slices.length === 0 && (
            <p className="text-xs text-muted-foreground">No messages yet</p>
          )}
          {slices.map((s) => {
            const pct = total ? Math.round((s.count / total) * 100) : 0;
            return (
              <div key={s.label} className="flex items-center gap-2.5 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="flex-1 truncate">{s.label}</span>
                <span className="tabular-nums font-medium">{s.count}</span>
                <span className="w-8 text-right tabular-nums text-muted-foreground">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
