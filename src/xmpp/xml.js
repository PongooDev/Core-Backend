import { StringDecoder } from "node:string_decoder";

// Just enough XML for an XMPP stream (what libjingle's expat-based XmppEngine sends): an open <stream:stream> root and
// whole stanzas under it. No DTDs; prefixes are kept as part of the name.

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== "#") return entities[entity] ?? match;
    const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

export const escapeText = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text) => escapeText(text).replace(/"/g, "&quot;");

export class Element {
  constructor(name, attrs = {}, children = []) {
    this.name = name;
    this.attrs = attrs;
    this.children = children;
  }

  get elements() {
    return this.children.filter((child) => child instanceof Element);
  }

  // The first child element with this name (and xmlns, when given).
  child(name, xmlns) {
    return this.elements.find((element) => element.name === name && (xmlns === undefined || element.attrs.xmlns === xmlns));
  }

  text() {
    return this.children.map((child) => (child instanceof Element ? child.text() : child)).join("");
  }

  toString() {
    const attrs = Object.entries(this.attrs).filter(([, value]) => value !== undefined)
      .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join("");
    if (!this.children.length) return `<${this.name}${attrs}/>`;
    const inner = this.children.map((child) => (child instanceof Element ? child.toString() : escapeText(child))).join("");
    return `<${this.name}${attrs}>${inner}</${this.name}>`;
  }
}

// xml("iq", {type: "result"}, xml("bind", ...), "text")
export const xml = (name, attrs = {}, ...children) => new Element(name, attrs, children.flat().filter((child) => child !== undefined && child !== null && child !== false));

function parseTag(source) {
  const match = source.match(/^<([^\s/>]+)/);
  if (!match) throw new Error("bad tag");
  const attrs = {};
  const pattern = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  let position = match[0].length;
  for (;;) {
    pattern.lastIndex = position;
    const attr = pattern.exec(source);
    if (!attr) break;
    attrs[attr[1]] = decode(attr[2] ?? attr[3]);
    position = pattern.lastIndex;
  }
  const rest = source.slice(position);
  if (!/^\s*\/?>$/.test(rest)) throw new Error("bad tag");
  return { name: match[1], attrs, selfClosing: rest.trim() === "/>" };
}

// Where the tag starting at `from` ends ('>' outside quotes), or -1 while it's incomplete.
function tagEnd(buffer, from) {
  let quote = null;
  for (let i = from; i < buffer.length; i++) {
    const char = buffer[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

const streamName = "stream:stream";

// Feeds bytes in and calls onStreamStart(attrs), onStanza(element) and onStreamEnd(). A new <stream:stream> when no
// stanza is open is a stream restart (after SASL), reported as another onStreamStart.
export function createStreamParser({ onStreamStart, onStanza, onStreamEnd, maxBuffer = 1024 * 1024 }) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let inStream = false;
  let stanzaSize = 0;
  const open = [];

  // Counts what the current stanza has used, so one endless stanza can't grow without limit either.
  function consume(length) {
    buffer = buffer.slice(length);
    stanzaSize += length;
    if (stanzaSize > maxBuffer) throw new Error("stanza too large");
  }

  function finish(element) {
    stanzaSize = 0;
    onStanza(element);
  }

  function addText(text) {
    if (!open.length) return; // whitespace keepalives between stanzas
    const parent = open[open.length - 1];
    const last = parent.children[parent.children.length - 1];
    if (typeof last === "string") parent.children[parent.children.length - 1] = last + text;
    else parent.children.push(text);
  }

  // Text waits for the next '<', so an entity split across two reads still decodes.
  function step() {
    const lt = buffer.indexOf("<");
    if (lt === -1) return false;
    if (lt > 0) {
      addText(decode(buffer.slice(0, lt)));
      consume(lt);
    }

    if (buffer.startsWith("<!--")) {
      const end = buffer.indexOf("-->");
      if (end === -1) return false;
      consume(end + 3);
      return true;
    }
    if (buffer.startsWith("<![CDATA[")) {
      const end = buffer.indexOf("]]>");
      if (end === -1) return false;
      addText(buffer.slice(9, end));
      consume(end + 3);
      return true;
    }
    if (buffer.startsWith("<?")) {
      const end = buffer.indexOf("?>");
      if (end === -1) return false;
      consume(end + 2);
      return true;
    }
    if (buffer.startsWith("<!")) {
      if ("<![CDATA[".startsWith(buffer) || "<!--".startsWith(buffer)) return false; // the rest hasn't arrived yet
      throw new Error("unsupported markup");
    }

    const end = tagEnd(buffer, 1);
    if (end === -1) return false;
    const source = buffer.slice(0, end + 1);
    consume(end + 1);

    if (source.startsWith("</")) {
      const name = source.slice(2, -1).trim();
      if (!open.length) {
        if (name !== streamName || !inStream) throw new Error(`unexpected </${name}>`);
        inStream = false;
        onStreamEnd();
        return true;
      }
      const element = open.pop();
      if (element.name !== name) throw new Error(`</${name}> closes <${element.name}>`);
      if (!open.length) finish(element);
      return true;
    }

    const { name, attrs, selfClosing } = parseTag(source);
    if (name === streamName && !open.length) {
      inStream = true;
      stanzaSize = 0;
      onStreamStart(attrs);
      return true;
    }
    if (!inStream) throw new Error(`<${name}> outside the stream`);
    const element = new Element(name, attrs);
    if (open.length) open[open.length - 1].children.push(element);
    if (selfClosing) {
      if (!open.length) finish(element);
    } else {
      open.push(element);
    }
    return true;
  }

  return {
    write(chunk) {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      while (buffer.length && step()) {
        // keep going while whole tags are available
      }
      if (buffer.length > maxBuffer) throw new Error("stanza too large");
    }
  };
}
