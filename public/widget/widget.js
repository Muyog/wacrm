/**
 * Bamisoro Chat website widget — drop-in chat bubble with pre-chat
 * flows (info collection + dialog tree) before free AI chat.
 *
 * Usage:
 *   <script src="https://<app>/widget/widget.js" data-widget="<TOKEN>" defer></script>
 *   Optional: data-visitor="id"  data-name="Name"
 *
 * States: closed → form → tree → chat → (loop)
 */
(function () {
  if (window.__bamisoroWidget) return;
  window.__bamisoroWidget = true;

  var script = document.currentScript;
  var base = (script && script.src
    ? script.src.replace(/\/widget\/widget\.js.*$/, '').replace(/[?#].*$/, '').replace(/\/$/, '')
    : window.location.origin);
  var token = (script && script.dataset && script.dataset.widget) || '';
  var fallbackVisitor = (script && script.dataset && script.dataset.visitor) || '';
  var fallbackName = (script && script.dataset && script.dataset.name) || '';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function visitorId() {
    try {
      var id = localStorage.getItem('bamisoro_visitor');
      if (!id) { id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('bamisoro_visitor', id); }
      return id;
    } catch (e) { return 'v_anon_' + Math.random().toString(36).slice(2); }
  }

  function init() {
    if (!token) { console.warn('[BamisoroChat] missing data-widget token'); return; }
    fetch(base + '/api/widget/' + encodeURIComponent(token), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('widget config ' + r.status); return r.json(); })
      .then(function (data) { render(data.agent); })
      .catch(function (e) { console.warn('[BamisoroChat] could not load config', e); });
  }

  /* ---------- state ---------- */
  var S = {
    agent: null,
    visitor: '',
    customerInfo: {},
    flowPath: [],
    currentNode: null,
    preChat: {},
    convId: '',
    chatReady: false,
  };

  function render(agent) {
    S.agent = agent;
    S.visitor = fallbackVisitor || visitorId();
    var cfg = agent.pre_chat || {};
    S.preChat = cfg.enabled ? cfg : {};
    injectStyles(agent.widget_primary_color || '#7c3aed', agent.widget_position || 'right');
    buildDOM(agent);
    addMsg('bot', agent.widget_welcome_message || 'Hi! How can we help you today?');
    // Decide entry: if pre-chat enabled and not start_with_ai, show form/tree first.
    if (S.preChat.enabled && !S.preChat.start_with_ai) {
      runPreChat();
    } else {
      S.chatReady = true;
    }
  }

  /* ---------- styles ---------- */
  function injectStyles(color, position) {
    var style = document.createElement('style');
    style.textContent =
      '#bamisoro-widget{position:fixed;' + position + ':24px;bottom:24px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '#bamisoro-widget *{box-sizing:border-box}' +
      '.bsr-toggle{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;color:#fff;font-size:24px;box-shadow:0 4px 16px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;background:' + color + '}' +
      '.bsr-panel{position:fixed;' + position + ':24px;bottom:96px;width:360px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 140px);background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden;border:1px solid rgba(0,0,0,.08)}' +
      '.bsr-panel.open{display:flex}' +
      '.bsr-head{background:' + color + ';color:#fff;padding:14px 16px;font-weight:600;display:flex;align-items:center;gap:10px}' +
      '.bsr-head .bsr-title{flex:1;font-size:15px}' +
      '.bsr-head .bsr-close{background:none;border:none;color:#fff;font-size:18px;cursor:pointer}' +
      '.bsr-body{flex:1;overflow-y:auto;padding:12px 0;background:#fafafa}' +
      '.bsr-msg{display:flex;flex-direction:column}' +
      '.bsr-bubble{max-width:82%;margin:4px 12px;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}' +
      '.bsr-bot{background:#f1f3f5;color:#1a1a1a;align-self:flex-start;border-bottom-left-radius:4px}' +
      '.bsr-user{background:' + color + ';color:#fff;align-self:flex-end;border-bottom-right-radius:4px}' +
      '.bsr-quick-reply-wrap{display:flex;flex-wrap:wrap;gap:6px;padding:4px 12px 8px}' +
      '.bsr-quick-reply{border:1px solid ' + color + ';color:' + color + ';background:#fff;border-radius:18px;padding:7px 14px;font-size:13px;cursor:pointer;transition:all .15s}' +
      '.bsr-quick-reply:hover{background:' + color + ';color:#fff}' +
      '.bsr-form{padding:12px 16px;display:flex;flex-direction:column;gap:10px}' +
      '.bsr-form label{font-size:12px;font-weight:500;color:#555;display:flex;flex-direction:column;gap:3px}' +
      '.bsr-form input{border:1px solid #ddd;border-radius:8px;padding:9px 12px;font-size:14px;outline:none}' +
      '.bsr-form input:focus{border-color:' + color + '}' +
      '.bsr-form button{border:none;background:' + color + ';color:#fff;border-radius:8px;padding:10px;font-size:14px;cursor:pointer;font-weight:500}' +
      '.bsr-form button:hover{opacity:.9}' +
      '.bsr-input-row{display:flex;border-top:1px solid #eee;padding:8px;background:#fff;gap:6px}' +
      '.bsr-input-row input{flex:1;border:1px solid #ddd;border-radius:24px;padding:10px 14px;font-size:14px;outline:none}' +
      '.bsr-input-row button{border:none;background:' + color + ';color:#fff;border-radius:50%;width:40px;height:40px;cursor:pointer;font-size:16px}' +
      '.bsr-typing{display:inline-flex;gap:3px;align-items:center}' +
      '.bsr-typing span{width:6px;height:6px;background:#999;border-radius:50%;animation:bsr-bounce 1.2s infinite}' +
      '.bsr-typing span:nth-child(2){animation-delay:.15s}' +
      '.bsr-typing span:nth-child(3){animation-delay:.3s}' +
      '@keyframes bsr-bounce{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}';
    document.head.appendChild(style);
  }

  /* ---------- DOM ---------- */
  var root, panel, body, toggle, closeBtn, inputRow, sendBtn, input, quickReplyWrap;

  function buildDOM(agent) {
    root = document.createElement('div');
    root.id = 'bamisoro-widget';
    root.innerHTML =
      '<div class="bsr-panel">' +
      '<div class="bsr-head"><span class="bsr-title">' + esc(agent.widget_title || agent.name || 'Chat with us') + '</span><button class="bsr-close" aria-label="Close chat">×</button></div>' +
      '<div class="bsr-body"></div>' +
      '<div class="bsr-input-row"><input type="text" placeholder="Type a message..." aria-label="Message"><button aria-label="Send">➤</button></div>' +
      '</div>' +
      '<button class="bsr-toggle" aria-label="Open chat">💬</button>';
    document.body.appendChild(root);
    panel = root.querySelector('.bsr-panel');
    toggle = root.querySelector('.bsr-toggle');
    closeBtn = root.querySelector('.bsr-close');
    body = root.querySelector('.bsr-body');
    inputRow = root.querySelector('.bsr-input-row');
    input = inputRow.querySelector('input');
    sendBtn = inputRow.querySelector('button');
    inputRow.style.display = 'none';
    toggle.addEventListener('click', function () { panel.classList.toggle('open'); });
    closeBtn.addEventListener('click', function () { panel.classList.remove('open'); });
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  }

  /* ---------- messaging ---------- */
  function addMsg(role, text) {
    var el = document.createElement('div');
    el.className = 'bsr-msg';
    var b = document.createElement('div');
    b.className = 'bsr-bubble ' + (role === 'user' ? 'bsr-user' : 'bsr-bot');
    b.textContent = text;
    el.appendChild(b);
    body.appendChild(el);
    scroll();
  }

  function addQuickReplies(options, handler) {
    removeQuickReplies();
    var wrap = document.createElement('div');
    wrap.className = 'bsr-quick-reply-wrap';
    options.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.className = 'bsr-quick-reply';
      btn.textContent = opt.label;
      btn.addEventListener('click', function () { removeQuickReplies(); handler(opt); });
      wrap.appendChild(btn);
    });
    body.appendChild(wrap);
    scroll();
  }

  function removeQuickReplies() {
    var w = body.querySelector('.bsr-quick-reply-wrap');
    if (w) w.remove();
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'bsr-msg';
    var b = document.createElement('div');
    b.className = 'bsr-bubble bsr-bot bsr-typing';
    b.innerHTML = '<span></span><span></span><span></span>';
    el.appendChild(b);
    el.id = 'bsr-typing';
    body.appendChild(el);
    scroll();
  }
  function hideTyping() { var t = document.getElementById('bsr-typing'); if (t) t.remove(); }

  function scroll() { body.scrollTop = body.scrollHeight; }

  /* ---------- pre-chat flow ---------- */
  function runPreChat() {
    var collect = S.preChat.collect_info || {};
    var hasForm = collect.name || collect.email || collect.phone || collect.company;
    if (hasForm) {
      showForm(collect, function (info) {
        S.customerInfo = info;
        addMsg('user', summarizeInfo(info));
        proceedAfterForm();
      });
    } else {
      proceedAfterForm();
    }
  }

  function showForm(fields, done) {
    inputRow.style.display = 'none';
    var form = document.createElement('div');
    form.className = 'bsr-form';
    var vals = {};
    function mkField(key, label, type) {
      if (!fields[key]) return;
      var lab = document.createElement('label');
      lab.textContent = label;
      var inp = document.createElement('input');
      inp.type = type || 'text';
      inp.placeholder = 'Enter ' + label.toLowerCase() + '...';
      if (key === 'name' && fallbackName) inp.value = fallbackName;
      inp.addEventListener('input', function () { vals[key] = inp.value.trim(); });
      vals[key] = inp.value;
      lab.appendChild(inp);
      form.appendChild(lab);
    }
    mkField('name', 'Your name');
    mkField('email', 'Email address', 'email');
    mkField('phone', 'Phone number', 'tel');
    mkField('company', 'Company');
    var submit = document.createElement('button');
    submit.textContent = 'Start chat →';
    submit.addEventListener('click', function () { form.remove(); done(vals); });
    form.appendChild(submit);
    body.appendChild(form);
    scroll();
  }

  function summarizeInfo(info) {
    var parts = [];
    if (info.name) parts.push('Name: ' + info.name);
    if (info.email) parts.push('Email: ' + info.email);
    if (info.phone) parts.push('Phone: ' + info.phone);
    return parts.length ? parts.join('  •  ') : 'Started chat';
  }

  function proceedAfterForm() {
    var tree = S.preChat.dialog_tree;
    if (tree && tree.nodes && tree.start_node && tree.nodes[tree.start_node]) {
      S.currentNode = tree.nodes[tree.start_node];
      showNode();
    } else {
      // No tree — go straight to AI chat
      unlockChat();
    }
  }

  function showNode() {
    var node = S.currentNode;
    if (!node) return unlockChat();
    addMsg('bot', node.message || '');
    if (node.options && node.options.length) {
      addQuickReplies(node.options, function (opt) {
        S.flowPath.push({ node: node.id || '', label: opt.label });
        addMsg('user', opt.label);
        if (opt.next === '__ai__') {
          unlockChat();
        } else if (S.preChat.dialog_tree.nodes[opt.next]) {
          S.currentNode = S.preChat.dialog_tree.nodes[opt.next];
          showNode();
        } else {
          unlockChat();
        }
      });
    } else {
      // Terminal node with no options — go to AI
      setTimeout(unlockChat, 600);
    }
  }

  function unlockChat() {
    S.chatReady = true;
    S.currentNode = null;
    inputRow.style.display = '';
    if (S.preChat.ai_fallback !== false) {
      addMsg('bot', "Got it — I'm ready to help! Ask me anything.");
    }
    scroll();
  }

  /* ---------- free chat ---------- */
  function send() {
    var text = input.value.trim();
    if (!text) return;
    // If chat isn't ready (still in flow), ignore or nudge
    if (!S.chatReady) return;
    input.value = '';
    addMsg('user', text);
    showTyping();
    fetch(base + '/api/widget/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        visitor: S.visitor,
        name: S.customerInfo.name || fallbackName || '',
        customer_info: S.customerInfo,
        flow_path: S.flowPath,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        hideTyping();
        if (data && data.reply) addMsg('bot', data.reply);
      })
      .catch(function () {
        hideTyping();
        addMsg('bot', 'Sorry, something went wrong. Please try again.');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();