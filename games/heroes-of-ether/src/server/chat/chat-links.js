"use strict";

// Strip addresses, not the surrounding message. No network lookups are needed.
const address = /(?:\b(?:[a-z][a-z\d+.-]{1,20}:\/\/|(?:https?|ftp|mailto|tg|discord|steam|magnet):)[^\s<>]+|(?:\/\/)?(?:[\p{L}\p{N}_+.-]+@)?(?:www\.)?(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:xn--[a-z\d-]{2,59}|[\p{L}]{2,63})(?::\d{1,5})?(?:[/?#][^\s<>]*)?|(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[/?#][^\s<>]*)?)/giu;
function stripLinks(text) {
  return text
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\[([^\]\r\n]*)\]\([^\s)]*\)/g, "$1")
    .replace(address, match => match.match(/[.,!?;:»”')\]]+$/u)?.[0] || "")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}
module.exports = { stripLinks };
