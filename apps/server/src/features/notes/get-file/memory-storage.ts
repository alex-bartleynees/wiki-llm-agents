/**
 * Pages run in an opaque origin, where touching `localStorage` or `sessionStorage`
 * throws a SecurityError, and many pages (the vault's Vue reports, for one) crash on
 * it. This script, run first, replaces each one that throws with an in-memory store:
 * the page works, its settings last until it is closed, and the sandbox is untouched.
 */
const SCRIPT = `<script>(function () {
  function memoryStorage() {
    var items = new Map();
    return {
      get length() { return items.size; },
      key: function (index) { var keys = Array.from(items.keys()); return index < keys.length ? keys[index] : null; },
      getItem: function (key) { key = String(key); return items.has(key) ? items.get(key) : null; },
      setItem: function (key, value) { items.set(String(key), String(value)); },
      removeItem: function (key) { items.delete(String(key)); },
      clear: function () { items.clear(); }
    };
  }
  ["localStorage", "sessionStorage"].forEach(function (name) {
    try { void window[name]; } catch (error) {
      Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
    }
  });
})();</script>`;

const DOCTYPE = /^(﻿?\s*<!doctype[^>]*>)/i;

/** Inserts the script after the doctype (before it would switch the page to quirks mode). */
export const withMemoryStorage = (html: string): string => {
  const doctype = DOCTYPE.exec(html);
  return doctype === null
    ? `${SCRIPT}${html}`
    : `${doctype[1]}${SCRIPT}${html.slice(doctype[1]!.length)}`;
};
