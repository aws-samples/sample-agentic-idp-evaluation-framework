import DOMPurify from 'dompurify';

// Centralized HTML sanitizer — every `dangerouslySetInnerHTML` sink in the app
// must run user / model / extraction output through this helper so that
// injected <script>, inline handlers, javascript: URLs, etc. are stripped.
//
// Profiles:
//   'markdown'  — chat and docs content rendered from `marked.parse(...)`.
//                 Allows the common Markdown-produced HTML subset.
//   'table'     — extracted HTML tables (BDA / Textract output).
//                 Locks rendering to table-related tags only.
//   'svg'       — Mermaid-rendered SVG. Uses DOMPurify's SVG profile so the
//                 <svg> tree survives intact but scripts are stripped.
export type SanitizeProfile = 'markdown' | 'table' | 'svg';

export function sanitizeHtml(input: string, profile: SanitizeProfile = 'markdown'): string {
  if (!input) return '';
  switch (profile) {
    case 'svg':
      return DOMPurify.sanitize(input, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
    case 'table':
      return DOMPurify.sanitize(input, {
        ALLOWED_TAGS: [
          'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
          'col', 'colgroup', 'span', 'div', 'br', 'p', 'strong', 'em', 'code',
        ],
        ALLOWED_ATTR: ['colspan', 'rowspan', 'scope', 'class'],
      });
    case 'markdown':
    default:
      return DOMPurify.sanitize(input, {
        USE_PROFILES: { html: true },
        FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'],
      });
  }
}
