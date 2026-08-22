'use client';

/**
 * AI Agents — channel-scoped builder + tailored live previews.
 *
 * Creation is a wizard:
 *   1. Pick the channel — WhatsApp or Website (each agent serves one).
 *   2. Identity + brain — name, model, prompt.
 *   3. Channel setup — WhatsApp: greeting, response mode (flows / AI),
 *      quick replies, flow attachment. Website: widget look + optional
 *      pre-chat collection & menu.
 *
 * The preview panel is channel-tailored: WhatsApp agents test in a phone
 * frame through /api/agents/[id]/simulate (real flows dry-run + real AI);
 * website agents keep the embeddable-widget preview with its pre-chat
 * form/menu state machine.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Loader2,
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
  Smartphone,
  Workflow,
  Zap,
  Settings2,
  Link2,
  Unlink,
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
import {
  ChatPreview,
  WhatsAppPreview,
  type Agent,
  type CustomTool,
  type PreChatConfig,
  type PreChatNode,
  type PreChatOption,
  type WaConfig,
} from '@/components/agents/agent-previews';

const TOOL_OPTIONS = [
  {
    id: 'knowledge_base',
    label: 'Knowledge base',
    desc: 'Answer from your uploaded docs — FAQs, policies, products.',
    icon: BookOpen,
  },
  {
    id: 'handoff',
    label: 'Human handoff',
    desc: 'Pass the chat to a human agent when unsure or asked.',
    icon: HandMetal,
  },
];

type Channel = 'whatsapp' | 'website';

interface WaQuickReply {
  label: string;
}

interface FlowRowLite {
  id: string;
  name: string;
  status: string;
  agent_id: string | null;
}

function emptyAgent(channel: Channel): Omit<Agent, 'id'> {
  const base = {
    name: '',
    description: '',
    avatar_url: null,
    system_prompt:
      'You are a helpful assistant for this business. Be concise, friendly, and accurate. If you cannot help, say so and offer to connect the customer with a human.',
    model_provider: 'gemini' as const,
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    max_tokens: 1024,
    tools: ['knowledge_base', 'handoff'] as (string | CustomTool)[],
    auto_reply_enabled: true,
    is_active: true,
  };
  if (channel === 'whatsapp') {
    return {
      ...base,
      website_enabled: false,
      widget_token: null,
      widget_title: 'Chat with us',
      widget_welcome_message: 'Hi! How can we help you today?',
      widget_primary_color: '#7c3aed',
      widget_position: 'right' as const,
      pre_chat_config: { enabled: false } as PreChatConfig,
      channel: 'whatsapp',
      wa_config: {
        greeting: 'Hi! 👋 How can we help you today?',
        response_mode: 'flows_then_ai',
        quick_replies: [],
      } as Partial<WaConfig>,
    };
  }
  return {
    ...base,
    website_enabled: true,
    widget_token: null,
    widget_title: 'Chat with us',
    widget_welcome_message: 'Hi! How can we help you today?',
    widget_primary_color: '#7c3aed',
    widget_position: 'right' as const,
    pre_chat_config: {
      enabled: false,
      collect_info: { name: true, email: false, phone: false, company: false },
      dialog_tree: { nodes: {}, start_node: '' },
      ai_fallback: true,
      start_with_ai: false,
    } as PreChatConfig,
    channel: 'website',
    wa_config: {},
  };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function AgentsBuilderPage() {
  const { accountRole } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* Wizard state */
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizStep, setWizStep] = useState(0);
  const [wizChannel, setWizChannel] = useState<Channel>('whatsapp');
  const [wizDraft, setWizDraft] = useState<Omit<Agent, 'id'> | null>(null);
  const [wizApiKey, setWizApiKey] = useState('');
  /* Edit state */
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

  /* ---------- wizard ---------- */

  const openWizard = () => {
    setWizChannel('whatsapp');
    setWizStep(0);
    setWizDraft(null);
    setWizApiKey('');
    setError(null);
    setWizardOpen(true);
  };

  const chooseChannel = (ch: Channel) => {
    setWizChannel(ch);
    setWizDraft(emptyAgent(ch));
    setWizStep(1);
  };

  const createFromWizard = async () => {
    if (!wizDraft) return;
    if (!wizDraft.name.trim()) {
      setError('Give your agent a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        ...wizDraft,
        generate_widget:
          wizChannel === 'website' && !wizDraft.widget_token,
      };
      if (wizApiKey.trim()) payload.api_key = wizApiKey.trim();
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Create failed');
      await loadAgents();
      if (data.agent?.id) setSelectedId(data.agent.id);
      setWizardOpen(false);
      openEdit({ ...(wizDraft as Agent), ...data.agent });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  /* ---------- edit ---------- */

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
      pre_chat_config: agent.pre_chat_config || { enabled: false },
      channel: agent.channel ?? 'both',
      wa_config: agent.wa_config ?? {},
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
        generate_widget:
          draft.channel !== 'whatsapp' &&
          draft.website_enabled &&
          !draft.widget_token,
      };
      if (apiKeyInput.trim()) payload.api_key = apiKeyInput.trim();

      const res = await fetch(
        editingId ? `/api/agents/${editingId}` : '/api/agents',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');

      await loadAgents();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (agent: Agent) => {
    if (
      !confirm(
        `Delete "${agent.name}"? Its widget stops working and its WhatsApp numbers become unbound.`,
      )
    )
      return;
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
      tools: [
        ...draft.tools,
        {
          type: 'custom',
          name,
          description: newToolDesc.trim() || 'Custom capability.',
        },
      ],
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

  const channelOf = (a: Agent): Channel | 'both' =>
    (a.channel as Channel | 'both') ?? 'both';
  const isWa = (a: Agent) => channelOf(a) !== 'website';

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Loading agents…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build assistants for WhatsApp or your website — each channel gets
            its own setup and live preview.
            {' '}
            <a
              href="/agents/playground"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Open playground →
            </a>
          </p>
        </div>
        {canEdit && (
          <Button onClick={openWizard} size="lg">
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
                Create your first AI agent — pick WhatsApp or Website and follow
                the guided steps.
              </p>
            </div>
            {canEdit && (
              <Button onClick={openWizard} className="mt-2">
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
                  <CardContent className="p-6 lg:p-8">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
                      <div
                        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl"
                        style={{
                          backgroundColor:
                            (selected.widget_primary_color || '#7c3aed') + '22',
                        }}
                      >
                        <Bot
                          className="h-10 w-10"
                          style={{
                            color: selected.widget_primary_color || '#7c3aed',
                          }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="break-words text-2xl font-bold tracking-tight">
                            {selected.name}
                          </h2>
                          {isWa(selected) && (
                            <Badge
                              variant="secondary"
                              className="gap-1 border-emerald-600/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            >
                              <MessageCircle className="h-3 w-3" /> WhatsApp agent
                            </Badge>
                          )}
                          {!isWa(selected) && (
                            <Badge
                              variant="secondary"
                              className="gap-1 border-violet-600/40 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                            >
                              <Globe className="h-3 w-3" /> Website agent
                            </Badge>
                          )}
                          {selected.is_active ? (
                            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="secondary">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Paused</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {selected.description ||
                            'No description yet — add one in the editor.'}
                        </p>
                        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="outline" className="gap-1 px-2.5 py-1">
                            <Sparkles className="h-3 w-3" />{' '}
                            {selected.model_provider} · {selected.model}
                          </Badge>
                          {isWa(selected) && (
                            <Badge variant="outline" className="gap-1 px-2.5 py-1">
                              <Workflow className="h-3 w-3" /> Flows:{' '}
                              {String(
                                (selected.wa_config?.response_mode as string) ??
                                  'flows_then_ai',
                              ).replace('_', '-')}
                            </Badge>
                          )}
                          {!isWa(selected) && selected.pre_chat_config?.enabled && (
                            <Badge variant="outline" className="gap-1 px-2.5 py-1">
                              <MessageSquare className="h-3 w-3" /> Pre-chat on
                            </Badge>
                          )}
                          {hasKey ? (
                            <Badge variant="outline" className="border-emerald-500/40 px-2.5 py-1 text-emerald-600 dark:text-emerald-400">
                              API key ✓
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-500/40 px-2.5 py-1 text-amber-600 dark:text-amber-400">
                              No API key
                            </Badge>
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
                      {!isWa(selected) &&
                        selected.website_enabled &&
                        selected.widget_token && (
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
                        <Button
                          variant="ghost"
                          onClick={() => remove(selected)}
                          className="ml-auto text-destructive hover:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Summary line */}
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-5 text-sm text-muted-foreground">
                    <span>
                      <strong className="text-foreground">
                        {selected.tools.length}
                      </strong>{' '}
                      tool{selected.tools.length === 1 ? '' : 's'} enabled
                      {selected.tools.length > 0 && (
                        <span className="ml-1">
                          ({selected.tools.map((t) =>
                            typeof t === 'string'
                              ? t === 'knowledge_base'
                                ? 'Knowledge base'
                                : t === 'handoff'
                                  ? 'Human handoff'
                                  : t
                              : t.name,
                          ).join(', ')})
                        </span>
                      )}
                    </span>
                    <span className="hidden sm:inline text-border">|</span>
                    <span>
                      Prompt:{' '}
                      {selected.system_prompt.trim().split(/\s+/).length} words
                    </span>
                    <Button
                      variant="link"
                      size="sm"
                      className="ml-auto h-auto p-0"
                      onClick={() => openEdit(selected)}
                    >
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
                          <p className="truncate text-xs text-muted-foreground">
                            {channelOf(a) === 'whatsapp'
                              ? 'WhatsApp'
                              : channelOf(a) === 'website'
                                ? 'Website'
                                : `${a.model_provider} · ${a.model}`}
                          </p>
                        </div>
                        {a.is_active ? (
                          <span
                            className="h-2 w-2 rounded-full bg-emerald-500"
                            title="Active"
                          />
                        ) : (
                          <span
                            className="h-2 w-2 rounded-full bg-muted-foreground/40"
                            title="Paused"
                          />
                        )}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: channel-tailored live preview */}
          {selected && !draft && (
            <div className="space-y-3 xl:sticky xl:top-6 xl:self-start">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Live preview
                </h3>
                <span className="text-xs text-muted-foreground">
                  Test replies in real time
                </span>
              </div>
              {isWa(selected) ? (
                <WhatsAppPreview agent={selected} />
              ) : (
                <ChatPreview agent={selected} />
              )}
              {!hasKey && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  This agent has no API key yet — open <strong>Edit agent</strong>{' '}
                  and paste your Gemini / OpenAI key to see real AI replies.
                  Flow replies work without a key.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------------- Creation wizard ---------------- */}
      <Dialog open={wizardOpen} onOpenChange={(o) => !o && setWizardOpen(false)}>
        <DialogContent className="max-h-[94vh] w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
          {wizStep === 0 && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary" /> Create a new agent
                </DialogTitle>
              </DialogHeader>
              <p className="-mt-1 text-sm text-muted-foreground">
                Where will this agent work? It gets a tailored setup for that
                channel.
              </p>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <button
                  onClick={() => chooseChannel('whatsapp')}
                  className="group flex flex-col items-start gap-2 rounded-2xl border p-5 text-left transition-all hover:border-emerald-500 hover:bg-emerald-500/5"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#25D366]/15">
                    <MessageCircle className="h-6 w-6 text-[#128C7E]" />
                  </span>
                  <span className="text-base font-semibold">WhatsApp</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    Answers your connected numbers with flows (buttons, lists,
                    questions) plus AI for everything else.
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">Quick replies</Badge>
                    <Badge variant="outline" className="text-[10px]">Flows</Badge>
                    <Badge variant="outline" className="text-[10px]">AI fallback</Badge>
                  </span>
                </button>
                <button
                  onClick={() => chooseChannel('website')}
                  className="group flex flex-col items-start gap-2 rounded-2xl border p-5 text-left transition-all hover:border-violet-500 hover:bg-violet-500/5"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/15">
                    <Globe className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                  </span>
                  <span className="text-base font-semibold">Website</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    A chat bubble for your site — collect visitor info before
                    the chat, then let AI take over.
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">Pre-chat form</Badge>
                    <Badge variant="outline" className="text-[10px]">Menu</Badge>
                    <Badge variant="outline" className="text-[10px]">Embed code</Badge>
                  </span>
                </button>
              </div>
            </>
          )}

          {wizStep === 1 && wizDraft && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {wizChannel === 'whatsapp' ? (
                    <MessageCircle className="h-5 w-5 text-[#128C7E]" />
                  ) : (
                    <Globe className="h-5 w-5 text-violet-500" />
                  )}
                  {wizChannel === 'whatsapp'
                    ? 'New WhatsApp agent'
                    : 'New website agent'}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    step 2 of 3 · identity
                  </span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wz-name">Name *</Label>
                  <Input
                    id="wz-name"
                    value={wizDraft.name}
                    onChange={(e) =>
                      setWizDraft({ ...wizDraft, name: e.target.value })
                    }
                    placeholder={
                      wizChannel === 'whatsapp'
                        ? 'e.g. WhatsApp Sales Assistant'
                        : 'e.g. Website Support Bot'
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wz-desc">Description (internal)</Label>
                  <Input
                    id="wz-desc"
                    value={wizDraft.description ?? ''}
                    onChange={(e) =>
                      setWizDraft({ ...wizDraft, description: e.target.value })
                    }
                    placeholder="What is this agent for?"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Provider &amp; model</Label>
                    <Select
                      value={`${wizDraft.model_provider}:${wizDraft.model}`}
                      onValueChange={(v) => {
                        const val =
                          v ?? `${wizDraft.model_provider}:${wizDraft.model}`;
                        const [provider, ...rest] = val.split(':');
                        setWizDraft({
                          ...wizDraft,
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
                    <Label htmlFor="wz-temp">Temperature</Label>
                    <Input
                      id="wz-temp"
                      type="number"
                      min={0}
                      max={1}
                      step={0.1}
                      value={wizDraft.temperature}
                      onChange={(e) =>
                        setWizDraft({
                          ...wizDraft,
                          temperature: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wz-prompt">System prompt *</Label>
                  <Textarea
                    id="wz-prompt"
                    className="min-h-[150px] font-mono text-xs"
                    value={wizDraft.system_prompt}
                    onChange={(e) =>
                      setWizDraft({ ...wizDraft, system_prompt: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wz-akey">
                    API key (optional — falls back to account key)
                  </Label>
                  <Input
                    id="wz-akey"
                    type="password"
                    placeholder="AIza… / sk-… / sk-ant-…"
                    value={wizApiKey}
                    onChange={(e) => setWizApiKey(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter className="mt-2">
                <Button variant="ghost" onClick={() => setWizStep(0)}>
                  Back
                </Button>
                <Button onClick={() => setWizStep(2)}>
                  Next: {wizChannel === 'whatsapp' ? 'WhatsApp' : 'Website'} setup →
                </Button>
              </DialogFooter>
            </>
          )}

          {wizStep === 2 && wizDraft && wizChannel === 'whatsapp' && (
            <WhatsAppSetupSection
              draft={wizDraft}
              setDraft={setWizDraft}
              agentId={null}
              footer={
                <DialogFooter className="mt-2">
                  <Button variant="ghost" onClick={() => setWizStep(1)}>
                    Back
                  </Button>
                  <Button onClick={createFromWizard} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create WhatsApp agent
                  </Button>
                </DialogFooter>
              }
            />
          )}

          {wizStep === 2 && wizDraft && wizChannel === 'website' && (
            <WebsiteSetupSection
              draft={wizDraft}
              setDraft={setWizDraft}
              footer={
                <DialogFooter className="mt-2">
                  <Button variant="ghost" onClick={() => setWizStep(1)}>
                    Back
                  </Button>
                  <Button onClick={createFromWizard} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create website agent
                  </Button>
                </DialogFooter>
              }
            />
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
        </DialogContent>
      </Dialog>

      {/* ---------------- Edit dialog ---------------- */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[94vh] w-full max-w-5xl overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              {editingId ? `Edit — ${draft?.name}` : 'Edit agent'}
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
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
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
                      onChange={(e) =>
                        setDraft({ ...draft, temperature: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ag-prompt">System prompt *</Label>
                  <Textarea
                    id="ag-prompt"
                    className="min-h-[180px] font-mono text-xs"
                    value={draft.system_prompt}
                    onChange={(e) =>
                      setDraft({ ...draft, system_prompt: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ag-akey">
                    API key{' '}
                    {hasKey && editingId
                      ? '(saved — leave blank to keep)'
                      : '(optional — falls back to account key)'}
                  </Label>
                  <Input
                    id="ag-akey"
                    type="password"
                    placeholder="AIza… / sk-… / sk-ant-…"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between rounded-xl border p-4">
                  <div>
                    <p className="text-sm font-medium">Agent active</p>
                    <p className="text-xs text-muted-foreground">
                      Paused agents stop replying everywhere.
                    </p>
                  </div>
                  <Switch
                    checked={draft.is_active}
                    onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                  />
                </div>
              </div>

              {/* Column 2 — channel-specific behavior */}
              <div className="space-y-5">
                {(channelOf(draft as Agent) === 'whatsapp') && (
                  <>
                    <ToolsBlock
                      draft={draft}
                      setDraft={setDraft}
                      toggleTool={toggleTool}
                      addCustomTool={addCustomTool}
                      newToolName={newToolName}
                      setNewToolName={setNewToolName}
                      newToolDesc={newToolDesc}
                      setNewToolDesc={setNewToolDesc}
                      showToolForm={showToolForm}
                      setShowToolForm={setShowToolForm}
                    />
                    <WhatsAppSetupSection
                      draft={draft}
                      setDraft={setDraft}
                      agentId={editingId}
                    />
                  </>
                )}
                {(channelOf(draft as Agent) === 'website') && (
                  <>
                    <ToolsBlock
                      draft={draft}
                      setDraft={setDraft}
                      toggleTool={toggleTool}
                      addCustomTool={addCustomTool}
                      newToolName={newToolName}
                      setNewToolName={setNewToolName}
                      newToolDesc={newToolDesc}
                      setNewToolDesc={setNewToolDesc}
                      showToolForm={showToolForm}
                      setShowToolForm={setShowToolForm}
                    />
                    <WebsiteSetupSection draft={draft} setDraft={setDraft} embedded />
                  </>
                )}
                {/* Legacy 'both' agents get both sections */}
                {channelOf(draft as Agent) === 'both' && (
                  <>
                    <ToolsBlock
                      draft={draft}
                      setDraft={setDraft}
                      toggleTool={toggleTool}
                      addCustomTool={addCustomTool}
                      newToolName={newToolName}
                      setNewToolName={setNewToolName}
                      newToolDesc={newToolDesc}
                      setNewToolDesc={setNewToolDesc}
                      showToolForm={showToolForm}
                      setShowToolForm={setShowToolForm}
                    />
                    <WhatsAppSetupSection
                      draft={draft}
                      setDraft={setDraft}
                      agentId={editingId}
                      legacy
                    />
                    <WebsiteSetupSection draft={draft} setDraft={setDraft} embedded />
                  </>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tools block (shared)                                                */
/* ------------------------------------------------------------------ */

function ToolsBlock(props: {
  draft: Omit<Agent, 'id'>;
  setDraft: (d: Omit<Agent, 'id'>) => void;
  toggleTool: (id: string) => void;
  addCustomTool: () => void;
  newToolName: string;
  setNewToolName: (v: string) => void;
  newToolDesc: string;
  setNewToolDesc: (v: string) => void;
  showToolForm: boolean;
  setShowToolForm: (v: boolean) => void;
}) {
  const {
    draft,
    setDraft,
    toggleTool,
    addCustomTool,
    newToolName,
    setNewToolName,
    newToolDesc,
    setNewToolDesc,
    showToolForm,
    setShowToolForm,
  } = props;
  return (
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
            checked={draft.tools.some(
              (t) => typeof t === 'string' && t === tool.id,
            )}
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
          <div
            key={`ct-${i}`}
            className="flex items-start gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3"
          >
            <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{tool.name}</p>
              <p className="text-xs text-muted-foreground">{tool.description}</p>
            </div>
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => removeCustomTool(draft, tool, setDraft)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      {!showToolForm ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setShowToolForm(true)}
        >
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowToolForm(false);
                setNewToolName('');
                setNewToolDesc('');
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={addCustomTool} disabled={!newToolName.trim()}>
              Add tool
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Remove a custom tool while keeping built-in order stable. */
function removeCustomTool(
  draft: Omit<Agent, 'id'>,
  tool: CustomTool,
  setDraft: (d: Omit<Agent, 'id'>) => void,
) {
  setDraft({
    ...draft,
    tools: draft.tools.filter((t) => !(typeof t !== 'string' && t === tool)),
  });
}

/* ------------------------------------------------------------------ */
/* WHATSAPP section — greeting, response mode, quick replies, flows    */
/* ------------------------------------------------------------------ */

function WhatsAppSetupSection({
  draft,
  setDraft,
  agentId,
  footer,
  legacy,
}: {
  draft: Omit<Agent, 'id'>;
  setDraft: (d: Omit<Agent, 'id'>) => void;
  /** Agent being edited — null during wizard step 2 (not yet created). */
  agentId: string | null;
  footer?: React.ReactNode;
  /** Legacy 'both' agent — flows attach only when bound; show hint. */
  legacy?: boolean;
}) {
  const wa: Partial<WaConfig> = draft.wa_config ?? {};
  const mode = wa.response_mode ?? 'flows_then_ai';
  const quickReplies: WaQuickReply[] = (wa.quick_replies ?? []).map((q) => ({
    label: q,
  }));

  const [flows, setFlows] = useState<FlowRowLite[]>([]);
  const [loadingFlows, setLoadingFlows] = useState(true);
  const [linking, setLinking] = useState<string | null>(null);
  const [newQr, setNewQr] = useState('');

  useEffect(() => {
    setLoadingFlows(true);
    fetch('/api/flows')
      .then((r) => r.json())
      .then((d) => setFlows(Array.isArray(d.flows) ? d.flows : []))
      .catch(() => setFlows([]))
      .finally(() => setLoadingFlows(false));
  }, []);

  const setWa = (patch: Partial<WaConfig>) =>
    setDraft({ ...draft, wa_config: { ...wa, ...patch } });

  const linkFlow = async (flowId: string | null) => {
    if (!agentId) return;
    setLinking(flowId ?? '__none__');
    try {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      });
      if (!res.ok) throw new Error('Link failed');
      const d = await res.json();
      setFlows((prev) =>
        prev.map((f) =>
          f.id === flowId
            ? { ...f, agent_id: (d.flow?.agent_id as string) ?? agentId }
            : f,
        ),
      );
    } catch {
      /* toast-less silent fail mirrors rest of builder */
    } finally {
      setLinking(null);
    }
  };

  const unlinkFlow = async (flowId: string) => {
    setLinking(flowId);
    try {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: null }),
      });
      if (!res.ok) throw new Error('Unlink failed');
      setFlows((prev) =>
        prev.map((f) => (f.id === flowId ? { ...f, agent_id: null } : f)),
      );
    } catch {
      /* noop */
    } finally {
      setLinking(null);
    }
  };

  const addQr = () => {
    const v = newQr.trim();
    if (!v) return;
    setWa({
      quick_replies: [...quickReplies.map((q) => q.label), v].slice(0, 10),
    });
    setNewQr('');
  };
  const removeQr = (idx: number) =>
    setWa({
      quick_replies: quickReplies
        .filter((_, i) => i !== idx)
        .map((q) => q.label),
    });

  const myFlows = agentId
    ? flows.filter((f) => f.agent_id === agentId)
    : [];
  const availableFlows = flows.filter((f) => !f.agent_id);

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-[#128C7E]" />
        <p className="text-sm font-semibold">WhatsApp setup</p>
        {legacy && (
          <Badge variant="outline" className="ml-auto text-[10px]">
            Legacy dual-channel
          </Badge>
        )}
      </div>

      {/* Greeting */}
      <div className="space-y-2">
        <Label htmlFor="wa-greet">Greeting (first message)</Label>
        <Textarea
          id="wa-greet"
          rows={2}
          value={wa.greeting ?? ''}
          onChange={(e) => setWa({ greeting: e.target.value })}
          placeholder="Sent when the conversation starts…"
        />
      </div>

      {/* Response mode */}
      <div className="space-y-2">
        <Label>How should it respond?</Label>
        <div className="grid gap-2">
          {[
            {
              value: 'flows_then_ai',
              icon: Zap,
              title: 'Flows first, then AI (recommended)',
              desc: 'Attached flows answer with buttons/menus; anything else goes to the AI.',
            },
            {
              value: 'ai_only',
              icon: Bot,
              title: 'AI only',
              desc: 'Free conversation — flows never fire on this number.',
            },
            {
              value: 'flows_only',
              icon: Workflow,
              title: 'Flows only',
              desc: 'Deterministic menus only; unmatched messages are ignored.',
            },
          ].map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                mode === opt.value
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/50'
              }`}
            >
              <input
                type="radio"
                name="wa-response-mode"
                className="mt-1"
                checked={mode === opt.value}
                onChange={() => setWa({ response_mode: opt.value as WaConfig['response_mode'] })}
              />
              <opt.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{opt.title}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Quick replies */}
      <div className="space-y-2">
        <Label>Quick replies (suggested chips)</Label>
        <p className="text-xs text-muted-foreground">
          Shown above the composer in the live preview and offered to the AI as
          suggestions. Up to 10.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {quickReplies.map((q, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1 text-xs"
            >
              {q.label}
              <button
                type="button"
                onClick={() => removeQr(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newQr}
            onChange={(e) => setNewQr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addQr()}
            placeholder='e.g. "Check my balance"'
            className="h-8 text-xs"
          />
          <Button variant="outline" size="sm" onClick={addQr} disabled={!newQr.trim()}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      {/* Flows attachment */}
      <div className="space-y-2 border-t pt-3">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Attached flows</p>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {myFlows.length} attached
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          WhatsApp flows built in <strong>Flows</strong> — buttons, lists,
          questions — that this agent runs before falling back to AI.
          {legacy &&
            ' Legacy agents run all account flows; attach flows here to scope them.'}
        </p>
        {loadingFlows ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading flows…
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              {myFlows.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2"
                >
                  <Workflow className="h-3.5 w-3.5 text-primary" />
                  <span className="flex-1 truncate text-xs font-medium">
                    {f.name}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${
                      f.status === 'active'
                        ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                        : ''
                    }`}
                  >
                    {f.status}
                  </Badge>
                  <button
                    type="button"
                    title="Detach flow"
                    onClick={() => unlinkFlow(f.id)}
                    disabled={linking === f.id}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    {linking === f.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Unlink className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))}
              {myFlows.length === 0 && (
                <p className="rounded-lg border border-dashed p-2.5 text-center text-xs text-muted-foreground">
                  No flows attached yet.
                </p>
              )}
            </div>
            {availableFlows.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Available flows
                </p>
                {availableFlows.slice(0, 6).map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2"
                  >
                    <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate text-xs">{f.name}</span>
                    <Badge variant="outline" className="text-[9px]">
                      {f.status}
                    </Badge>
                    <button
                      type="button"
                      title="Attach to this agent"
                      onClick={() => linkFlow(f.id)}
                      disabled={linking === f.id}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      {linking === f.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Link2 className="h-3.5 w-3.5" />
                      )}
                      Attach
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Need a new flow? Open <strong>Flows</strong> in the sidebar, build
              it, then attach it here.
            </p>
          </>
        )}
      </div>

      {footer}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* WEBSITE section — widget look + pre-chat collection                 */
/* ------------------------------------------------------------------ */

function WebsiteSetupSection({
  draft,
  setDraft,
  footer,
  embedded,
}: {
  draft: Omit<Agent, 'id'>;
  setDraft: (d: Omit<Agent, 'id'>) => void;
  footer?: React.ReactNode;
  /** True inside the wide edit dialog (pre-chat editor inline). */
  embedded?: boolean;
}) {
  const pc: PreChatConfig = draft.pre_chat_config || { enabled: false };
  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-violet-500" />
        <p className="text-sm font-semibold">Website setup</p>
        {embedded && (
          <Settings2 className="ml-auto h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Widget appearance */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Chat bubble on your site</p>
            <p className="text-xs text-muted-foreground">
              Visitors chat here → inbox.
            </p>
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
                onChange={(e) =>
                  setDraft({ ...draft, widget_title: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-welcome">Welcome message</Label>
              <Textarea
                id="ag-wwelcome"
                rows={2}
                value={draft.widget_welcome_message}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    widget_welcome_message: e.target.value,
                  })
                }
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
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        widget_primary_color: e.target.value,
                      })
                    }
                  />
                  <Input
                    value={draft.widget_primary_color}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        widget_primary_color: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Position</Label>
                <Select
                  value={draft.widget_position}
                  onValueChange={(v) =>
                    setDraft({
                      ...draft,
                      widget_position: (v ?? 'right') as 'left' | 'right',
                    })
                  }
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
        config={pc}
        onChange={(npc) => setDraft({ ...draft, pre_chat_config: npc })}
      />

      {footer}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pre-chat flow editor                                                */
/* ------------------------------------------------------------------ */

function PreChatEditor({
  config,
  onChange,
}: {
  config: PreChatConfig;
  onChange: (c: PreChatConfig) => void;
}) {
  const set = (patch: Partial<PreChatConfig>) => onChange({ ...config, ...patch });
  const tree = config.dialog_tree || { nodes: {}, start_node: '' };

  const addNode = () => {
    const id =
      'node_' + Object.keys(tree.nodes).length + '_' + Date.now().toString(36).slice(-3);
    const nodes = {
      ...tree.nodes,
      [id]: {
        id,
        message: 'What would you like to do?',
        options: [{ label: 'Option 1', next: '__ai__' }],
      },
    };
    set({ dialog_tree: { nodes, start_node: tree.start_node || id } });
  };
  const updateNode = (id: string, patch: Partial<PreChatNode>) => {
    set({
      dialog_tree: {
        ...tree,
        nodes: { ...tree.nodes, [id]: { ...tree.nodes[id], ...patch } },
      },
    });
  };
  const removeNode = (id: string) => {
    const nodes = { ...tree.nodes };
    delete nodes[id];
    for (const k of Object.keys(nodes)) {
      const n = nodes[k];
      if (n.options)
        nodes[k] = {
          ...n,
          options: n.options.map((o) =>
            o.next === id ? { ...o, next: '__ai__' } : o,
          ),
        };
    }
    set({
      dialog_tree: {
        nodes,
        start_node: tree.start_node === id ? Object.keys(nodes)[0] || '' : tree.start_node,
      },
    });
  };
  const addOption = (nodeId: string) => {
    const n = tree.nodes[nodeId];
    if (!n) return;
    updateNode(nodeId, {
      options: [...(n.options || []), { label: 'New option', next: '__ai__' }],
    });
  };
  const updateOption = (
    nodeId: string,
    idx: number,
    patch: Partial<PreChatOption>,
  ) => {
    const n = tree.nodes[nodeId];
    if (!n || !n.options) return;
    updateNode(nodeId, {
      options: n.options.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
    });
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
            <MessageSquare className="h-4 w-4 text-primary" /> Collect info
            before the chat
          </p>
          <p className="text-xs text-muted-foreground">
            Form + guided menu shown before AI takes over.
          </p>
        </div>
        <Switch checked={config.enabled} onCheckedChange={(v) => set({ enabled: v })} />
      </div>

      {config.enabled && (
        <div className="space-y-4 border-t pt-3">
          {/* Collect info */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ask for
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['name', 'email', 'phone', 'company'] as const).map((field) => (
                <label key={field} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!!config.collect_info?.[field]}
                    onChange={(e) =>
                      set({
                        collect_info: {
                          ...(config.collect_info || {}),
                          [field]: e.target.checked,
                        },
                      })
                    }
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
                <Hash className="mr-1 inline h-3 w-3" />
                Menu options (dialog tree)
              </p>
              <button
                onClick={addNode}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="h-3 w-3" /> Add node
              </button>
            </div>

            {Object.keys(tree.nodes).length === 0 && (
              <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                No nodes yet. Add a node to build a guided menu (e.g. "Loans →
                Personal/Business → AI").
              </p>
            )}

            <div className="space-y-3">
              {Object.entries(tree.nodes).map(([id, node]) => (
                <div key={id} className="rounded-lg border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {tree.start_node === id && (
                        <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                          START
                        </span>
                      )}
                      <span className="text-xs font-mono text-muted-foreground">
                        {id}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {tree.start_node !== id && (
                        <button
                          onClick={() =>
                            set({ dialog_tree: { ...tree, start_node: id } })
                          }
                          className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                          title="Set as start node"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={() => removeNode(id)}
                        className="rounded px-1 py-0.5 text-muted-foreground hover:text-red-500"
                      >
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
                          onChange={(e) =>
                            updateOption(id, idx, { label: e.target.value })
                          }
                        />
                        <select
                          className="rounded border bg-background px-1 py-1 text-[11px]"
                          value={opt.next}
                          onChange={(e) =>
                            updateOption(id, idx, { next: e.target.value })
                          }
                        >
                          <option value="__ai__">→ AI chat</option>
                          {Object.keys(tree.nodes).map((nid) => (
                            <option key={nid} value={nid}>
                              → {nid}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeOption(id, idx)}
                          className="text-muted-foreground hover:text-red-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => addOption(id)}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
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
