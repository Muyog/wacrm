'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function WidgetPreviewInner() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [loaded, setLoaded] = useState(false);

  // The origin the preview page is served from == the widget script origin.
  const origin =
    typeof window !== 'undefined' ? window.location.origin : '';

  // Inject the widget script once we have a token.
  useEffect(() => {
    if (!token || loaded) return;
    const existing = document.getElementById('bamisoro-preview-script');
    if (existing) {
      setLoaded(true);
      return;
    }
    const s = document.createElement('script');
    s.id = 'bamisoro-preview-script';
    s.src = `${origin}/widget/widget.js`;
    s.dataset.widget = token;
    s.defer = true;
    s.onload = () => setLoaded(true);
    document.body.appendChild(s);
    setLoaded(true);
  }, [token, loaded, origin]);

  const embedSnippet = useMemo(
    () =>
      token
        ? `<script src="${origin}/widget/widget.js" data-widget="${token}" defer></script>`
        : '',
    [token, origin],
  );

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div className="max-w-md">
          <h1 className="text-lg font-semibold text-foreground">
            No widget token
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Open this page from an agent&apos;s editor (Settings → AI Agents →
            edit → Preview), or pass <code>?token=…</code> in the URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-background to-muted/40">
      {/* Demo page content so the widget has something to sit on. */}
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          Widget preview — this is a sample page
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Bamisoro Chat Intelligence
        </h1>
        <p className="mt-3 text-muted-foreground">
          This page mimics a customer website. The chat bubble in the corner
          is the live widget — open it and send a message to test the
          experience. Replies appear here and in your wacrm inbox.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-medium text-foreground">
            Embed code (paste into your site&apos;s &lt;body&gt;)
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs text-foreground">
            <code>{embedSnippet}</code>
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Tip: add <code>data-name=&quot;Visitor Name&quot;</code> to prefill the
            visitor name, or <code>data-visitor=&quot;id&quot;</code> to keep one
            thread per known user.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function WidgetPreviewPage() {
  return (
    <Suspense fallback={null}>
      <WidgetPreviewInner />
    </Suspense>
  );
}
