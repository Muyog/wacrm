'use client';

/**
 * Channel-tailored live previews for the AI Agents builder.
 *
 * Two implementations, one contract:
 *   - ChatPreview     → WEBSITE: mimics the embeddable widget bubble and
 *                       runs the SAME pre-chat flow (info form → dialog
 *                       tree → AI chat) through the public widget API.
 *   - WhatsAppPreview → WHATSAPP: mimics a phone conversation and drives
 *                       the real pipeline order — attached Flows first,
 *                       then the agent's AI — through /simulate.
 *
 * Any change to flow behaviour must keep these in lockstep with
 * public/widget/widget.js (website) and lib/flows/engine.ts (WhatsApp).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Loader2,
  Send,
  Globe,
  MessageCircle,
  ListTree,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

export interface CustomTool {
  type: 'custom';
  name: string;
  description: string;
}

export interface PreChatCollectInfo {
  name?: boolean;
  email?: boolean;
  phone?: boolean;
  company?: boolean;
}
export interface PreChatOption {
  label: string;
  next: string;
}
export interface PreChatNode {
  id?: string;
  message: string;
  options?: PreChatOption[];
}
export interface PreChatDialogTree {
  nodes: Record<string, PreChatNode>;
  start_node: string;
}
export interface PreChatConfig {
  enabled: boolean;
  collect_info?: PreChatCollectInfo;
  dialog_tree?: PreChatDialogTree;
  ai_fallback?: boolean;
  start_with_ai?: boolean;
}

export interface WaConfig {
  /** First message sent when the agent answers a number. */
  greeting: string;
  /**
   * How inbound messages are answered:
   *   flows_then_ai — attached flows try first, AI handles the rest
   *   ai_only       — pure AI conversation, flows never fire
   *   flows_only    — deterministic menus only; unmatched text is ignored
   */
  response_mode: 'flows_then_ai' | 'ai_only' | 'flows_only';
  /** Suggested reply chips offered alongside qualifying AI answers. */
  quick_replies: string[];
}

export interface Agent {
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
  channel: 'whatsapp' | 'website' | 'both';
  wa_config: Partial<WaConfig>;
}

/* ------------------------------------------------------------------ */
/* WhatsApp simulate step shapes (mirror /api/agents/[id]/simulate)    */
/* ------------------------------------------------------------------ */

interface SimulateStep {
  type: 'text' | 'buttons' | 'list' | 'media';
  text?: string;
  header?: string;
  footer?: string;
  button_label?: string;
  buttons?: { title: string }[];
  rows?: { title: string; description?: string }[];
}

type WaBubble =
  | { role: 'user'; text: string }
  | { role: 'bot'; text: string }
  | { role: 'bot'; steps: SimulateStep[]; flowName?: string }
  | { role: 'system'; text: string };

function defaultGreeting(agent: Agent): string {
  return (
    (agent.wa_config?.greeting || '').trim() ||
    'Hi! 👋 How can we help you today?'
  );
}

/* ------------------------------------------------------------------ */
/* WhatsAppPreview — phone-framed, flows-first simulation              */
/* ------------------------------------------------------------------ */

