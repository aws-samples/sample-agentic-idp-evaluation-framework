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
      /*
       * `foreignObject` must be allowed explicitly, or every node label vanishes.
       *
       * DOMPurify's SVG profile does not include `<foreignObject>`, and Mermaid renders
       * flowchart NODE labels inside one (edge labels use plain `<text>`, which the profile
       * does allow). So diagrams rendered as a grid of empty boxes with the connector
       * labels still visible — a shape that looks like a Mermaid bug and is actually
       * sanitiser stripping.
       *
       * Measured on a real render: 4 foreignObject elements in, 0 out, and the string
       * "API Gateway" absent from the result. Adding `html: true` to USE_PROFILES does NOT
       * fix it — only naming the tag does. Verified in the same probe that a
       * `<script>` and an `onload=` attribute are still removed with this config, so the
       * XSS guarantee is unchanged; `foreignObject` is a container, and its contents are
       * still sanitised by the profile rules.
       */
      return DOMPurify.sanitize(input, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ['foreignObject'],
        // `xmlns` on the inner <div> is what makes the embedded XHTML render at all.
        ADD_ATTR: ['xmlns'],
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
