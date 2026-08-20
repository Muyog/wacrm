'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Plus, Pencil, Trash2, ExternalLink, Copy, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  system_prompt: string;
  model_provider: 'openai' | 'anthropic';
  model: string;
  temperature: number;
  max_tokens: number;
  tools: (string | Record<string, unknown>)[];
  auto_reply_enabled: boolean;
  website_enabled: boolean;
  widget_token: string | null;
  widget_title: string;
  widget_welcome_message: string;
  widget_primary_color: string;
  widget_position: 'left' | 'right';
  is_active: boolean;
}

interface CustomToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

interface CustomToolDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  parameters: CustomToolParameter[];
}

const PRESET_TOOL_OPTIONS: { id: string; label: string; desc: string }[] = [
  { id: 'knowledge_base', label: 'Knowledge base', desc: 'Answer from your uploaded docs (FAQs, policies, products).' },
  { id: 'handoff', label: 'Human handoff', desc: 'Hand over to a human agent when the visitor asks or when unsure.' },
  { id: 'calendar', label: 'Booking / scheduling', desc: 'Reserve for a future scheduling integration.' },
];

const PRESET_TOOL_IDS = PRESET_TOOL_OPTIONS.map((tool) => tool.id);

function emptyAgent(): Omit<Agent, 'id'> {
  return {
    name: '',
    description: '',
    avatar_url: null,
    system_prompt:
      'You are a helpful assistant for this business. Be concise, friendly, and accurate. If you cannot help, say so and offer to connect the customer with a human.',
    model_provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    max_tokens: 1024,
    tools: ['knowledge_base', 'handoff'],
    auto_reply_enabled: true,
    website_enabled: true,
    widget_token: null,
    widget_title: 'Chat with us',
    widget_welcome_message: 'Hi! How can we help you today?',
    widget_primary_color: '#7c3aed',
    widget_position: 'right',
    is_active: true,
  };
}

function presetToolIds(tools: (string | Record<string, unknown>)[]): string[] {
  return tools.filter((t): t is string => typeof t === 'string');
}

function customToolDefs(tools: (string | Record<string, unknown>)[]): CustomToolDefinition[] {
  return tools
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && !!t)
    .map((t) => ({
      id: String(t.id ?? t.name ?? crypto.randomUUID()),
      name: String(t.name ?? ''),
      description: String(t.description ?? ''),
      enabled: true,
      parameters: Array.isArray(t.parameters)
        ? (t.parameters as Record<string, unknown>[]).map((p) => ({
            name: String(p.name ?? ''),
            type: (p.type === 'number' || p.type === 'boolean' ? p.type : 'string') as CustomToolParameter['type'],
            description: String(p.description ?? ''),
            required: !!p.required,
          }))
        : [],
    }));
}

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

function encodeCustomTool(tool: CustomToolDefinition): Record<string, unknown> {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    type: 'custom',
    parameters: tool.parameters,
  };
}

