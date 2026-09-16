import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper functions matching canonical implementation for testing
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatAssistantHtml(rawText) {
  if (rawText === null || rawText === undefined) return '';
  var str = String(rawText);
  if (!str.trim()) return '';

  // Normalize Windows/Mac line endings
  str = str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Normalize pre-existing safe <a> links to markdown syntax
  str = str.replace(/<a\s+(?:[^>]*?\s+)?href=["']((?:https?:\/\/|\/)[^"'>\s]+)["'][^>]*?>([\s\S]*?)<\/a>/gi, function(match, href, label) {
    var cleanLabel = label.replace(/<[^>]+>/g, '').trim() || href;
    return '[' + cleanLabel + '](' + href + ')';
  });

  // Normalize pre-existing HTML breaks and paragraphs
  str = str.replace(/<br\s*\/?>/gi, '\n');
  str = str.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  str = str.replace(/<\/?p[^>]*>/gi, '\n');

  var rawLines = str.split('\n');
  var blocks = [];
  var currentBlock = null;

  function closeCurrentBlock() {
    if (currentBlock) {
      blocks.push(currentBlock);
      currentBlock = null;
    }
  }

  for (var i = 0; i < rawLines.length; i++) {
    var rawLine = rawLines[i];
    var trimmed = rawLine.trim();

    if (!trimmed) {
      closeCurrentBlock();
      continue;
    }

    var headerMatch = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (headerMatch) {
      closeCurrentBlock();
      blocks.push({ type: 'p', lines: ['**' + headerMatch[1].trim() + '**'] });
      continue;
    }

    var numMatch = trimmed.match(/^(\d+)[\.\)]\s+(.*)$/);
    if (numMatch) {
      if (!currentBlock || currentBlock.type !== 'ol') {
        closeCurrentBlock();
        currentBlock = { type: 'ol', items: [] };
      }
      currentBlock.items.push(numMatch[2]);
      continue;
    }

    var bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      if (!currentBlock || currentBlock.type !== 'ul') {
        closeCurrentBlock();
        currentBlock = { type: 'ul', items: [] };
      }
      currentBlock.items.push(bulletMatch[1]);
      continue;
    }

    if (!currentBlock || currentBlock.type !== 'p') {
      closeCurrentBlock();
      currentBlock = { type: 'p', lines: [] };
    }
    currentBlock.lines.push(trimmed);
  }
  closeCurrentBlock();

  function formatInline(text) {
    if (!text) return '';

    var linkPlaceholders = [];

    // 1. Markdown links: [Label](https://...) or [Label](/path)
    var intermediate = text.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s\)\"'>]+)\)/g, function(match, label, url) {
      var idx = linkPlaceholders.length;
      var cleanLabel = escapeHtml(label)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>');
      var cleanUrl = escapeHtml(url);
      var linkHtml = '<a href="' + cleanUrl + '" target="_blank" rel="noopener noreferrer">' + cleanLabel + '</a>';
      linkPlaceholders.push(linkHtml);
      return '@@SAMCHELINK' + idx + 'TOKEN@@';
    });

    // 2. Standalone raw URLs: https://... or http://...
    intermediate = intermediate.replace(/(^|[\s(])(https?:\/\/[^\s)<>"']+)/g, function(match, prefix, url) {
      var trailing = '';
      var punctMatch = url.match(/[.,;:!?]+$/);
      if (punctMatch) {
        trailing = punctMatch[0];
        url = url.slice(0, -trailing.length);
      }
      var idx = linkPlaceholders.length;
      var cleanUrl = escapeHtml(url);
      var linkHtml = '<a href="' + cleanUrl + '" target="_blank" rel="noopener noreferrer">' + cleanUrl + '</a>';
      linkPlaceholders.push(linkHtml);
      return prefix + '@@SAMCHELINK' + idx + 'TOKEN@@' + trailing;
    });

    // 3. HTML Escape remaining text
    var escaped = escapeHtml(intermediate);

    // 4. Bold formatting
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // 5. Restore link placeholders
    for (var j = 0; j < linkPlaceholders.length; j++) {
      escaped = escaped.replace('@@SAMCHELINK' + j + 'TOKEN@@', linkPlaceholders[j]);
    }

    return escaped;
  }

  var htmlParts = [];
  for (var b = 0; b < blocks.length; b++) {
    var blk = blocks[b];
    if (blk.type === 'p') {
      var pContent = blk.lines.map(formatInline).join('<br>');
      htmlParts.push('<p>' + pContent + '</p>');
    } else if (blk.type === 'ol') {
      var olItems = blk.items.map(function(item) {
        return '<li>' + formatInline(item) + '</li>';
      }).join('');
      htmlParts.push('<ol>' + olItems + '</ol>');
    } else if (blk.type === 'ul') {
      var ulItems = blk.items.map(function(item) {
        return '<li>' + formatInline(item) + '</li>';
      }).join('');
      htmlParts.push('<ul>' + ulItems + '</ul>');
    }
  }

  return htmlParts.join('');
}

