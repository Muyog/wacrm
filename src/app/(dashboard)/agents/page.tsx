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
  Wrench,
  MessageSquare,
  Hash,
  ArrowDown,
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

interface CustomTool {
  type: 'custom';
  name: string;
  description: string;
}

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
  tools: (string | CustomTool)[];
  auto_reply_enabled: boolean;
  website_enabled: boolean;
  widget_token: string | null;
  widget_title: string;
  widget_welcome_message: string;
  widget_primary_color: string;
  widget_position: 'left' | 'right';
  is_active: boolean;
  pre_chat_config: PreChatConfig;
}

interface PreChatCollectInfo { name?: boolean; email?: boolean; phone?: boolean; company?: boolean }
interface PreChatOption { label: string; next: string }
interface PreChatNode { id?: string; message: string; options?: PreChatOption[] }
interface PreChatDialogTree { nodes: Record<string, PreChatNode>; start_node: string }
interface PreChatConfig {
  enabled: boolean;
  collect_info?: PreChatCollectInfo;
  dialog_tree?: PreChatDialogTree;
  ai_fallback?: boolean;
  start_with_ai?: boolean;
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
    pre_chat_config: {
      enabled: false,
      collect_info: { name: true, email: false, phone: false, company: false },
      dialog_tree: { nodes: {}, start_node: '' },
      ai_fallback: true,
      start_with_ai: false,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Live chat preview — talks through the public widget API, and runs   */
/* the SAME pre-chat flow as the embeddable widget: info form →        */
/* dialog tree (quick replies) → free AI chat.                         */
/* ------------------------------------------------------------------ */

type FlowStep =
  | { kind: 'msg'; role: 'bot' | 'user'; text: string }
  | { kind: 'form'; fields: Required<Pick<PreChatCollectInfo, 'name' | 'email' | 'phone' | 'company'>> extends never ? string[] : string[] }
  | { kind: 'quick'; node: PreChatNode };

function ChatPreview({ agent }: { agent: Agent }) {
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const visitorRef = useRef<string>('');
  const infoRef = useRef<Record<string, string>>({});
  const pathRef = useRef<{ node: string; label: string }[]>([]);
  const readyRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [chatReady, setChatReady] = useState(false);

  const pc = agent.pre_chat_config || {};
  const pcEnabled = !!pc.enabled && !pc.start_with_ai;

  // Reset the thread when switching agents or changing config.
  useEffect(() => {
    visitorRef.current = 'preview-' + agent.id.slice(0, 8) + '-' + Math.random().toString(36).slice(2, 8);
    infoRef.current = {};
    pathRef.current = [];
    readyRef.current = false;
    setChatReady(false);
    const initial: FlowStep[] = [{ kind: 'msg', role: 'bot', text: agent.widget_welcome_message || 'Hi! How can we help you today?' }];
    if (!pcEnabled) {
      readyRef.current = true;
      setChatReady(true);
    } else {
      const collect = pc.collect_info || {};
      const hasForm = collect.name || collect.email || collect.phone || collect.company;
      if (hasForm) {
        initial.push({
          kind: 'form',
          fields: (['name', 'email', 'phone', 'company'] as const).filter((f) => collect[f]),
        });
      } else {
        startTree(initial);
      }
    }
    setSteps(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [steps, busy]);

  function startTree(list: FlowStep[]) {
    const tree = pc.dialog_tree;
    if (tree && tree.nodes && tree.start_node && tree.nodes[tree.start_node]) {
      list.push({ kind: 'quick', node: tree.nodes[tree.start_node] });
    } else {
      unlock();
    }
  }

  function unlock() {
    readyRef.current = true;
    setChatReady(true);
  }

  /* --- form submit --- */
  const handleFormSubmit = (values: Record<string, string>, fields: string[]) => {
    infoRef.current = values;
    const summary = fields.map((f) => `${f.charAt(0).toUpperCase() + f.slice(1)}: ${values[f] || '—'}`).join('  •  ');
    setSteps((s) => [...s, { kind: 'msg', role: 'user', text: summary }]);
    // Next: dialog tree (or straight to AI)
    setSteps((s) => {
      const next = [...s];
      const tree = pc.dialog_tree;
      if (tree && tree.nodes && tree.start_node && tree.nodes[tree.start_node]) {
        next.push({ kind: 'quick', node: tree.nodes[tree.start_node] });
      } else {
        unlock();
      }
      return next;
    });
  };

  /* --- quick reply click --- */
  const handleQuickReply = (node: PreChatNode, opt: PreChatOption) => {
    pathRef.current.push({ node: node.id || '', label: opt.label });
    const nextSteps: FlowStep[] = [{ kind: 'msg', role: 'user', text: opt.label }];
    const tree = pc.dialog_tree;
    if (opt.next === '__ai__') {
      unlock();
    } else if (tree?.nodes?.[opt.next]) {
      nextSteps.push({ kind: 'quick', node: tree.nodes[opt.next] });
    } else {
      unlock();
    }
    setSteps((s) => [...s, ...nextSteps]);
  };

  /* --- free chat send --- */
  const send = async () => {
    const text = input.trim();
    if (!text || busy || !agent.widget_token || !readyRef.current) return;
    setInput('');
    setSteps((s) => [...s, { kind: 'msg', role: 'user', text }]);
    setBusy(true);
    try {
      const res = await fetch(`/api/widget/${agent.widget_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          visitor: visitorRef.current,
          name: infoRef.current.name || 'You (preview)',
          customer_info: Object.keys(infoRef.current).length ? infoRef.current : undefined,
          flow_path: pathRef.current.length ? pathRef.current : undefined,
        }),
      });
      const data = await res.json();
      setSteps((m) => [
        ...m,
        { kind: 'msg', role: 'bot', text: data.reply || '(no reply — check the agent has an API key configured)' },
      ]);
    } catch {
      setSteps((m) => [...m, { kind: 'msg', role: 'bot', text: 'Network error — please try again.' }]);
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

      {/* Messages + flow */}
      <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4">
        {steps.map((step, i) => {
          if (step.kind === 'msg') {
            return (
              <div key={i} className={`flex ${step.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                  style={
                    step.role === 'user'
                      ? { backgroundColor: color, color: '#fff', borderBottomRightRadius: 6 }
                      : { backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))', borderBottomLeftRadius: 6 }
                  }
                >
                  {step.text}
                </div>
              </div>
            );
          }
          if (step.kind === 'form') {
            return (
              <PreChatForm key={i} fields={step.fields} color={color} onSubmit={handleFormSubmit} />
            );
          }
          // quick replies
          return (
            <div key={i} className="space-y-2">
              <div className="flex justify-start">
                <div
                  className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                  style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderBottomLeftRadius: 6 }}
                >
                  {step.node.message}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-1">
                {(step.node.options || []).map((opt, j) => (
                  <button
                    key={j}
                    onClick={() => handleQuickReply(step.node, opt)}
                    className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:text-white"
                    style={{ borderColor: color, color }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = color)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
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
          placeholder={
            !agent.widget_token
              ? 'Enable the website widget to test'
              : !readyRef.current
                ? 'Complete the pre-chat steps above first…'
                : 'Type a message…'
          }
          disabled={!agent.widget_token || busy || !readyRef.current}
        />
        <Button size="icon" onClick={send} disabled={!agent.widget_token || busy || !input.trim() || !readyRef.current} style={{ backgroundColor: color }}>
          <Send className="h-4 w-4 text-white" />
        </Button>
      </div>
    </div>
  );
}

/* Inline pre-chat form for the preview panel */
function PreChatForm({
  fields,
  color,
  onSubmit,
}: {
  fields: string[];
  color: string;
  onSubmit: (values: Record<string, string>, fields: string[]) => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const labels: Record<string, string> = { name: 'Your name', email: 'Email address', phone: 'Phone number', company: 'Company' };
  const types: Record<string, string> = { email: 'email', phone: 'tel' };
  return (
    <div className="mx-1 space-y-2 rounded-xl border bg-card p-3 shadow-sm">
      {fields.map((f) => (
        <label key={f} className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{labels[f]}</span>
          <Input
            type={types[f] || 'text'}
            value={vals[f] || ''}
            onChange={(e) => setVals((v) => ({ ...v, [f]: e.target.value.trim() }))}
            placeholder={`Enter ${labels[f].toLowerCase()}…`}
            className="h-8 text-xs"
          />
        </label>
      ))}
      <Button
        size="sm"
        className="w-full"
        style={{ backgroundColor: color }}
        onClick={() => onSubmit(vals, fields)}
      >
        Start chat →
      </Button>
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
  const [newToolName, setNewToolName] = useState('');
  const [newToolDesc, setNewToolDesc] = useState('');
  const [showToolForm, setShowToolForm] = useState(false);

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
      pre_chat_config: agent.pre_chat_config || {},
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
    const has = draft.tools.some((t) => typeof t === 'string' && t === toolId);
    setDraft({
      ...draft,
      tools: has
        ? draft.tools.filter((t) => !(typeof t === 'string' && t === toolId))
        : [...draft.tools, toolId],
    });
  };

  const addCustomTool = () => {
    if (!draft) return;
    const name = newToolName.trim();
    if (!name) return;
    setDraft({
      ...draft,
      tools: [...draft.tools, { type: 'custom', name, description: newToolDesc.trim() || 'Custom capability.' }],
    });
    setNewToolName('');
    setNewToolDesc('');
    setShowToolForm(false);
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
                {/* Identity strip — wide, roomy layout */}
                <Card>
                  <CardContent className="p-6 lg:p-8">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
                      <div
                        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl"
                        style={{ backgroundColor: (selected.widget_primary_color || '#7c3aed') + '22' }}
                      >
                        <Bot className="h-10 w-10" style={{ color: selected.widget_primary_color || '#7c3aed' }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="break-words text-2xl font-bold tracking-tight">{selected.name}</h2>
                          {selected.is_active ? (
                            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="secondary">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Paused</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {selected.description || 'No description yet — add one in the editor.'}
                        </p>
                        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="outline" className="gap-1 px-2.5 py-1">
                            <Sparkles className="h-3 w-3" /> {selected.model_provider} · {selected.model}
                          </Badge>
                          <Badge variant="outline" className="gap-1 px-2.5 py-1"><Globe className="h-3 w-3" /> Website</Badge>
                          <Badge variant="outline" className="gap-1 px-2.5 py-1"><MessageCircle className="h-3 w-3" /> WhatsApp</Badge>
                          {hasKey ? (
                            <Badge variant="outline" className="border-emerald-500/40 px-2.5 py-1 text-emerald-600 dark:text-emerald-400">API key ✓</Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-500/40 px-2.5 py-1 text-amber-600 dark:text-amber-400">No API key</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-5">
                      {canEdit && (
                        <Button onClick={() => openEdit(selected)} size="lg">
                          <Pencil className="mr-2 h-4 w-4" /> Edit agent
                        </Button>
                      )}
                      {selected.website_enabled && selected.widget_token && (
                        <a
                          href={`/widget/preview?token=${selected.widget_token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-transparent px-5 text-sm font-medium transition-colors hover:bg-muted"
                        >
                          <ExternalLink className="h-4 w-4" /> Web chatbot preview
                        </a>
                      )}
                      {canEdit && (
                        <Button variant="ghost" onClick={() => remove(selected)} className="ml-auto text-destructive hover:text-destructive">
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Tools + prompt live in the Edit dialog — keep this
                    page a clean overview. Show a one-line summary only. */}
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-5 text-sm text-muted-foreground">
                    <span>
                      <strong className="text-foreground">{selected.tools.length}</strong> tool{selected.tools.length === 1 ? '' : 's'} enabled
                      {selected.tools.length > 0 && (
                        <span className="ml-1">
                          ({selected.tools.map((t) =>
                            typeof t === 'string'
                              ? (t === 'knowledge_base' ? 'Knowledge base' : t === 'handoff' ? 'Human handoff' : t)
                              : t.name
                          ).join(', ')})
                        </span>
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
                        checked={draft.tools.some((t) => typeof t === 'string' && t === tool.id)}
                        onChange={() => toggleTool(tool.id)}
                      />
                      <tool.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-medium">{tool.label}</p>
                        <p className="text-xs text-muted-foreground">{tool.desc}</p>
                      </div>
                    </label>
                  ))}

                  {/* Custom tools */}
                  {draft.tools.filter((t) => typeof t !== 'string').map((t, i) => {
                    const tool = t as CustomTool;
                    return (
                      <div key={`ct-${i}`} className="flex items-start gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3">
                        <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{tool.name}</p>
                          <p className="text-xs text-muted-foreground">{tool.description}</p>
                        </div>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDraft({ ...draft, tools: draft.tools.filter((_, j) => j !== draft.tools.indexOf(tool)) })}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}

                  {!showToolForm ? (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setShowToolForm(true)}>
                      <Plus className="mr-2 h-3.5 w-3.5" /> Create a tool
                    </Button>
                  ) : (
                    <div className="space-y-3 rounded-xl border p-3">
                      <div className="space-y-2">
                        <Label htmlFor="tool-name">Tool name</Label>
                        <Input
                          id="tool-name"
                          value={newToolName}
                          onChange={(e) => setNewToolName(e.target.value)}
                          placeholder="e.g. Check loan status"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="tool-desc">What it does (shown to the model)</Label>
                        <Textarea
                          id="tool-desc"
                          rows={2}
                          value={newToolDesc}
                          onChange={(e) => setNewToolDesc(e.target.value)}
                          placeholder="Describe when the agent should use this capability…"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setShowToolForm(false); setNewToolName(''); setNewToolDesc(''); }}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={addCustomTool} disabled={!newToolName.trim()}>
                          Add tool
                        </Button>
                      </div>
                    </div>
                  )}
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

                {/* Pre-chat flow */}
                <PreChatEditor
                  config={draft.pre_chat_config}
                  onChange={(pc) => setDraft({ ...draft, pre_chat_config: pc })}
                />

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

/* ------------------------------------------------------------------ */
/* Pre-chat flow editor                                                */
/* ------------------------------------------------------------------ */

function PreChatEditor({ config, onChange }: { config: PreChatConfig; onChange: (c: PreChatConfig) => void }) {
  const set = (patch: Partial<PreChatConfig>) => onChange({ ...config, ...patch });
  const tree = config.dialog_tree || { nodes: {}, start_node: '' };

  const addNode = () => {
    const id = 'node_' + Object.keys(tree.nodes).length + '_' + Date.now().toString(36).slice(-3);
    const nodes = { ...tree.nodes, [id]: { id, message: 'What would you like to do?', options: [{ label: 'Option 1', next: '__ai__' }] } };
    set({ dialog_tree: { nodes, start_node: tree.start_node || id } });
  };
  const updateNode = (id: string, patch: Partial<PreChatNode>) => {
    set({ dialog_tree: { ...tree, nodes: { ...tree.nodes, [id]: { ...tree.nodes[id], ...patch } } } });
  };
  const removeNode = (id: string) => {
    const nodes = { ...tree.nodes };
    delete nodes[id];
    // clear references to deleted node
    for (const k of Object.keys(nodes)) {
      const n = nodes[k];
      if (n.options) nodes[k] = { ...n, options: n.options.map((o) => o.next === id ? { ...o, next: '__ai__' } : o) };
    }
    set({ dialog_tree: { nodes, start_node: tree.start_node === id ? Object.keys(nodes)[0] || '' : tree.start_node } });
  };
  const addOption = (nodeId: string) => {
    const n = tree.nodes[nodeId];
    if (!n) return;
    updateNode(nodeId, { options: [...(n.options || []), { label: 'New option', next: '__ai__' }] });
  };
  const updateOption = (nodeId: string, idx: number, patch: Partial<PreChatOption>) => {
    const n = tree.nodes[nodeId];
    if (!n || !n.options) return;
    const opts = n.options.map((o, i) => (i === idx ? { ...o, ...patch } : o));
    updateNode(nodeId, { options: opts });
  };
  const removeOption = (nodeId: string, idx: number) => {
    const n = tree.nodes[nodeId];
    if (!n || !n.options) return;
    updateNode(nodeId, { options: n.options.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="h-4 w-4 text-primary" /> Pre-chat flow
          </p>
          <p className="text-xs text-muted-foreground">Collect info + guide visitors before AI chat.</p>
        </div>
        <Switch checked={config.enabled} onCheckedChange={(v) => set({ enabled: v })} />
      </div>

      {config.enabled && (
        <div className="space-y-4 border-t pt-3">
          {/* Collect info */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collect info before chat</p>
            <div className="grid grid-cols-2 gap-2">
              {(['name', 'email', 'phone', 'company'] as const).map((field) => (
                <label key={field} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!!config.collect_info?.[field]}
                    onChange={(e) => set({ collect_info: { ...(config.collect_info || {}), [field]: e.target.checked } })}
                    className="rounded"
                  />
                  <span className="capitalize">{field}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Behavior */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!!config.ai_fallback}
                onChange={(e) => set({ ai_fallback: e.target.checked })}
                className="rounded"
              />
              <span>Free AI chat after flow</span>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!!config.start_with_ai}
                onChange={(e) => set({ start_with_ai: e.target.checked })}
                className="rounded"
              />
              <span>Skip flow, start with AI</span>
            </label>
          </div>

          {/* Dialog tree */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Hash className="mr-1 inline h-3 w-3" />Dialog tree
              </p>
              <button onClick={addNode} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="h-3 w-3" /> Add node
              </button>
            </div>

            {Object.keys(tree.nodes).length === 0 && (
              <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                No nodes yet. Add a node to build a guided menu (e.g. "Loans → Personal/Business → AI").
              </p>
            )}

            <div className="space-y-3">
              {Object.entries(tree.nodes).map(([id, node]) => (
                <div key={id} className="rounded-lg border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {tree.start_node === id && (
                        <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">START</span>
                      )}
                      <span className="text-xs font-mono text-muted-foreground">{id}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {tree.start_node !== id && (
                        <button
                          onClick={() => set({ dialog_tree: { ...tree, start_node: id } })}
                          className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                          title="Set as start node"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      )}
                      <button onClick={() => removeNode(id)} className="rounded px-1 py-0.5 text-muted-foreground hover:text-red-500">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  <input
                    className="mb-2 w-full rounded border bg-background px-2 py-1.5 text-xs"
                    value={node.message}
                    placeholder="Bot message shown at this step..."
                    onChange={(e) => updateNode(id, { message: e.target.value })}
                  />

                  <div className="space-y-1.5">
                    {(node.options || []).map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <input
                          className="flex-1 rounded border bg-background px-2 py-1 text-[11px]"
                          value={opt.label}
                          placeholder="Button label..."
                          onChange={(e) => updateOption(id, idx, { label: e.target.value })}
                        />
                        <select
                          className="rounded border bg-background px-1 py-1 text-[11px]"
                          value={opt.next}
                          onChange={(e) => updateOption(id, idx, { next: e.target.value })}
                        >
                          <option value="__ai__">→ AI chat</option>
                          {Object.keys(tree.nodes).map((nid) => (
                            <option key={nid} value={nid}>→ {nid}</option>
                          ))}
                        </select>
                        <button onClick={() => removeOption(id, idx)} className="text-muted-foreground hover:text-red-500">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => addOption(id)} className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                    <Plus className="h-3 w-3" /> Add option
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}