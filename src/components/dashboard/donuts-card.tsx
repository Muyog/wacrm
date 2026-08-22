"use client";

import { Globe, MessageSquare, Users } from 'lucide-react';
import type { ChannelsDonutData, MessagesDonutData } from '@/lib/dashboard/types';

/* ------------------------------------------------------------------ */
/* Shared donut SVG                                                    */
/* ------------------------------------------------------------------ */

const SIZE = 96;
const STROKE = 16;
const CENTER = SIZE / 2;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

interface DonutSlice {
  label: string;
  count: number;
  color: string;
}

function Donut({ slices }: { slices: DonutSlice[] }) {
  const total = slices.reduce((s, x) => s + x.count, 0);
  if (total === 0) {
    return (
      <svg width={SIZE} height={SIZE} className="block shrink-0 opacity-40">
        <circle cx={CENTER} cy={CENTER} r={R} fill="none" stroke="hsl(var(--border))" strokeWidth={STROKE} />
      </svg>
    );
  }
  let offset = 0;
  return (
    <svg width={SIZE} height={SIZE} className="block shrink-0" viewBox={`0 0 ${SIZE} ${SIZE}`}>
      {slices.map((s, i) => {
        const dash = (s.count / total) * CIRC;
        const gap = CIRC - dash;
        const el = (
          <circle
            key={i}
            cx={CENTER}
            cy={CENTER}
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth={STROKE}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Combined card: channels + messages-by-sender, one block             */
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

const SENDER_COLORS: Record<string, string> = {
  customer: '#3b82f6',
  agent: '#f59e0b',
  bot: '#7c3aed',
};

export function DonutsCard({
  channels,
  messages,
}: {
  channels: ChannelsDonutData | null;
  messages: MessagesDonutData | null;
}) {
  const chSlices = (channels?.slices ?? []).map((s) => ({
    label: s.channel.charAt(0).toUpperCase() + s.channel.slice(1),
    count: s.count,
    color: CHANNEL_COLORS[s.channel] || '#7c3aed',
  }));
  const msgSlices = (messages?.slices ?? []).map((s) => ({
    label: s.label,
    count: s.count,
    color: SENDER_COLORS[s.sender] || '#7c3aed',
  }));

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">Channels &amp; messages</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Where conversations happen and who sends them
        </p>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-0 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {/* Channels half */}
        <div className="flex flex-col items-center justify-center gap-3 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Conversations by channel
          </p>
          <Donut slices={chSlices} />
          <div className="w-full space-y-1.5">
            {chSlices.length === 0 && (
              <p className="text-center text-xs text-muted-foreground">No conversations yet</p>
            )}
            {chSlices.map((s) => {
              const total = chSlices.reduce((a, b) => a + b.count, 0);
              const Icon = CHANNEL_ICONS[s.label.toLowerCase()] || Globe;
              const pct = total ? Math.round((s.count / total) * 100) : 0;
              return (
                <div key={s.label} className="flex items-center gap-2 text-[11px]">
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                    style={{ backgroundColor: s.color + '22' }}
                  >
                    <Icon className="h-2.5 w-2.5" style={{ color: s.color }} />
                  </span>
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="tabular-nums font-medium">{s.count}</span>
                  <span className="w-7 text-right tabular-nums text-muted-foreground">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Messages half */}
        <div className="flex flex-col items-center justify-center gap-3 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Messages by sender
          </p>
          <Donut slices={msgSlices} />
          <div className="w-full space-y-1.5">
            {msgSlices.length === 0 && (
              <p className="text-center text-xs text-muted-foreground">No messages yet</p>
            )}
            {msgSlices.map((s) => {
              const total = msgSlices.reduce((a, b) => a + b.count, 0);
              const pct = total ? Math.round((s.count / total) * 100) : 0;
              return (
                <div key={s.label} className="flex items-center gap-2 text-[11px]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="tabular-nums font-medium">{s.count}</span>
                  <span className="w-7 text-right tabular-nums text-muted-foreground">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