function renderAssistantMessage(targetNode, rawText) {
  if (!targetNode) return;
  var html = formatAssistantHtml(rawText);
  targetNode.innerHTML = html;
  if (!targetNode.textContent && typeof rawText === 'string') {
    targetNode.textContent = rawText;
  }
}

// ---------------------------------------------------------------------------
// Unit Tests: escapeHtml
// ---------------------------------------------------------------------------
test('escapeHtml: properly escapes dangerous characters', () => {
  assert.equal(escapeHtml('<script>alert("xss") & \'test\'</script>'), '&lt;script&gt;alert(&quot;xss&quot;) &amp; &#039;test&#039;&lt;/script&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(123), '123');
});

// ---------------------------------------------------------------------------
// Unit Tests: formatAssistantHtml - Basic & Formatting
// ---------------------------------------------------------------------------
test('formatAssistantHtml: returns empty string for empty input', () => {
  assert.equal(formatAssistantHtml(''), '');
  assert.equal(formatAssistantHtml(null), '');
  assert.equal(formatAssistantHtml(undefined), '');
  assert.equal(formatAssistantHtml('   \n  '), '');
});

test('formatAssistantHtml: wraps single line in paragraph', () => {
  const result = formatAssistantHtml('Merhaba! Size nasıl yardımcı olabilirim?');
  assert.equal(result, '<p>Merhaba! Size nasıl yardımcı olabilirim?</p>');
});

test('formatAssistantHtml: renders bold formatting', () => {
  const result1 = formatAssistantHtml('Bu **çok önemli** bir bilgidir.');
  assert.equal(result1, '<p>Bu <strong>çok önemli</strong> bir bilgidir.</p>');

  const result2 = formatAssistantHtml('Bu __alt çizgi__ ile kalın.');
  assert.equal(result2, '<p>Bu <strong>alt çizgi</strong> ile kalın.</p>');

  const result3 = formatAssistantHtml('**Birinci** ve **İkinci**');
  assert.equal(result3, '<p><strong>Birinci</strong> ve <strong>İkinci</strong></p>');
});

test('formatAssistantHtml: renders paragraphs and line breaks', () => {
  const multiPara = 'Birinci paragraf.\n\nİkinci paragraf.';
  assert.equal(formatAssistantHtml(multiPara), '<p>Birinci paragraf.</p><p>İkinci paragraf.</p>');

  const lineBreaks = 'Satır 1\nSatır 2\nSatır 3';
  assert.equal(formatAssistantHtml(lineBreaks), '<p>Satır 1<br>Satır 2<br>Satır 3</p>');
});

// ---------------------------------------------------------------------------
// Unit Tests: formatAssistantHtml - Lists
// ---------------------------------------------------------------------------
test('formatAssistantHtml: renders unordered bullet lists (- and * and •)', () => {
  const bulletHyphen = 'Özellikler:\n- Pil ömrü: 14 gün\n- IP68 su geçirmezlik\n- Hızlı şarj';
  assert.equal(
    formatAssistantHtml(bulletHyphen),
    '<p>Özellikler:</p><ul><li>Pil ömrü: 14 gün</li><li>IP68 su geçirmezlik</li><li>Hızlı şarj</li></ul>'
  );

  const bulletAsterisk = '* Madde bir\n* Madde iki';
  assert.equal(formatAssistantHtml(bulletAsterisk), '<ul><li>Madde bir</li><li>Madde iki</li></ul>');

  const bulletUnicode = '• Madde A\n• Madde B';
  assert.equal(formatAssistantHtml(bulletUnicode), '<ul><li>Madde A</li><li>Madde B</li></ul>');
});

test('formatAssistantHtml: renders ordered numbered lists (1. and 1))', () => {
  const orderedDot = 'Adımlar:\n1. Uygulamayı indirin\n2. Giriş yapın\n3. Eşleştirin';
  assert.equal(
    formatAssistantHtml(orderedDot),
    '<p>Adımlar:</p><ol><li>Uygulamayı indirin</li><li>Giriş yapın</li><li>Eşleştirin</li></ol>'
  );

  const orderedParen = '1) İlk adım\n2) İkinci adım';
  assert.equal(formatAssistantHtml(orderedParen), '<ol><li>İlk adım</li><li>İkinci adım</li></ol>');
});

test('formatAssistantHtml: renders bold formatting inside list items', () => {
  const input = '- **Pil ömrü:** 14 güne kadar\n- **Su geçirmezlik:** IP68 sertifikalı';
  assert.equal(
    formatAssistantHtml(input),
    '<ul><li><strong>Pil ömrü:</strong> 14 güne kadar</li><li><strong>Su geçirmezlik:</strong> IP68 sertifikalı</li></ul>'
  );
});
// ---------------------------------------------------------------------------
// Unit Tests: formatAssistantHtml - Links & Raw URLs
// ---------------------------------------------------------------------------
test('formatAssistantHtml: renders safe markdown links with blank target and rel', () => {
  const input = 'Detaylı bilgi için [web sitemizi](https://example.com/destek) ziyaret edebilirsiniz.';
  assert.equal(
    formatAssistantHtml(input),
    '<p>Detaylı bilgi için <a href="https://example.com/destek" target="_blank" rel="noopener noreferrer">web sitemizi</a> ziyaret edebilirsiniz.</p>'
  );

  const relativeInput = 'Bkz: [SSS](/faq)';
  assert.equal(
    formatAssistantHtml(relativeInput),
    '<p>Bkz: <a href="/faq" target="_blank" rel="noopener noreferrer">SSS</a></p>'
  );
});

test('formatAssistantHtml: autolinks standalone URLs safely', () => {
  const input = 'Web sitemiz https://samche.com.tr ziyaret edebilirsiniz.';
  assert.equal(
    formatAssistantHtml(input),
    '<p>Web sitemiz <a href="https://samche.com.tr" target="_blank" rel="noopener noreferrer">https://samche.com.tr</a> ziyaret edebilirsiniz.</p>'
  );
});

test('formatAssistantHtml: handles standalone URL with trailing punctuation and parentheses', () => {
  const inputPeriod = 'Ziyaret edin: https://samche.com.tr.';
  assert.equal(
    formatAssistantHtml(inputPeriod),
    '<p>Ziyaret edin: <a href="https://samche.com.tr" target="_blank" rel="noopener noreferrer">https://samche.com.tr</a>.</p>'
  );

  const inputComma = 'Sayfalar https://site1.com, ve https://site2.com!';
  assert.equal(
    formatAssistantHtml(inputComma),
    '<p>Sayfalar <a href="https://site1.com" target="_blank" rel="noopener noreferrer">https://site1.com</a>, ve <a href="https://site2.com" target="_blank" rel="noopener noreferrer">https://site2.com</a>!</p>'
  );

  const inputParen = 'Bilgi için (https://samche.com.tr/bilgi) linkine bakın.';
  assert.equal(
    formatAssistantHtml(inputParen),
    '<p>Bilgi için (<a href="https://samche.com.tr/bilgi" target="_blank" rel="noopener noreferrer">https://samche.com.tr/bilgi</a>) linkine bakın.</p>'
  );
});

// ---------------------------------------------------------------------------
// Unit Tests: formatAssistantHtml - Security & XSS Neutralization
// ---------------------------------------------------------------------------
test('formatAssistantHtml: neutralizes javascript: and data: links', () => {
  const xssLink = '[Tıkla](javascript:alert(1))';
  const result = formatAssistantHtml(xssLink);
  assert.ok(!result.includes('<a href="javascript:'));
  assert.ok(result.includes('[Tıkla](javascript:alert(1))'));

  const dataLink = '[Download](data:text/html,<script>alert(1)</script>)';
  const resultData = formatAssistantHtml(dataLink);
  assert.ok(!resultData.includes('<a href="data:'));
});

test('formatAssistantHtml: sanitizes raw HTML tags and scripts', () => {
  const scriptInput = '<script>alert("xss")</script>';
  assert.equal(formatAssistantHtml(scriptInput), '<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>');

  const imgInput = '<img src=x onerror=alert(1)>';
  assert.equal(formatAssistantHtml(imgInput), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');

  const iframeInput = '<iframe src="https://evil.com"></iframe>';
  assert.equal(formatAssistantHtml(iframeInput), '<p>&lt;iframe src=&quot;https://evil.com&quot;&gt;&lt;/iframe&gt;</p>');
});

test('formatAssistantHtml: normalizes safe pre-existing HTML <a> and <br>', () => {
  const input = 'Sayfamız <a href="https://example.com">Example</a> sitemizdedir.<br>İyi günler.';
  assert.equal(
    formatAssistantHtml(input),
    '<p>Sayfamız <a href="https://example.com" target="_blank" rel="noopener noreferrer">Example</a> sitemizdedir.<br>İyi günler.</p>'
  );
});

// ---------------------------------------------------------------------------
// Unit Tests: Headers support
// ---------------------------------------------------------------------------
test('formatAssistantHtml: converts markdown headers (###) to bold paragraphs', () => {
  const input = '### Önemli Duyuru\nDetaylar aşağıdadır.';
  assert.equal(formatAssistantHtml(input), '<p><strong>Önemli Duyuru</strong></p><p>Detaylar aşağıdadır.</p>');
});

test('formatAssistantHtml: bold inside link label and link inside bold', () => {
  const boldInLink = '[**Detaylı Bilgi**](https://example.com)';
  assert.equal(
    formatAssistantHtml(boldInLink),
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer"><strong>Detaylı Bilgi</strong></a></p>'
  );

  const linkInBold = '**[Detaylı Bilgi](https://example.com)**';
  assert.equal(
    formatAssistantHtml(linkInBold),
    '<p><strong><a href="https://example.com" target="_blank" rel="noopener noreferrer">Detaylı Bilgi</a></strong></p>'
  );
});

test('formatAssistantHtml: contiguous list type transition without blank line', () => {
  const mixedLists = '- Madde 1\n- Madde 2\n1. Adım 1\n2. Adım 2';
  assert.equal(
    formatAssistantHtml(mixedLists),
    '<ul><li>Madde 1</li><li>Madde 2</li></ul><ol><li>Adım 1</li><li>Adım 2</li></ol>'
  );
});

test('formatAssistantHtml: prevents quote breakout in markdown link URLs', () => {
  const breakout = '[Hacked](https://evil.com" onclick="alert(1))';
  const result = formatAssistantHtml(breakout);
  assert.ok(!result.includes('onclick="alert(1)'));
  assert.ok(result.includes('&quot;'));
});

test('formatAssistantHtml: ignores redundant blank lines without creating empty paragraphs', () => {
  const redundantBlanks = 'Paragraf 1\n\n\n\n\nParagraf 2';
  assert.equal(
    formatAssistantHtml(redundantBlanks),
    '<p>Paragraf 1</p><p>Paragraf 2</p>'
  );
});

test('renderAssistantMessage: properly sets innerHTML and textContent fallback on mock node', () => {
  const mockNode = { innerHTML: '', textContent: '' };
  renderAssistantMessage(mockNode, '**Kalın Metin**');
  assert.equal(mockNode.innerHTML, '<p><strong>Kalın Metin</strong></p>');
  assert.equal(mockNode.textContent, '**Kalın Metin**');
});


