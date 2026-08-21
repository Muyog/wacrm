'use client';

/**
 * AI Agents — builder + live widget preview.
 *
 * Layout: full-width workspace. Left = agent list / editor form.
 * Right = sticky live chat panel that talks to the real agent through
 * the same public widget API the embeddable bubble uses, so what you
 * test here is exactly what a website visitor experiences.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  Send,
  X,
  Globe,
  MessageCircle,
  BookOpen,
  HandMetal,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  model_provider: 'openai' | 'anthropic' | 'gemini';
  model: string;
  temperature: number;
  max_tokens: number;
  tools: string[];
  auto_reply_enabled: boolean;
  website_enabled: boolean;
  widget_token: string | null;
  widget_title: string;
  widget_welcome_message: string;
  widget_primary_color: string;
  widget_position: 'left' | 'right';
  is_active: boolean;
}

const TOOL_OPTIONS = [
  { id: 'knowledge_base', label: 'Knowledge base', desc: 'Answer from your uploaded docs — FAQs, policies, products.', icon: BookOpen },
  { id: 'handoff', label: 'Human handoff', desc: 'Pass the chat to a human agent when unsure or asked.', icon: HandMetal },
];

function emptyAgent(): Omit<Agent, 'id'> {
  return {
    name: '',
    description: '',
    avatar_url: null,
    system_prompt:
      'You are a helpful assistant for this business. Be concise, friendly, and accurate. If you cannot help, say so and offer to connect the customer with a human.',
    model_provider: 'gemini',
    model: 'gemini-2.5-flash',
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

/* ------------------------------------------------------------------ */
/* Live chat preview — talks through the public widget API             */
/* ------------------------------------------------------------------ */

