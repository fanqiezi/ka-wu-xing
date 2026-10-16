/*
 * 极简 DOM 打桩，用于在 Node 里跑界面层（ui.js / game.js）的联调测试。
 * 只实现 ui.js 用到的那部分能力。
 */
'use strict';

function createDom(htmlSource) {
  function Node(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this._classes = new Set();
    this._listeners = {};
    this._html = '';
    this.textContent = '';
    this.title = '';
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.dataset = {};
    this.style = {};
  }

  /** 极简 closest：只认自己身上有没有这个 class（测试够用） */
  Node.prototype.closest = function (sel) {
    if (!sel) return null;
    var cls = String(sel).replace(/^\./, '');
    return this._classes.has(cls) ? this : null;
  };

  Object.defineProperty(Node.prototype, 'className', {
    get: function () { return Array.from(this._classes).join(' '); },
    set: function (v) {
      this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    }
  });

  Object.defineProperty(Node.prototype, 'classList', {
    get: function () {
      var set = this._classes;
      return {
        add: function () {
          for (var i = 0; i < arguments.length; i++) if (arguments[i]) set.add(arguments[i]);
        },
        remove: function () {
          for (var i = 0; i < arguments.length; i++) set.delete(arguments[i]);
        },
        contains: function (n) { return set.has(n); },
        toggle: function (n, force) {
          if (force === undefined) { set.has(n) ? set.delete(n) : set.add(n); }
          else if (force) set.add(n);
          else set.delete(n);
        }
      };
    }
  });

  Object.defineProperty(Node.prototype, 'childNodes', {
    get: function () { return this.children; }
  });
  Object.defineProperty(Node.prototype, 'firstChild', {
    get: function () { return this.children[0] || null; }
  });
  Object.defineProperty(Node.prototype, 'innerHTML', {
    get: function () { return this._html; },
    set: function (v) {
      this._html = String(v);
      this.children.length = 0;
      registerIdsFromHtml(this._html);
    }
  });

  Node.prototype.appendChild = function (n) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.children.push(n);
    return n;
  };
  Node.prototype.insertBefore = function (n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    var i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n);
    else this.children.splice(i, 0, n);
    return n;
  };
  Node.prototype.dispatchEvent = function (e) {
    var arr = this._listeners[e && e.type] || [];
    for (var i = 0; i < arr.length; i++) arr[i](e);
  };
  Node.prototype.removeChild = function (n) {
    var i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parentNode = null;
    return n;
  };
  Node.prototype.remove = function () {
    if (this.parentNode) this.parentNode.removeChild(this);
  };
  Node.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  Node.prototype.click = function () {
    var arr = this._listeners.click || [];
    for (var i = 0; i < arr.length; i++) arr[i]({ target: this });
  };

  var byId = {};
  var body = new Node('body');

  /** 把一段 HTML 里声明的元素（只要带 id）注册成可 getElementById 的桩节点 */
  function registerIdsFromHtml(html) {
    var tagRe = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
    var m;
    while ((m = tagRe.exec(html))) {
      var tagName = m[1].toLowerCase();
      if (tagName === 'br' || tagName === 'option') continue;
      var attrs = m[2];
      var idMatch = /id="([^"]+)"/.exec(attrs);
      if (!idMatch) continue;
      var node = new Node(tagName);
      node.id = idMatch[1];
      if (tagName === 'input') {
        node.checked = /\bchecked\b/.test(attrs);
        node.type = (/type="([^"]+)"/.exec(attrs) || [, 'text'])[1];
      } else if (tagName === 'select') {
        var rest = html.slice(tagRe.lastIndex);
        var end = rest.indexOf('</select>');
        var inner = end >= 0 ? rest.slice(0, end) : rest;
        var sel = /<option value="([^"]*)"[^>]*\bselected\b/i.exec(inner) ||
          /<option value="([^"]*)"/i.exec(inner);
        node.value = sel ? sel[1] : '';
      }
      byId[node.id] = node;
      body.appendChild(node);
    }
  }

  var document = {
    body: body,
    createElement: function (tag) { return new Node(tag); },
    getElementById: function (id) { return byId[id] || null; },
    addEventListener: function () {}
  };

  // 按 index.html 里声明的 id 建好节点，保证 UI 与 HTML 对得上
  var re = /id="([^"]+)"/g, m;
  while ((m = re.exec(htmlSource))) {
    var n = new Node('div');
    n.id = m[1];
    byId[m[1]] = n;
    body.appendChild(n);
  }

  var windowListeners = {};
  var window = {
    document: document,
    addEventListener: function (type, fn) {
      (windowListeners[type] = windowListeners[type] || []).push(fn);
    },
    dispatch: function (type) {
      var arr = windowListeners[type] || [];
      for (var i = 0; i < arr.length; i++) arr[i]({ type: type });
    },
    confirm: function () { return true; },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    console: console,
    Math: Math
  };

  function walk(node, fn) {
    fn(node);
    for (var i = 0; i < node.children.length; i++) walk(node.children[i], fn);
  }

  function findAll(root, pred) {
    var out = [];
    walk(root, function (n) { if (pred(n)) out.push(n); });
    return out;
  }

  function hasClass(n, cls) { return n._classes && n._classes.has(cls); }

  return {
    window: window,
    document: document,
    body: body,
    byId: byId,
    findAll: findAll,
    hasClass: hasClass,
    Node: Node
  };
}

module.exports = { createDom: createDom };
