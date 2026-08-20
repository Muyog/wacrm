'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SettingsPanelHead } from './settings-panel-head';

interface ToolDef {
  name: string;
  description: string;
}

interface BamisoroConfig {
  system_prompt: string;
  model: string;
  temperature: number;
  tools: ToolDef[];
  meta?: Record<string, unknown>;
}

const DEFAULT_CONFIG: BamisoroConfig = {
  system_prompt: '',
  model: 'gemini-2.5-flash',
  temperature: 0.4,
  tools: [],
};

export function BamisoroChatSettings() {
  const [cfg, setCfg] = useState<BamisoroConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoaded(false);
    try {
      const res = await fetch('/api/bamisoro-chat/config', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.data) {
        setCfg({ ...DEFAULT_CONFIG, ...data.data });
      } else {
        setCfg(DEFAULT_CONFIG);
      }
    } catch {
      setCfg(DEFAULT_CONFIG);
    } finally {
      setLoaded(true);
      setDirty(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (patch: Partial<BamisoroConfig>) => {
    setCfg((c) => (c ? { ...c, ...patch } : c));
    setDirty(true);
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch('/api/bamisoro-chat/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_prompt: cfg.system_prompt,
          model: cfg.model,
          temperature: cfg.temperature,
          tools: cfg.tools,
          meta: cfg.meta,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Save failed');
      }
      toast.success('Bamisoro Chat Intelligence config saved');
      setDirty(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Brand header */}
      <div className="flex items-center gap-4 rounded-xl border border-border bg-gradient-to-r from-[#7c3aed]/10 to-[#7c3aed]/5 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bamisoro-logo.png"
          alt="Bamisoro"
          className="h-12 w-12 rounded-lg object-contain"
        />
        <div>
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-[#7c3aed]" />
            <h2 className="text-base font-semibold text-foreground">
              Bamisoro Chat Intelligence
            </h2>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your Wema / ALAT WhatsApp assistant (Nola) mirrors into this inbox and
            pulls its persona from the settings below.
          </p>
        </div>
      </div>

      <SettingsPanelHead
        title="Assistant configuration"
        description="Edit Nola's system prompt, model and tools here. Changes apply to the next inbound WhatsApp message — no redeploy needed."
      />

      {!loaded ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading configuration…
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              System prompt
            </label>
            <Textarea
              value={cfg?.system_prompt ?? ''}
              onChange={(e) => update({ system_prompt: e.target.value })}
              rows={10}
              placeholder="You are Nola, the Bamisoro Chat Intelligence assistant…"
              className="font-mono text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Model
              </label>
              <Input
                value={cfg?.model ?? ''}
                onChange={(e) => update({ model: e.target.value })}
                placeholder="gemini-2.5-flash"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Temperature
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={cfg?.temperature ?? 0.4}
                onChange={(e) =>
                  update({ temperature: Number(e.target.value) || 0 })
                }
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Tools
            </label>
            <div className="space-y-2">
              {(cfg?.tools ?? []).map((tool, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border p-2"
                >
                  <Input
                    value={tool.name}
                    onChange={(e) => {
                      const tools = [...(cfg?.tools ?? [])];
                      tools[i] = { ...tools[i], name: e.target.value };
                      update({ tools });
                    }}
                    className="w-48 font-mono"
                    placeholder="tool_name"
                  />
                  <Input
                    value={tool.description}
                    onChange={(e) => {
                      const tools = [...(cfg?.tools ?? [])];
                      tools[i] = { ...tools[i], description: e.target.value };
                      update({ tools });
                    }}
                    placeholder="What the tool does"
                  />
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update({
                    tools: [
                      ...(cfg?.tools ?? []),
                      { name: '', description: '' },
                    ],
                  })
                }
              >
                + Add tool
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            {dirty ? (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            ) : null}
            <Button
              onClick={save}
              disabled={saving || !dirty}
              className="bg-[#7c3aed] hover:bg-[#6d28d9]"
            >
              {saving ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-4" />
              )}
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
