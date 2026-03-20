import Cards from '@cloudscape-design/components/cards';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Toggle from '@cloudscape-design/components/toggle';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Badge from '@cloudscape-design/components/badge';
import Tabs from '@cloudscape-design/components/tabs';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { CapabilityRecommendation, Capability, CapabilityCategory } from '@idp/shared';
import { CAPABILITY_INFO, CAPABILITY_CATEGORIES, CATEGORY_INFO } from '@idp/shared';
import type { PreviewResponse, MethodResult, CapabilityResult } from '../../hooks/usePreview';

interface CapabilityCardsProps {
  recommendations: CapabilityRecommendation[];
  selected: Capability[];
  onToggle: (capability: Capability, enabled: boolean) => void;
  onRunPreview?: () => void;
  isPreviewLoading?: boolean;
  preview?: PreviewResponse | null;
}

function renderExtraction(data: unknown, format: string): React.ReactNode {
  if (data == null) return <Box color="text-body-secondary" fontSize="body-s">No data extracted</Box>;

  // HTML tables: render directly
  if (format === 'html' && typeof data === 'string') {
    return (
      <div
        style={{ fontSize: '12px', maxHeight: '200px', overflow: 'auto', lineHeight: 1.4 }}
        dangerouslySetInnerHTML={{ __html: data }}
      />
    );
  }

  // Text: show as readable text (not code block)
  if (format === 'text' && typeof data === 'string') {
    return (
      <div style={{
        fontSize: '13px', lineHeight: 1.5, maxHeight: '400px', overflow: 'auto',
        padding: '8px', background: '#fafafa', borderRadius: '4px',
        whiteSpace: 'pre-wrap',
      }}>
        {data}
      </div>
    );
  }

  // JSON/objects: formatted code block
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <pre style={{
      fontSize: '12px', lineHeight: 1.4, margin: 0,
      maxHeight: '400px', overflow: 'auto',
      background: '#f8f9fa', padding: '8px', borderRadius: '4px',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      {text}
    </pre>
  );
}

function InlinePreviewResult({ capId, preview }: { capId: string; preview: PreviewResponse }) {
  const methodResults = preview.results.filter((r) => r.status === 'complete');
  if (methodResults.length === 0) return null;

  const tabs = methodResults.map((r) => {
    const capResult = r.results[capId] as CapabilityResult | undefined;
    const hasData = capResult && capResult.data != null;

    return {
      id: r.method,
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {r.shortName}
          {hasData ? (
            <span style={{ color: '#037f0c', fontSize: '11px' }}>
              {capResult.confidence != null ? `${Math.round(capResult.confidence * 100)}%` : ''}
            </span>
          ) : (
            <span style={{ color: '#9ba7b6', fontSize: '11px' }}>N/A</span>
          )}
        </span>
      ) as unknown as string,
      content: hasData ? (
        <div style={{ padding: '4px 0' }}>
          {renderExtraction(capResult.data, capResult.format)}
        </div>
      ) : (
        <Box color="text-body-secondary" fontSize="body-s" padding={{ top: 'xs' }}>
          Not extracted by this method
        </Box>
      ),
    };
  });

  return (
    <div style={{
      marginTop: '8px',
      borderTop: '1px solid #e9ebed',
      paddingTop: '8px',
    }}>
      <Tabs tabs={tabs} />
    </div>
  );
}

