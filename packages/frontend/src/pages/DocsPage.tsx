import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import Grid from '@cloudscape-design/components/grid';
import Alert from '@cloudscape-design/components/alert';
import Spinner from '@cloudscape-design/components/spinner';
import Box from '@cloudscape-design/components/box';
import Link from '@cloudscape-design/components/link';
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

interface DocIndex {
  sections: DocSection[];
}

// Parse YAML frontmatter (title: ..., description: ...) off the top of a markdown file.
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
  const activeSlug = slug ?? 'introduction';

  const [index, setIndex] = useState<DocIndex | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load index once.
  useEffect(() => {
    fetch('/docs/_index.json')
      .then((r) => {
        if (!r.ok) throw new Error(`index ${r.status}`);
        return r.json() as Promise<DocIndex>;
      })
      .then(setIndex)
      .catch((e) => setError(`Failed to load docs index: ${e.message}`));
  }, []);

  // Load markdown for the active slug.
  useEffect(() => {
    setLoading(true);
    setMarkdown(null);
    setError(null);
    fetch(`/docs/${activeSlug}.md`)
      .then((r) => {
        if (!r.ok) throw new Error(`${activeSlug}.md ${r.status}`);
        return r.text();
      })
      .then(setMarkdown)
      .catch((e) => setError(`Failed to load /docs/${activeSlug}.md: ${e.message}`))
      .finally(() => setLoading(false));
  }, [activeSlug]);

  const { title, description, html } = useMemo(() => {
    if (!markdown) return { title: undefined, description: undefined, html: '' };
    const { title, description, body } = parseFrontmatter(markdown);
    return { title, description, html: marked.parse(body, { async: false }) as string };
  }, [markdown]);

  // Update document title for better tab names and share previews.
  useEffect(() => {
    if (title) {
      document.title = `${title} · ONE IDP Docs`;
    }
    return () => {
      document.title = 'ONE IDP';
    };
  }, [title]);

  // SideNavigation items (flat list grouped by section header).
  const navItems = useMemo(() => {
    if (!index) return [];
    return index.sections.flatMap((section) => [
      { type: 'section', text: section.title, expanded: true, items: section.items.map((it) => ({
        type: 'link' as const,
        text: it.title,
        href: `#/docs/${it.slug}`,
      })) },
    ]);
  }, [index]);

  const activeHref = `#/docs/${activeSlug}`;

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Everything you need to know about ONE IDP — the workflow, methods, pricing, deployment, and the generated code."
        >
          Documentation
        </Header>
      }
    >
      <Grid gridDefinition={[{ colspan: { default: 12, l: 3 } }, { colspan: { default: 12, l: 9 } }]}>
        <div>
          <Container>
            <SideNavigation
              activeHref={activeHref}
              items={navItems as never}
              onFollow={(e) => {
                e.preventDefault();
                const href = e.detail.href;
                if (href?.startsWith('#/docs/')) {
                  navigate(href.slice(1));
                }
              }}
            />
          </Container>
        </div>
        <div>
          <Container
            header={
              <Header
                variant="h2"
                description={description}
              >
                {title ?? 'Loading…'}
              </Header>
            }
          >
            {loading && (
              <Box textAlign="center" padding="xl">
                <Spinner size="normal" />
              </Box>
            )}
            {error && (
              <Alert type="error" header="Document not found">
                {error}{' '}
                <Link onFollow={() => navigate('/docs/introduction')}>Back to Introduction</Link>
              </Alert>
            )}
            {!loading && !error && html && (
              <SpaceBetween size="m">
                <article
                  className="docs-markdown"
                  dangerouslySetInnerHTML={{ __html: html }}
                  onClick={(e) => {
                    // Intercept internal /docs/* links for client-side navigation.
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
              </SpaceBetween>
            )}
          </Container>
        </div>
      </Grid>
    </ContentLayout>
  );
}
