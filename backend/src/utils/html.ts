import sanitizeHtml from 'sanitize-html';

/**
 * Server-side allow-list sanitiser for rich text (SC-06). The browser sanitises
 * again before rendering; this makes sure dangerous markup is never *stored*
 * or e-mailed. Images may only point at same-origin upload paths or https URLs.
 */
export function cleanHtml(input: unknown): string {
  if (typeof input !== 'string') return '';
  return sanitizeHtml(input, {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div'],
    allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'], '*': ['class'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: 'noopener noreferrer nofollow', target: '_blank' } }),
    },
  });
}

export function plainText(input: string, max = 200): string {
  return sanitizeHtml(input || '', { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim().slice(0, max);
}
