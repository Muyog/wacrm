"use client";

import { Hash } from 'lucide-react';
import type { TopicsData } from '@/lib/dashboard/types';

export function TopicsCloud({ data }: { data: TopicsData | null }) {
  const rows = data?.rows ?? [];
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0);

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">Trending topics</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">What customers are discussing</p>
      </header>
      <div className="flex flex-1 flex-wrap content-start gap-2 p-5">
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Topics appear as conversations are tagged — enable topic extraction in an agent to start tracking.
          </p>
        )}
        {rows.map((r) => {
          const scale = maxCount > 0 ? 0.75 + (r.count / maxCount) * 0.6 : 1;
          return (
            <span
              key={r.id}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5"
              style={{
                fontSize: `${scale * 0.8125}rem`,
                borderColor: r.color + '40',
                backgroundColor: r.color + '12',
              }}
            >
              <Hash className="h-3 w-3" style={{ color: r.color }} />
              <span className="font-medium" style={{ color: r.color }}>
                {r.label}
              </span>
              <span className="tabular-nums text-muted-foreground">{r.count}</span>
            </span>
          );
        })}
      </div>
    </section>
  );
}