export default function AgentsBuilderPage() {
  const { accountRole } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Omit<Agent, 'id'> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [keyPlaceholder, setKeyPlaceholder] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [customTools, setCustomTools] = useState<CustomToolDefinition[]>([]);
  const [editingCustomTool, setEditingCustomTool] = useState<CustomToolDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      setAgents(Array.isArray(data.agents) ? data.agents : []);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : '';

  const embedCode = (token: string | null) =>
    token
      ? `<script src="${origin}/widget/widget.js" data-widget="${token}" defer></script>`
      : '';

  const embedUrl = (token: string | null) => embedCode(token);

  const openNew = () => {
    setEditingId(null);
    setDraft({ ...emptyAgent() });
    setCustomTools([]);
    setKeyPlaceholder(null);
    setApiKeyInput('');
    setError(null);
  };

  const openEdit = (agent: Agent) => {
    setEditingId(agent.id);
    const presets = presetToolIds(agent.tools);
    const custom = customToolDefs(agent.tools);
    setDraft({
      name: agent.name,
      description: agent.description ?? '',
      avatar_url: agent.avatar_url,
      system_prompt: agent.system_prompt,
      model_provider: agent.model_provider,
      model: agent.model,
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
      tools: agent.tools,
      auto_reply_enabled: agent.auto_reply_enabled,
      website_enabled: agent.website_enabled,
      widget_token: agent.widget_token,
      widget_title: agent.widget_title,
      widget_welcome_message: agent.widget_welcome_message,
      widget_primary_color: agent.widget_primary_color,
      widget_position: agent.widget_position,
      is_active: agent.is_active,
    });
    setCustomTools(custom);
    setKeyPlaceholder('has-key');
    setApiKeyInput('');
    setError(null);
  };

  const close = () => {
    setDraft(null);
    setEditingId(null);
    setEditingCustomTool(null);
  };

  const buildToolPayload = useCallback((): (string | Record<string, unknown>)[] => {
    if (!draft) return [];
    return [...presetToolIds(draft.tools), ...customTools.map(encodeCustomTool)];
  }, [draft, customTools]);

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError('Give your agent a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        ...draft,
        tools: buildToolPayload(),
        generate_widget: draft.website_enabled && !draft.widget_token,
      };
      if (apiKeyInput.trim()) payload.api_key = apiKeyInput.trim();
      const res = await fetch(editingId ? `/api/agents/${editingId}` : '/api/agents', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      if (editingId) {
        const hk = await fetch(`/api/agents/${editingId}`);
        const hkd = await hk.json();
        setKeyPlaceholder(hkd?.has_key ? 'has-key' : null);
      }
      await loadAgents();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (agent: Agent) => {
    if (!confirm(`Delete agent "${agent.name}"? This also disables its website widget and unbinds its WhatsApp numbers.`)) return;
    try {
      await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
      await loadAgents();
    } catch {}
  };

  const togglePresetTool = (toolId: string) => {
    if (!draft) return;
    const current = presetToolIds(draft.tools);
    const next = current.includes(toolId)
      ? current.filter((t) => t !== toolId)
      : [...current, toolId];
    setDraft({
      ...draft,
      tools: [...next, ...customToolDefs(draft.tools)],
    } as Omit<Agent, 'id'>);
  };

  const addCustomTool = () => {
    setEditingCustomTool({
      id: uid(),
      name: '',
      description: '',
      enabled: true,
      parameters: [],
    });
  };

  const saveCustomTool = () => {
    if (!editingCustomTool || !editingCustomTool.name.trim()) return;
    setCustomTools((prev) => {
      const exists = prev.some((t) => t.id === editingCustomTool.id);
      const next = exists
        ? prev.map((t) => (t.id === editingCustomTool.id ? editingCustomTool : t))
        : [...prev, editingCustomTool];
      if (draft) {
        setDraft({
          ...draft,
          tools: [...presetToolIds(draft.tools), ...next.map(encodeCustomTool)] as Agent['tools'],
        });
      }
      return next;
    });
    setEditingCustomTool(null);
  };

  const removeCustomTool = (id: string) => {
    setCustomTools((prev) => prev.filter((t) => t.id !== id));
    if (draft) {
      setDraft({
        ...draft,
        tools: [
          ...presetToolIds(draft.tools),
          ...customToolDefs(draft.tools).filter((t) => t.id !== id).map(encodeCustomTool),
        ] as Agent['tools'],
      });
    }
  };

  const copyEmbed = async (token: string | null) => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(embedUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };

  const canEdit = accountRole === 'owner' || accountRole === 'admin';

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Loading agents…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-sm text-muted-foreground">
            AI agents for WhatsApp and your website — each with its own prompt, tools and channels.{' '}
            <a href="/agents/playground" className="underline hover:text-foreground">Open AI playground →</a>
          </p>
        </div>
        {canEdit && (
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" /> New Agent
          </Button>
        )}
      </div>

      {agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="pt-12 pb-12 flex flex-col items-center text-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-medium">No agents yet</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Create your first AI agent — give it instructions, pick a model and provider, and
                connect it to WhatsApp numbers or a website widget.
              </p>
            </div>
            {canEdit && (
              <Button onClick={openNew}>
                <Plus className="mr-2 h-4 w-4" /> Create your first agent
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Bot className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{agent.name}</CardTitle>
                      <CardDescription className="text-xs">
                        {agent.model_provider} · {agent.model}
                      </CardDescription>
                    </div>
                  </div>
                  {agent.is_active ? (
                    <Badge variant="default">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Paused</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {agent.description || 'No description'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {agent.website_enabled && (
                    <Badge variant="outline">🌐 Website</Badge>
                  )}
                  <Badge variant="outline">💬 WhatsApp</Badge>
                  {agent.tools.includes('knowledge_base') && (
                    <Badge variant="outline">📚 Knowledge</Badge>
                  )}
                  {agent.tools.includes('handoff') && (
                    <Badge variant="outline">🤝 Handoff</Badge>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  {canEdit && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => openEdit(agent)}>
                        <Pencil className="mr-1 h-3 w-3" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(agent)}>
                        <Trash2 className="mr-1 h-3 w-3" /> Delete
                      </Button>
                    </>
                  )}
                  {agent.website_enabled && agent.widget_token && (
                    <div className="ml-auto flex items-center gap-1">
                      <a
                        href={`/widget/preview?token=${agent.widget_token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        Preview ↗
                      </a>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyEmbed(agent.widget_token)}
                      >
                        {copied === agent.widget_token ? (
                          <Check className="mr-1 h-3 w-3" />
                        ) : (
                          <Copy className="mr-1 h-3 w-3" />
                        )}
                        Embed
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Editor */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[92vh] overflow-hidden p-0">
          <div className="max-h-[92vh] overflow-y-auto px-6 py-6">
            <DialogHeader className="mb-6">
              <DialogTitle>{editingId ? 'Edit agent' : 'New agent'}</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Build one AI agent and use it across WhatsApp and your website widget.
              </p>
            </DialogHeader>

            {draft && (
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                {/* LEFT: basics + model */}
                <div className="space-y-8">
                  <section className="space-y-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Basics
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="ag-name">Name *</Label>
                        <Input
                          id="ag-name"
                          value={draft.name}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          placeholder="e.g. Support Bot"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ag-desc">Description</Label>
                        <Input
                          id="ag-desc"
                          value={draft.description ?? ''}
                          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                          placeholder="Internal note"
                        />
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4 border-t border-border pt-6">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Model
                    </h3>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="ag-model">Provider &amp; model</Label>
                        <Select
                          value={`${draft.model_provider}:${draft.model}`}
                          onValueChange={(v) => {
                            const val = v ?? `${draft.model_provider}:${draft.model}`;
                            const [provider, ...rest] = val.split(':');
                            setDraft({
                              ...draft,
                              model_provider: provider as 'openai' | 'anthropic',
                              model: rest.join(':'),
                            });
                          }}
                        >
                          <SelectTrigger id="ag-model">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai:gpt-4o-mini">OpenAI · GPT-4o mini</SelectItem>
                            <SelectItem value="openai:gpt-4o">OpenAI · GPT-4o</SelectItem>
                            <SelectItem value="openai:gpt-4.1-mini">OpenAI · GPT-4.1 mini</SelectItem>
                            <SelectItem value="anthropic:claude-sonnet-4-6">
                              Anthropic · Claude Sonnet 4.6
                            </SelectItem>
                            <SelectItem value="anthropic:claude-3-5-haiku-latest">
                              Anthropic · Claude Haiku
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="ag-temp">Temperature</Label>
                          <Input
                            id="ag-temp"
                            type="number"
                            min={0}
                            max={1}
                            step={0.1}
                            value={draft.temperature}
                            onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ag-max">Max tokens</Label>
                          <Input
                            id="ag-max"
                            type="number"
                            min={128}
                            step={128}
                            value={draft.max_tokens}
                            onChange={(e) => setDraft({ ...draft, max_tokens: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                {/* RIGHT: behavior + tools + channels */}
                <div className="space-y-8">
                  <section className="space-y-4 border-t border-border pt-6">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Behavior
                    </h3>
                    <div className="space-y-2">
                      <Label htmlFor="ag-prompt">System prompt *</Label>
                      <Textarea
                        id="ag-prompt"
                        className="min-h-[160px] font-mono text-xs leading-5"
                        value={draft.system_prompt}
                        onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
                        placeholder="You are the support assistant for…"
                      />
                    </div>
                  </section>

                  <section className="space-y-4 border-t border-border pt-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Tools
                      </h3>
                      <Button size="sm" variant="outline" onClick={addCustomTool}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        New tool
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {PRESET_TOOL_OPTIONS.map((tool) => (
                        <label
                          key={tool.id}
                          className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={presetToolIds(draft.tools).includes(tool.id)}
                            onChange={() => togglePresetTool(tool.id)}
                          />
                          <div>
                            <p className="text-sm font-medium">{tool.label}</p>
                            <p className="text-xs text-muted-foreground">{tool.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                    {customTools.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {customTools.map((tool) => (
                          <div
                            key={tool.id}
                            className="flex items-start justify-between gap-2 rounded-lg border p-3"
                          >
                            <div>
                              <p className="text-sm font-medium">{tool.name}</p>
                              <p className="text-xs text-muted-foreground">{tool.description}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                onClick={() => setEditingCustomTool(tool)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-red-500"
                                onClick={() => removeCustomTool(tool.id)}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="space-y-4 border-t border-border pt-6">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Channels
                    </h3>
                    <div className="space-y-3 rounded-lg border p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Website widget</p>
                          <p className="text-xs text-muted-foreground">
                            Embed a chat bubble on your website — conversations appear in the inbox.
                          </p>
                        </div>
                        <Switch
                          checked={draft.website_enabled}
                          onCheckedChange={(v) => setDraft({ ...draft, website_enabled: v })}
                        />
                      </div>
                      {draft.website_enabled && (
                        <div className="grid gap-4 pt-1 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="ag-wtitle">Widget title</Label>
                            <Input
                              id="ag-wtitle"
                              value={draft.widget_title}
                              onChange={(e) => setDraft({ ...draft, widget_title: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="ag-wcolor">Accent color</Label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                className="h-9 w-12 cursor-pointer rounded-md border"
                                value={draft.widget_primary_color}
                                onChange={(e) => setDraft({ ...draft, widget_primary_color: e.target.value })}
                              />
                              <Input
                                id="ag-wcolor"
                                value={draft.widget_primary_color}
                                onChange={(e) => setDraft({ ...draft, widget_primary_color: e.target.value })}
                              />
                            </div>
                          </div>
                          <div className="space-y-2 sm:col-span-2">
                            <Label htmlFor="ag-welcome">Welcome message</Label>
                            <Input
                              id="ag-welcome"
                              value={draft.widget_welcome_message}
                              onChange={(e) => setDraft({ ...draft, widget_welcome_message: e.target.value })}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="ag-akey">
                        Agent API key (optional — falls back to account AI key)
                      </Label>
                      <Input
                        id="ag-akey"
                        type="password"
                        placeholder={keyPlaceholder ? '•••••••• (key saved — leave blank to keep)' : 'sk-… / anthropic key'}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                      />
                    </div>

                    {draft.website_enabled && draft.widget_token && (
                      <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
                        <Label>Embed on your website</Label>
                        <code className="block overflow-x-auto rounded bg-muted px-3 py-2 text-xs">
                          {embedUrl(draft.widget_token)}
                        </code>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => copyEmbed(draft.widget_token)}>
                            <ExternalLink className="mr-1 h-3 w-3" /> Copy embed code
                          </Button>
                          <a
                            href={`/widget/preview?token=${draft.widget_token}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            Open preview ↗
                          </a>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Paste the snippet into your site&apos;s <code>&lt;body&gt;</code>.
                        </p>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}

            {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? 'Save changes' : 'Create agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom tool editor */}
      <Dialog open={!!editingCustomTool} onOpenChange={(o) => !o && setEditingCustomTool(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCustomTool && editingCustomTool.name ? 'Edit tool' : 'New custom tool'}</DialogTitle>
          </DialogHeader>
          {editingCustomTool && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ct-name">Tool name *</Label>
                <Input
                  id="ct-name"
                  value={editingCustomTool.name}
                  onChange={(e) =>
                    setEditingCustomTool({ ...editingCustomTool, name: e.target.value })
                  }
                  placeholder="e.g. check_order_status"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-desc">Description</Label>
                <Textarea
                  id="ct-desc"
                  className="min-h-[80px] text-xs"
                  value={editingCustomTool.description}
                  onChange={(e) =>
                    setEditingCustomTool({ ...editingCustomTool, description: e.target.value })
                  }
                  placeholder="What does this tool do? When should the agent use it?"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Parameters</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditingCustomTool({
                        ...editingCustomTool,
                        parameters: [
                          ...editingCustomTool.parameters,
                          { name: '', type: 'string', description: '', required: true },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add parameter
                  </Button>
                </div>
                {editingCustomTool.parameters.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No parameters yet. Add the fields the agent must fill to use this tool.
                  </p>
                )}
                <div className="space-y-2">
                  {editingCustomTool.parameters.map((param, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 rounded-lg border p-2">
                      <div className="col-span-4 space-y-1">
                        <Label className="text-[11px]">Name</Label>
                        <Input
                          className="h-7 text-xs"
                          value={param.name}
                          onChange={(e) => {
                            const next = [...editingCustomTool.parameters];
                            next[idx] = { ...param, name: e.target.value };
                            setEditingCustomTool({ ...editingCustomTool, parameters: next });
                          }}
                          placeholder="e.g. order_id"
                        />
                      </div>
                      <div className="col-span-3 space-y-1">
                        <Label className="text-[11px]">Type</Label>
                        <Select
                          value={param.type}
                          onValueChange={(v) => {
                            const next = [...editingCustomTool.parameters];
                            next[idx] = {
                              ...param,
                              type: v as CustomToolParameter['type'],
                            };
                            setEditingCustomTool({ ...editingCustomTool, parameters: next });
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="string">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="boolean">True / False</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3 space-y-1">
                        <Label className="text-[11px]">Description</Label>
                        <Input
                          className="h-7 text-xs"
                          value={param.description}
                          onChange={(e) => {
                            const next = [...editingCustomTool.parameters];
                            next[idx] = { ...param, description: e.target.value };
                            setEditingCustomTool({ ...editingCustomTool, parameters: next });
                          }}
                          placeholder="What is this field?"
                        />
                      </div>
                      <div className="col-span-2 flex flex-col items-end justify-between pt-4">
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox"
                            className="h-3 w-3"
                            checked={param.required}
                            onChange={(e) => {
                              const next = [...editingCustomTool.parameters];
                              next[idx] = { ...param, required: e.target.checked };
                              setEditingCustomTool({ ...editingCustomTool, parameters: next });
                            }}
                          />
                          Required
                        </label>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px] text-red-500"
                          onClick={() => {
                            const next = editingCustomTool.parameters.filter((_, i) => i !== idx);
                            setEditingCustomTool({ ...editingCustomTool, parameters: next });
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingCustomTool(null)}>
                  Cancel
                </Button>
                <Button onClick={saveCustomTool} disabled={!editingCustomTool.name.trim()}>
                  Save tool
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}