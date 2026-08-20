/**
 * Bamisoro Chat website widget — drop-in chat bubble.
 *
 * Usage (on any website):
 *   <script src="https://<your-app>/widget.js" data-widget="<AGENT_WIDGET_TOKEN>" defer></script>
 *   (optional: data-visitor="your-own-id", data-name="Visitor name")
 *
 * Vanilla JS, no dependencies. Resolves config from the widget API,
 * renders a bubble + panel, and routes messages into the inbox as
 * website conversations.
 */
(function () {
  if (window.__bamisoroWidget) return;
  window.__bamisoroWidget = true;

  var script = document.currentScript;
  var base =
    (script && script.src
      ? script.src.replace(/\/widget\/widget\.js.*$/, '').replace(/[?#].*$/, '').replace(/\/$/, '')
      : window.location.origin);
  var token =
    (script && script.dataset && script.dataset.widget) ||
    (function () {
      try {
        return new URLSearchParams(window.location.search).get('widget') || '';
      } catch (e) {
        return '';
      }
    })();
  var fallbackVisitor = (script && script.dataset && script.dataset.visitor) || '';

  function config() {
    return {
      base: base,
      token: token,
    };
  }

  function visitorId() {
    try {
      var id = localStorage.getItem('bamisoro_visitor');
      if (!id) {
        id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('bamisoro_visitor', id);
      }
      return id;
    } catch (e) {
      return 'v_anon_' + Math.random().toString(36).slice(2);
    }
  }

  function init() {
    var cfg = config();
    if (!cfg.token) {
      console.warn('[BamisoroChat] missing data-widget token');
      return;
    }

    fetch(cfg.base + '/api/widget/' + encodeURIComponent(cfg.token), {
      headers: { Accept: 'application/json' },
    })
      .then(function (r) {
        if (!r.ok) throw new Error('widget config ' + r.status);
        return r.json();
      })
      .then(function (data) {
        render(data.agent);
      })
      .catch(function (e) {
        console.warn('[BamisoroChat] could not load config', e);
      });
  }

  function render(agent) {
    if (!agent) return;
    var cfg = config();
    var color = agent.widget_primary_color || '#7c3aed';
    var position = agent.widget_position || 'right';

    var style = document.createElement('style');
    style.textContent =
      '#bamisoro-widget{position:fixed;' + position + ':24px;bottom:24px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '#bamisoro-widget *{box-sizing:border-box}' +
      '.bsr-toggle{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;color:#fff;font-size:24px;box-shadow:0 4px 16px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;background:' + color + '}' +
      '.bsr-panel{position:fixed;' + position + ':24px;bottom:96px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 140px);background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden;border:1px solid rgba(0,0,0,.08)}' +
      '.bsr-panel.open{display:flex}' +
      '.bsr-head{background:' + color + ';color:#fff;padding:14px 16px;font-weight:600;display:flex;align-items:center;gap:10px}' +
      '.bsr-head .bsr-title{flex:1;font-size:15px}' +
      '.bsr-head .bsr-close{background:none;border:none;color:#fff;font-size:18px;cursor:pointer}' +
      '.bsr-msg{display:flex;flex-direction:column}' +
      '.bsr-bubble{max-width:80%;margin:4px 12px;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}' +
      '.bsr-bot{background:#f1f3f5;color:#1a1a1a;align-self:flex-start;border-bottom-left-radius:4px}' +
      '.bsr-user{background:' + color + ';color:#fff;align-self:flex-end;border-bottom-right-radius:4px}' +
      '.bsr-body{flex:1;overflow-y:auto;padding:12px 0;background:#fafafa}' +
      '.bsr-input-row{display:flex;border-top:1px solid #eee;padding:8px;background:#fff;gap:6px}' +
      '.bsr-input-row input{flex:1;border:1px solid #ddd;border-radius:24px;padding:10px 14px;font-size:14px;outline:none}' +
      '.bsr-input-row button{border:none;background:' + color + ';color:#fff;border-radius:50%;width:40px;height:40px;cursor:pointer;font-size:16px}';

    document.head.appendChild(style);

    var root = document.createElement('div');
    root.id = 'bamisoro-widget';
    root.innerHTML =
      '<div class="bsr-panel">' +
      '<div class="bsr-head"><span class="bsr-title">' + esc(agent.widget_title || agent.name || 'Chat with us') + '</span><button class="bsr-close" aria-label="Close chat">×</button></div>' +
      '<div class="bsr-body"></div>' +
      '<div class="bsr-input-row"><input type="text" placeholder="Type a message..." aria-label="Message"><button aria-label="Send">➤</button></div>' +
      '</div>' +
      '<button class="bsr-toggle" aria-label="Open chat">💬</button>';
    document.body.appendChild(root);

    var panel = root.querySelector('.bsr-panel');
    var toggle = root.querySelector('.bsr-toggle');
    var closeBtn = root.querySelector('.bsr-close');
    var body = root.querySelector('.bsr-body');
    var input = root.querySelector('input');
    var sendBtn = root.querySelector('.bsr-input-row button');
    var visitorId = fallbackVisitor || (function () {
      try {
        var id = localStorage.getItem('bamisoro_visitor');
        if (!id) {
          id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
          localStorage.setItem('bamisoro_visitor', id);
        }
        return id;
      } catch (e) {
        return 'v_anon_' + Math.random().toString(36).slice(2);
      }
    })();

    // Welcome bubble
    addMsg('bot', agent.widget_welcome_message || 'Hi! How can we help you today?');

    function addMsg(role, text) {
      var el = document.createElement('div');
      el.className = 'bsr-msg';
      var bubble = document.createElement('div');
      bubble.className = 'bsr-bubble ' + (role === 'user' ? 'bsr-user' : 'bsr-bot');
      bubble.textContent = text;
      el.appendChild(bubble);
      body.appendChild(el);
      body.scrollTop = body.scrollHeight;
    }

    function send() {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      addMsg('user', text);
      var busy = document.createElement('div');
      busy.className = 'bsr-bubble bsr-bot';
      busy.textContent = '…';
      body.appendChild(busy);
      body.scrollTop = body.scrollHeight;
      fetch(cfg.base + '/api/widget/' + encodeURIComponent(cfg.token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          visitor: visitor,
          name: (script && script.dataset.name) || '',
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          busy.remove();
          if (data && data.reply) addMsg('bot', data.reply);
        })
        .catch(function () {
          busy.remove();
          addMsg('bot', 'Sorry, something went wrong. Please try again.');
        });
    }

    function esc(s) {
      var d = document.createElement('div');
      d.textContent = s == null ? '' : String(s);
      return d.innerHTML;
    }

    toggle.addEventListener('click', function () {
      panel.classList.toggle('open');
    });
    closeBtn.addEventListener('click', function () {
      panel.classList.remove('open');
    });
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') send();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();