export default function CapabilityCards({
  recommendations,
  selected,
  onToggle,
  onRunPreview,
  isPreviewLoading,
  preview,
}: CapabilityCardsProps) {
  const groupedByCategory: Record<CapabilityCategory, CapabilityRecommendation[]> = {} as Record<CapabilityCategory, CapabilityRecommendation[]>;

  for (const category of CAPABILITY_CATEGORIES) {
    groupedByCategory[category] = [];
  }

  for (const rec of recommendations) {
    const info = CAPABILITY_INFO[rec.capability];
    if (info) {
      groupedByCategory[info.category].push(rec);
    }
  }

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        description="Based on your document analysis, these capabilities are recommended"
        counter={`(${selected.length} selected)`}
        actions={
          selected.length > 0 && onRunPreview ? (
            <Button
              variant={preview ? 'normal' : 'primary'}
              onClick={onRunPreview}
              loading={isPreviewLoading}
              iconName="play"
            >
              {preview ? 'Re-run Preview' : `Run Preview (${selected.length})`}
            </Button>
          ) : undefined
        }
      >
        Recommended Capabilities
      </Header>

      {/* Preview summary bar */}
      {preview && !isPreviewLoading && (
        <div style={{
          display: 'flex', gap: '16px', flexWrap: 'wrap',
          padding: '10px 16px', background: '#f0f8ff', borderRadius: '8px', border: '1px solid #d1e4f6',
        }}>
          {preview.results.filter((r) => r.status === 'complete').map((r) => (
            <div key={r.method} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontFamily: "'Open Sans', 'Helvetica Neue', Roboto, Arial, sans-serif" }}>
              <StatusIndicator type="success">{r.shortName}</StatusIndicator>
              <span style={{ color: '#5f6b7a', fontVariantNumeric: 'tabular-nums' }}>{r.latencyMs}ms</span>
              {r.estimatedCost != null && (
                <span style={{ color: '#037f0c', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  ~${r.estimatedCost.toFixed(4)}
                </span>
              )}
            </div>
          ))}
          {preview.results.filter((r) => r.status === 'error').map((r) => (
            <div key={r.method} style={{ fontSize: '13px', maxWidth: '300px' }}>
              <StatusIndicator type="error">
                {r.shortName}: {(r.error ?? 'Error').substring(0, 50)}
              </StatusIndicator>
            </div>
          ))}
        </div>
      )}

      {CAPABILITY_CATEGORIES.map((category) => {
        const items = groupedByCategory[category];
        if (items.length === 0) return null;

        const categoryInfo = CATEGORY_INFO[category];
        const categorySelected = items.filter(item => selected.includes(item.capability)).length;

        return (
          <ExpandableSection
            key={category}
            defaultExpanded
            headerText={
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  display: 'inline-block',
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: categoryInfo.color
                }} />
                <Box variant="h3">{categoryInfo.name}</Box>
                <Badge color={categorySelected > 0 ? 'green' : 'grey'}>
                  {categorySelected}/{items.length} selected
                </Badge>
              </div>
            }
            headerDescription={categoryInfo.description}
          >
            <Cards
              cardDefinition={{
                header: (item) => {
                  const info = CAPABILITY_INFO[item.capability];
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box variant="h3">{info?.name ?? item.capability}</Box>
                      <Toggle
                        checked={selected.includes(item.capability)}
                        onChange={({ detail }) => onToggle(item.capability, detail.checked)}
                      />
                    </div>
                  );
                },
                sections: [
                  {
                    id: 'description',
                    content: (item) => {
                      const info = CAPABILITY_INFO[item.capability];
                      return (
                        <Box color="text-body-secondary">
                          {info?.description ?? ''}
                        </Box>
                      );
                    },
                  },
                  {
                    id: 'tags',
                    content: (item) => {
                      const info = CAPABILITY_INFO[item.capability];
                      return (
                        <SpaceBetween size="xs" direction="horizontal">
                          {info?.tags.slice(0, 4).map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                        </SpaceBetween>
                      );
                    },
                  },
                  {
                    id: 'relevance',
                    header: 'Relevance Score',
                    content: (item) => (
                      <ProgressBar
                        value={item.relevance * 100}
                        status="in-progress"
                        resultText={`${Math.round(item.relevance * 100)}%`}
                      />
                    ),
                  },
                  {
                    id: 'preview-results',
                    content: (item) => {
                      if (!preview || isPreviewLoading) return null;
                      if (!selected.includes(item.capability)) return null;
                      return <InlinePreviewResult capId={item.capability} preview={preview} />;
                    },
                  },
                ],
              }}
              items={items}
              cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 2 }, { minWidth: 1000, cards: 3 }]}
            />
          </ExpandableSection>
        );
      })}

      {recommendations.length === 0 && (
        <SpaceBetween size="m" alignItems="center">
          <Box textAlign="center" color="text-body-secondary">
            No recommendations yet. Chat with the assistant to analyze your document.
          </Box>
        </SpaceBetween>
      )}
    </SpaceBetween>
  );
}