function ChatPreview({ agent }: { agent: Agent }) {
  const [messages, setMessages] = useState<{ role: 'bot' | 'user'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const visitorRef = useRef<string>('');

  // Reset the thread when switching agents.
  useEffect(() => {
    setMessages([{ role: 'bot', text: agent.widget_welcome_message || 'Hi! How can we help you today?' }]);
    visitorRef.current = 'preview-' + agent.id.slice(0, 8) + '-' + Math.random().toString(36).slice(2, 8);
  }, [agent.id, agent.widget_welcome_message]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !agent.widget_token) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const res = await fetch(`/api/widget/${agent.widget_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, visitor: visitorRef.current, name: 'You (preview)' }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: 'bot', text: data.reply || '(no reply — check the agent has an API key configured)' },
      ]);
    } catch {
      setMessages((m) => [...m, { role: 'bot', text: 'Network error — please try again.' }]);
    } finally {
      setBusy(false);
    }
  };

  const color = agent.widget_primary_color || '#7c3aed';

  return (
    <div className="flex h-[560px] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Header mimicking the real widget */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: color }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {agent.widget_title || agent.name}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Live preview — replies come from your agent
          </p>
        </div>
      </div>

      {/* Messages */}
      <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
              style={
                m.role === 'user'
                  ? { backgroundColor: color, color: '#fff', borderBottomRightRadius: 6 }
                  : { backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))', borderBottomLeftRadius: 6 }
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border bg-card px-4 py-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 border-t bg-card p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={agent.widget_token ? 'Type a message…' : 'Enable the website widget to test'}
          disabled={!agent.widget_token || busy}
        />
        <Button size="icon" onClick={send} disabled={!agent.widget_token || busy || !input.trim()} style={{ backgroundColor: color }}>
          <Send className="h-4 w-4 text-white" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function AgentsBuilderPage() {
  const { accountRole } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<Agent, 'id'> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = accountRole === 'owner' || accountRole === 'admin';

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      const list: Agent[] = Array.isArray(data.agents) ? data.agents : [];
      setAgents(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const selected = agents.find((a) => a.id === selectedId) ?? null;

  // Load has_key for the selected agent.
  useEffect(() => {
    if (!selectedId) return;
    fetch(`/api/agents/${selectedId}`)
      .then((r) => r.json())
      .then((d) => setHasKey(!!d?.has_key))
      .catch(() => setHasKey(false));
  }, [selectedId]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const embedCode = (token: string | null) =>
    token
      ? `<script src="${origin}/widget/widget.js" data-widget="${token}" defer></script>`
      : '';

  const openNew = () => {
    setEditingId(null);
    setDraft({ ...emptyAgent() });
    setApiKeyInput('');
    setError(null);
  };

  const openEdit = (agent: Agent) => {
    setSelectedId(agent.id);
    setEditingId(agent.id);
    setDraft({
      name: agent.name,
      description: agent.description ?? '',
      avatar_url: agent.avatar_url,
      system_prompt: agent.system_prompt,
      model_provider: agent.model_provider,
      model: agent.model,
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
      tools: [...agent.tools],
      auto_reply_enabled: agent.auto_reply_enabled,
      website_enabled: agent.website_enabled,
      widget_token: agent.widget_token,
      widget_title: agent.widget_title,
      widget_welcome_message: agent.widget_welcome_message,
      widget_primary_color: agent.widget_primary_color,
      widget_position: agent.widget_position,
      is_active: agent.is_active,
    });
    setApiKeyInput('');
    setError(null);
  };

  const close = () => {
    setDraft(null);
    setEditingId(null);
  };

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

      await loadAgents();
      if (!editingId && data.agent?.id) setSelectedId(data.agent.id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (agent: Agent) => {
    if (!confirm(`Delete "${agent.name}"? Its widget stops working and its WhatsApp numbers become unbound.`)) return;
    await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' }).catch(() => {});
    if (selectedId === agent.id) setSelectedId(null);
    await loadAgents();
  };

  const toggleTool = (toolId: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      tools: draft.tools.includes(toolId)
        ? draft.tools.filter((t) => t !== toolId)
        : [...draft.tools, toolId],
    });
  };

  const copyEmbed = async (token: string | null) => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(embedCode(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">Loading agents…</div>
    );
  }

  return (
    <div className="space-y-6 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build assistants for WhatsApp and your website — prompt, model, tools, channels.
            {' '}
            <a href="/agents/playground" className="underline underline-offset-2 hover:text-foreground">
              Open playground →
            </a>
          </p>
        </div>
        {canEdit && (
          <Button onClick={openNew} size="lg">
            <Plus className="mr-2 h-4 w-4" /> New Agent
          </Button>
        )}
      </div>

      {agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-medium">No agents yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Create your first AI agent — give it instructions, pick a model, connect WhatsApp
                numbers or a website widget.
              </p>
            </div>
            {canEdit && (
              <Button onClick={openNew} className="mt-2">
                <Plus className="mr-2 h-4 w-4" /> Create your first agent
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Wide two-column workspace */
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          {/* LEFT: editor / details */}
          <div className="min-w-0 space-y-6">
            {!draft && selected && (
              <>
                {/* Identity strip */}
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-5 p-6">
                    <div
                      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl"
                      style={{ backgroundColor: (selected.widget_primary_color || '#7c3aed') + '22' }}
                    >
                      <Bot className="h-8 w-8" style={{ color: selected.widget_primary_color || '#7c3aed' }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-xl font-bold">{selected.name}</h2>
                        {selected.is_active ? (
                          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="secondary">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Paused</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {selected.description || 'No description'}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline" className="gap-1">
                          <Sparkles className="h-3 w-3" /> {selected.model_provider} · {selected.model}
                        </Badge>
                        {selected.website_enabled && selected.widget_token && (
                          <Badge variant="outline" className="gap-1"><Globe className="h-3 w-3" /> Website</Badge>
                        )}
                        <Badge variant="outline" className="gap-1"><MessageCircle className="h-3 w-3" /> WhatsApp</Badge>
                        {hasKey ? (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">API key ✓</Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">No API key</Badge>
                        )}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => openEdit(selected)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit agent
                        </Button>
                        {selected.website_enabled && selected.widget_token && (
                          <>
                            <a
                          href={`/widget/preview?token=${selected.widget_token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-transparent px-4 text-sm font-medium transition-colors hover:bg-muted"
                        >
                          <ExternalLink className="h-4 w-4" /> Full-page preview
                        </a>
                            <Button variant="outline" onClick={() => copyEmbed(selected.widget_token)}>
                              {copied === selected.widget_token ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                              Embed code
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" onClick={() => remove(selected)} className="text-destructive hover:text-destructive">
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Embed section */}
                {selected.website_enabled && selected.widget_token && (
                  <Card>
                    <CardContent className="space-y-3 p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold">Add to your website</h3>
                          <p className="text-sm text-muted-foreground">
                            Paste this snippet before <code className="rounded bg-muted px-1">&lt;/body&gt;</code> on every page.
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => copyEmbed(selected.widget_token)}>
                          {copied === selected.widget_token ? <Check className="mr-2 h-3 w-3" /> : <Copy className="mr-2 h-3 w-3" />}
                          Copy
                        </Button>
                      </div>
                      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs leading-relaxed">
                        {embedCode(selected.widget_token)}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {/* Tools + prompt live in the Edit dialog — keep this
                    page a clean overview. Show a one-line summary only. */}
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-5 text-sm text-muted-foreground">
                    <span>
                      <strong className="text-foreground">{selected.tools.length}</strong> tool{selected.tools.length === 1 ? '' : 's'} enabled
                      {selected.tools.length > 0 && (
                        <span className="ml-1">({selected.tools.map((t) => t === 'knowledge_base' ? 'Knowledge base' : t === 'handoff' ? 'Human handoff' : t).join(', ')})</span>
                      )}
                    </span>
                    <span className="hidden sm:inline text-border">|</span>
                    <span>Prompt: {selected.system_prompt.trim().split(/\s+/).length} words</span>
                    <Button variant="link" size="sm" className="ml-auto h-auto p-0" onClick={() => openEdit(selected)}>
                      Configure in editor →
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}

            {/* Other agents */}
            {agents.length > 1 && !draft && (
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  All agents ({agents.length})
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {agents
                    .filter((a) => a.id !== selectedId)
                    .map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setSelectedId(a.id)}
                        className="flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                          <Bot className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{a.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{a.model_provider} · {a.model}</p>
                        </div>
                        {a.is_active ? (
                          <span className="h-2 w-2 rounded-full bg-emerald-500" title="Active" />
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" title="Paused" />
                        )}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: live chat preview */}
          {selected && !draft && (
            <div className="space-y-3 xl:sticky xl:top-6 xl:self-start">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground">Live preview</h3>
                <span className="text-xs text-muted-foreground">Test replies in real time</span>
              </div>
              <ChatPreview agent={selected} />
              {!hasKey && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  This agent has no API key yet — open <strong>Edit agent</strong> and paste your
                  Gemini / OpenAI key to see real replies.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------------- Edit dialog ---------------- */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[94vh] w-full max-w-5xl overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              {editingId ? `Edit — ${draft?.name}` : 'Create a new agent'}
            </DialogTitle>
          </DialogHeader>

          {draft && (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Column 1 — identity + behavior */}
              <div className="space-y-5">
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
                  <Label htmlFor="ag-desc">Description (internal)</Label>
                  <Input
                    id="ag-desc"
                    value={draft.description ?? ''}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="What is this agent for?"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Provider &amp; model</Label>
                    <Select
                      value={`${draft.model_provider}:${draft.model}`}
                      onValueChange={(v) => {
                        const val = v ?? `${draft.model_provider}:${draft.model}`;
                        const [provider, ...rest] = val.split(':');
                        setDraft({
                          ...draft,
                          model_provider: provider as Agent['model_provider'],
                          model: rest.join(':'),
                        });
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gemini:gemini-2.5-flash">Google · Gemini 2.5 Flash</SelectItem>
                        <SelectItem value="gemini:gemini-2.5-pro">Google · Gemini 2.5 Pro</SelectItem>
                        <SelectItem value="openai:gpt-4o-mini">OpenAI · GPT-4o mini</SelectItem>
                        <SelectItem value="openai:gpt-4o">OpenAI · GPT-4o</SelectItem>
                        <SelectItem value="anthropic:claude-sonnet-4-6">Anthropic · Claude Sonnet 4.6</SelectItem>
                        <SelectItem value="anthropic:claude-3-5-haiku-latest">Anthropic · Claude Haiku</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ag-prompt">System prompt *</Label>
                  <Textarea
                    id="ag-prompt"
                    className="min-h-[180px] font-mono text-xs"
                    value={draft.system_prompt}
                    onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ag-akey">
                    API key {hasKey && editingId ? '(saved — leave blank to keep)' : '(optional — falls back to account key)'}
                  </Label>
                  <Input
                    id="ag-akey"
                    type="password"
                    placeholder="AIza… / sk-… / sk-ant-…"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                </div>
              </div>

              {/* Column 2 — tools + channels */}
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label>Tools</Label>
                  {TOOL_OPTIONS.map((tool) => (
                    <label
                      key={tool.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={draft.tools.includes(tool.id)}
                        onChange={() => toggleTool(tool.id)}
                      />
                      <tool.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-medium">{tool.label}</p>
                        <p className="text-xs text-muted-foreground">{tool.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="space-y-4 rounded-xl border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <Globe className="h-4 w-4 text-primary" /> Website widget
                      </p>
                      <p className="text-xs text-muted-foreground">Chat bubble on your site → inbox.</p>
                    </div>
                    <Switch
                      checked={draft.website_enabled}
                      onCheckedChange={(v) => setDraft({ ...draft, website_enabled: v })}
                    />
                  </div>
                  {draft.website_enabled && (
                    <div className="space-y-3 border-t pt-3">
                      <div className="space-y-2">
                        <Label htmlFor="ag-wtitle">Widget title</Label>
                        <Input
                          id="ag-wtitle"
                          value={draft.widget_title}
                          onChange={(e) => setDraft({ ...draft, widget_title: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ag-welcome">Welcome message</Label>
                        <Textarea
                          id="ag-welcome"
                          rows={2}
                          value={draft.widget_welcome_message}
                          onChange={(e) => setDraft({ ...draft, widget_welcome_message: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Accent color</Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              className="h-9 w-12 cursor-pointer rounded-md border"
                              value={draft.widget_primary_color}
                              onChange={(e) => setDraft({ ...draft, widget_primary_color: e.target.value })}
                            />
                            <Input
                              value={draft.widget_primary_color}
                              onChange={(e) => setDraft({ ...draft, widget_primary_color: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Position</Label>
                          <Select
                            value={draft.widget_position}
                            onValueChange={(v) => setDraft({ ...draft, widget_position: (v ?? 'right') as 'left' | 'right' })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="right">Bottom right</SelectItem>
                              <SelectItem value="left">Bottom left</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-xl border p-4">
                  <div>
                    <p className="text-sm font-medium">WhatsApp auto-reply</p>
                    <p className="text-xs text-muted-foreground">Agent answers bound numbers automatically.</p>
                  </div>
                  <Switch
                    checked={draft.auto_reply_enabled}
                    onCheckedChange={(v) => setDraft({ ...draft, auto_reply_enabled: v })}
                  />
                </div>

                <div className="flex items-center justify-between rounded-xl border p-4">
                  <div>
                    <p className="text-sm font-medium">Agent active</p>
                    <p className="text-xs text-muted-foreground">Paused agents stop replying everywhere.</p>
                  </div>
                  <Switch
                    checked={draft.is_active}
                    onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                  />
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? 'Save changes' : 'Create agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}