export function WhatsAppPreview({ agent }: { agent: Agent }) {
  const [bubbles, setBubbles] = useState<WaBubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(
    agent.wa_config?.quick_replies ?? [],
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  // Bumped when the agent's config changes → restarts the conversation.
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    setRunKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agent.id,
    agent.wa_config?.greeting,
    agent.wa_config?.response_mode,
    JSON.stringify(agent.wa_config?.quick_replies ?? []),
  ]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [bubbles, busy]);

  const simulate = useCallback(
    async (
      history: { role: 'user' | 'assistant'; content: string }[],
      append: (b: WaBubble[]) => void,
    ) => {
      if (!agent.id) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/agents/${agent.id}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
        });
        const data = await res.json();
        const add: WaBubble[] = [];
        if (data.kind === 'flow') {
          add.push({
            role: 'bot',
            steps: (data.steps ?? []) as SimulateStep[],
            flowName: data.flow_name,
          });
          if (!data.steps?.length) {
            add.push({
              role: 'system',
              text: `Flow "${data.flow_name}" has no entry node yet.`,
            });
          }
        } else if (data.kind === 'none') {
          add.push({
            role: 'system',
            text: data.note || 'No flow matched this message.',
          });
        } else if (data.kind === 'ai') {
          if (data.reply) {
            add.push({ role: 'bot', text: data.reply });
          } else if (data.warning) {
            add.push({ role: 'system', text: data.warning });
          }
        }
        append(add.length ? add : [{ role: 'system', text: 'No reply.' }]);
      } catch {
        append([{ role: 'system', text: 'Network error — please try again.' }]);
      } finally {
        setBusy(false);
      }
    },
    [agent.id],
  );

  /* Fresh thread whenever the preview mounts / config changes. */
  useEffect(() => {
    const greeting: WaBubble = { role: 'bot', text: defaultGreeting(agent) };
    setBubbles([greeting]);
    setSuggestions(agent.wa_config?.quick_replies ?? []);
    if (!agent.id) return;
    // Kick the flow/AI with the greeting as the opener so a
    // first_inbound_message flow demonstrates immediately.
    const history = [{ role: 'assistant', content: defaultGreeting(agent) }];
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await simulate(
        [{ role: 'user', content: 'Hi' }],
        (add) => {
          if (!cancelled) {
            setBubbles((b) => [...b, { role: 'user', text: 'Hi' }, ...add]);
          }
        },
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput('');
    const userBubble: WaBubble = { role: 'user', text };
    let history: { role: 'user' | 'assistant'; content: string }[] = [];
    setBubbles((prev) => {
      history = prev.flatMap((b) => {
        if (b.role === 'system' || 'steps' in b) return [];
        return [
          {
            role: b.role === 'user' ? ('user' as const) : ('assistant' as const),
            content: b.text,
          },
        ];
      });
      history.push({ role: 'user', content: text });
      return [...prev, userBubble];
    });
    await simulate(history, (add) => setBubbles((b) => [...b, ...add]));
  };

  const initials = agent.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="mx-auto w-full max-w-[360px]">
      {/* Phone frame */}
      <div className="overflow-hidden rounded-[2rem] border bg-card shadow-lg">
        <div className="flex h-[620px] flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 bg-[#075E54] px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
              {initials || <Bot className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {agent.name || 'Business'}
              </p>
              <p className="text-[11px] leading-tight text-white/70">online</p>
            </div>
            <MessageCircle className="h-4 w-4 text-white/60" />
          </div>

          {/* Thread */}
          <div
            ref={bodyRef}
            className="wa-preview-wallpaper flex-1 space-y-2 overflow-y-auto px-3 py-3"
            style={{ backgroundColor: '#ece5dd' }}
          >
            <div className="mx-auto w-fit rounded-md bg-[#FCF4CB] px-2 py-0.5 text-center text-[10px] font-medium text-[#54656F] shadow-sm">
              TODAY
            </div>
            {bubbles.map((b, i) => {
              if (b.role === 'system') {
                return (
                  <div
                    key={i}
                    className="mx-auto max-w-[90%] rounded-lg bg-black/10 px-2.5 py-1.5 text-center text-[11px] italic leading-snug text-muted-foreground"
                  >
                    {b.text}
                  </div>
                );
              }
              if (b.role === 'user') {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-[#DCF8C6] px-2.5 py-1.5 text-[13px] leading-relaxed text-gray-900 shadow-sm">
                      {b.text}
                      <span className="ml-1.5 inline-block align-baseline text-[10px] leading-none text-gray-500">
                        ✓✓
                      </span>
                    </div>
                  </div>
                );
              }
              if ('text' in b) {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[80%] whitespace-pre-wrap rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 text-[13px] leading-relaxed text-gray-900 shadow-sm">
                      {b.text}
                    </div>
                  </div>
                );
              }
              /* Flow steps block */
              return (
                <FlowStepsView
                  key={i}
                  steps={b.steps}
                  flowName={b.flowName}
                  onTap={(title) => send(title)}
                />
              );
            })}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                </div>
              </div>
            )}
          </div>

          {/* Quick-reply suggestion chips */}
          {suggestions.length > 0 && !busy && (
            <div className="flex gap-1.5 overflow-x-auto border-t bg-card px-2 py-2">
              {suggestions.slice(0, 6).map((q, i) => (
                <button
                  key={i}
                  onClick={() => send(q)}
                  className="shrink-0 rounded-full border border-emerald-600/50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-600 hover:text-white dark:text-emerald-400"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Composer */}
          <div className="flex items-center gap-2 bg-[#F0F0F0] p-2 dark:bg-card">
            <div className="flex-1 rounded-full bg-white px-3 py-2 dark:bg-background">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && !e.shiftKey && send()
                }
                placeholder="Type a message"
                disabled={busy}
                className="w-full bg-transparent text-[13px] outline-none"
              />
            </div>
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white transition-opacity disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Live preview — flows answer first, your AI handles the rest. Nothing is
        sent to customers.
      </p>
    </div>
  );
}

/* Renders a walked flow: text bubbles, button chips, list rows. */
function FlowStepsView({
  steps,
  flowName,
  onTap,
}: {
  steps: SimulateStep[];
  flowName?: string;
  onTap: (title: string) => void;
}) {
  return (
    <div className="space-y-2">
      {flowName && (
        <div className="mx-auto flex w-fit items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
          <ListTree className="h-3 w-3" /> Flow: {flowName}
        </div>
      )}
      {steps.map((step, i) => {
        const bubble = (children: React.ReactNode) => (
          <div key={i} className="flex justify-start">
            <div className="max-w-[80%] whitespace-pre-wrap rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 text-[13px] leading-relaxed text-gray-900 shadow-sm">
              {step.header && (
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  {step.header}
                </p>
              )}
              {children}
              {step.footer && (
                <p className="mt-1 text-[10px] italic text-gray-400">
                  {step.footer}
                </p>
              )}
            </div>
          </div>
        );
        if (step.type === 'buttons') {
          return (
            <div key={i} className="space-y-1.5">
              {bubble(null)}
              <div className="flex flex-wrap gap-1.5 pl-2">
                {(step.buttons ?? []).map((btn, j) => (
                  <button
                    key={j}
                    onClick={() => btn.title && onTap(btn.title)}
                    className="rounded-md border border-[#25D366]/60 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#128C7E] shadow-sm transition-colors hover:bg-[#25D366] hover:text-white"
                  >
                    {btn.title || `Button ${j + 1}`}
                  </button>
                ))}
              </div>
            </div>
          );
        }
        if (step.type === 'list') {
          return (
            <div key={i} className="space-y-1.5">
              {bubble(null)}
              <div className="ml-2 divide-y divide-border overflow-hidden rounded-lg border bg-white shadow-sm">
                {(step.rows ?? []).map((row, j) => (
                  <button
                    key={j}
                    onClick={() => row.title && onTap(row.title)}
                    className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-muted"
                  >
                    <span className="block text-[12px] font-medium text-gray-900">
                      {row.title}
                    </span>
                    {row.description && (
                      <span className="block text-[10px] text-gray-500">
                        {row.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        }
        /* text / media-caption */
        return bubble(step.text);
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ChatPreview — website widget (unchanged behaviour)                  */
/* ------------------------------------------------------------------ */

type FlowStep =
  | { kind: 'msg'; role: 'bot' | 'user'; text: string }
  | { kind: 'form'; fields: string[] }
  | { kind: 'quick'; node: PreChatNode };

export function ChatPreview({ agent }: { agent: Agent }) {
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const visitorRef = useRef<string>('');
  const infoRef = useRef<Record<string, string>>({});
  const pathRef = useRef<{ node: string; label: string }[]>([]);
  const readyRef = useRef(false);
  const [, setChatReady] = useState(false);

  const pc = agent.pre_chat_config || {};
  const pcEnabled = !!pc.enabled && !pc.start_with_ai;

  // Reset the thread when switching agents or changing config.
  useEffect(() => {
    visitorRef.current =
      'preview-' +
      agent.id.slice(0, 8) +
      '-' +
      Math.random().toString(36).slice(2, 8);
    infoRef.current = {};
    pathRef.current = [];
    readyRef.current = false;
    setChatReady(false);
    const initial: FlowStep[] = [
      {
        kind: 'msg',
        role: 'bot',
        text: agent.widget_welcome_message || 'Hi! How can we help you today?',
      },
    ];
    if (!pcEnabled) {
      readyRef.current = true;
      setChatReady(true);
    } else {
      const collect = pc.collect_info || {};
      const hasForm =
        collect.name || collect.email || collect.phone || collect.company;
      if (hasForm) {
        initial.push({
          kind: 'form',
          fields: (['name', 'email', 'phone', 'company'] as const).filter(
            (f) => collect[f],
          ),
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
  const handleFormSubmit = (
    values: Record<string, string>,
    fields: string[],
  ) => {
    infoRef.current = values;
    const summary = fields
      .map((f) => `${f.charAt(0).toUpperCase() + f.slice(1)}: ${values[f] || '—'}`)
      .join('  •  ');
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
          customer_info: Object.keys(infoRef.current).length
            ? infoRef.current
            : undefined,
          flow_path: pathRef.current.length ? pathRef.current : undefined,
        }),
      });
      const data = await res.json();
      setSteps((m) => [
        ...m,
        {
          kind: 'msg',
          role: 'bot',
          text: data.reply || '(no reply — check the agent has an API key configured)',
        },
      ]);
    } catch {
      setSteps((m) => [
        ...m,
        { kind: 'msg', role: 'bot', text: 'Network error — please try again.' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const color = agent.widget_primary_color || '#7c3aed';

  return (
    <div className="flex h-[560px] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Header mimicking the real widget */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ backgroundColor: color }}
      >
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
              <div
                key={i}
                className={`flex ${step.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                  style={
                    step.role === 'user'
                      ? {
                          backgroundColor: color,
                          color: '#fff',
                          borderBottomRightRadius: 6,
                        }
                      : {
                          backgroundColor: 'hsl(var(--card))',
                          color: 'hsl(var(--foreground))',
                          border: '1px solid hsl(var(--border))',
                          borderBottomLeftRadius: 6,
                        }
                  }
                >
                  {step.text}
                </div>
              </div>
            );
          }
          if (step.kind === 'form') {
            return (
              <PreChatForm
                key={i}
                fields={step.fields}
                color={color}
                onSubmit={handleFormSubmit}
              />
            );
          }
          // quick replies
          return (
            <div key={i} className="space-y-2">
              <div className="flex justify-start">
                <div
                  className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                  style={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderBottomLeftRadius: 6,
                  }}
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
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = color)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = 'transparent')
                    }
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
        <Button
          size="icon"
          onClick={send}
          disabled={!agent.widget_token || busy || !input.trim() || !readyRef.current}
          style={{ backgroundColor: color }}
        >
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
  const labels: Record<string, string> = {
    name: 'Your name',
    email: 'Email address',
    phone: 'Phone number',
    company: 'Company',
  };
  const types: Record<string, string> = { email: 'email', phone: 'tel' };
  return (
    <div className="mx-1 space-y-2 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Globe className="h-3 w-3" /> Before the chat starts
      </div>
      {fields.map((f) => (
        <label key={f} className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            {labels[f]}
          </span>
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
