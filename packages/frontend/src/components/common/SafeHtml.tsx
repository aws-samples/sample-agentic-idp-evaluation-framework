import { sanitizeHtml, type SanitizeProfile } from '../../utils/sanitizeHtml';

interface SafeHtmlProps {
  html: string;
  profile: SanitizeProfile;
  className?: string;
  style?: React.CSSProperties;
}

// Wrapper that localizes every unsafe-HTML sink in the app to a single file.
// All callers pass plain HTML/SVG/Markdown strings + a sanitization profile;
// DOMPurify runs here before React mounts the content.
//
// Security scanners that flag dangerouslySetInnerHTML by pattern should be
// dispositioned against this file only. Reviewers can audit the single
// unsafe sink here once instead of every caller.
export default function SafeHtml({ html, profile, className, style }: SafeHtmlProps) {
  const clean = sanitizeHtml(html, profile);
  // eslint-disable-next-line react/no-danger
  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: clean }} />;
}
