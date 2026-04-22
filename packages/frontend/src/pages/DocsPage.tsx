import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Alert from '@cloudscape-design/components/alert';
import Spinner from '@cloudscape-design/components/spinner';
import Box from '@cloudscape-design/components/box';
import { marked } from 'marked';

interface DocItem {
  slug: string;
  title: string;
  description: string;
}

interface DocSection {
  title: string;
  items: DocItem[];
}

// ─── Source of truth for the docs index ─────────────────────────────────────
// Matches the MDX files bundled at build time in packages/frontend/public/docs/.
// Rendered inline rather than fetched as JSON so the sidebar is instant.
const DOCS_INDEX: DocSection[] = [
  {
    title: 'Getting started',
    items: [
      { slug: 'introduction', title: 'Introduction', description: "What ONE IDP is and who it's for." },
      { slug: 'quickstart', title: 'Quickstart', description: 'Upload a document and run a benchmark in 5 minutes.' },
    ],
  },
  {
    title: 'Concepts',
    items: [
      { slug: 'workflow', title: 'The 5-step workflow', description: 'What happens at each step.' },
      { slug: 'capabilities', title: 'Capabilities', description: '33 capabilities across 8 categories.' },
      { slug: 'methods', title: 'Processing methods', description: '15 methods spanning BDA, Claude, Nova, Textract.' },
      { slug: 'pricing', title: 'Pricing & cost model', description: 'How costs are calculated and what to expect at scale.' },
    ],
  },
  {
    title: 'Deployment',
    items: [
      { slug: 'architecture', title: 'System architecture', description: 'How the platform is deployed on AWS.' },
      { slug: 'deploy', title: 'Deploying your own instance', description: 'Terraform and CDK paths.' },
      { slug: 'auth', title: 'Authentication', description: 'Pluggable auth — none, midway, cognito.' },
      { slug: 'security', title: 'Security posture', description: 'Hardening applied and trust boundaries.' },
    ],
  },
  {
    title: 'Generated code',
    items: [
      { slug: 'codegen', title: 'Production-ready project output', description: 'The 10-file project produced at the end of the pipeline.' },
      { slug: 'limitations', title: 'Limitations & FAQ', description: 'Known constraints and common questions.' },
    ],
  },
];

const FLAT_ITEMS = DOCS_INDEX.flatMap((s) => s.items);

function parseFrontmatter(raw: string): { title?: string; description?: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return { title: meta.title, description: meta.description, body: match[2] };
}

export default function DocsPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);

  const activeSlug = slug && FLAT_ITEMS.some((i) => i.slug === slug) ? slug : 'introduction';

  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMarkdown(null);
    setError(null);
    fetch(`/docs-content/${activeSlug}.md`)
      .then((r) => {
        if (!r.ok) throw new Error(`${activeSlug}.md ${r.status}`);
        return r.text();
      })
      .then((t) => { if (!cancelled) setMarkdown(t); })
      .catch((e) => { if (!cancelled) setError(`Failed to load ${activeSlug}: ${e.message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeSlug]);

  // Scroll back to top when switching slugs.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    globalThis.window?.scrollTo(0, 0);
  }, [activeSlug]);

  const { title, description, html } = useMemo(() => {
    if (!markdown) return { title: undefined, description: undefined, html: '' };
    const { title, description, body } = parseFrontmatter(markdown);
    return { title, description, html: marked.parse(body, { async: false }) as string };
  }, [markdown]);

  useEffect(() => {
    if (title) document.title = `${title} · ONE IDP Docs`;
    return () => { document.title = 'ONE IDP'; };
  }, [title]);

  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-header" onClick={() => navigate('/')} role="button" tabIndex={0}
             onKeyDown={(e) => { if (e.key === 'Enter') navigate('/'); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          <span>Back to app</span>
        </div>
        <div className="docs-sidebar-title">ONE IDP Docs</div>
        <nav className="docs-nav">
          {DOCS_INDEX.map((section) => (
            <div key={section.title} className="docs-nav-section">
              <div className="docs-nav-section-title">{section.title}</div>
              {section.items.map((item) => (
                <a
                  key={item.slug}
                  className={`docs-nav-link${item.slug === activeSlug ? ' is-active' : ''}`}
                  href={`/docs/${item.slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/docs/${item.slug}`);
                  }}
                >
                  {item.title}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="docs-main" ref={contentRef}>
        <div className="docs-content">
          <SpaceBetween size="m">
            {loading && (
              <Box textAlign="center" padding="xxl"><Spinner size="large" /></Box>
            )}
            {error && (
              <Alert type="error" header="Document not found">{error}</Alert>
            )}
            {!loading && !error && html && (
              <>
                <Header variant="h1" description={description}>{title}</Header>
                <article
                  className="docs-markdown"
                  dangerouslySetInnerHTML={{ __html: html }}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    const anchor = target.closest('a') as HTMLAnchorElement | null;
                    if (!anchor) return;
                    const href = anchor.getAttribute('href') ?? '';
                    if (href.startsWith('/docs/')) {
                      e.preventDefault();
                      navigate(href);
                    }
                  }}
                />
              </>
            )}
          </SpaceBetween>
        </div>
      </main>
    </div>
  );
}
