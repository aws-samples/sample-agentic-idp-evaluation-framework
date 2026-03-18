import Cards from '@cloudscape-design/components/cards';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Toggle from '@cloudscape-design/components/toggle';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Badge from '@cloudscape-design/components/badge';
import Spinner from '@cloudscape-design/components/spinner';
import Tabs from '@cloudscape-design/components/tabs';
import type { CapabilityRecommendation, Capability, CapabilityCategory } from '@idp/shared';
import { CAPABILITY_INFO, CAPABILITY_CATEGORIES, CATEGORY_INFO } from '@idp/shared';
import type { PreviewResponse, MethodResult } from '../../hooks/usePreview';

interface CapabilityCardsProps {
  recommendations: CapabilityRecommendation[];
  selected: Capability[];
  onToggle: (capability: Capability, enabled: boolean) => void;
  onRunPreview?: () => void;
  isPreviewLoading?: boolean;
  preview?: PreviewResponse | null;
}

/** Render extraction result for a single capability from a method */
function ExtractionResult({ result, capId }: { result: MethodResult; capId: string }) {
  if (result.error) return <Box color="text-status-error" fontSize="body-s">{result.error}</Box>;

  // Try to find capability-specific data in results
  const data = result.results as Record<string, unknown>;
  const extractions = (data?.extractions ?? data) as Record<string, unknown>;
  const capData = extractions?.[capId] as Record<string, unknown> | undefined;

  if (!capData && !data?.raw) {
    return <Box color="text-body-secondary" fontSize="body-s">No data extracted</Box>;
  }

  const content = capData?.data ?? capData ?? data?.raw ?? '';
  const displayText = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  return (
    <pre style={{
      fontSize: '12px', lineHeight: 1.4, margin: 0,
      maxHeight: '200px', overflow: 'auto',
      background: '#f8f9fa', padding: '8px', borderRadius: '4px',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      {displayText.substring(0, 2000)}
    </pre>
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
  // Group recommendations by category
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
            <SpaceBetween direction="horizontal" size="xs">
              {isPreviewLoading && <Spinner />}
              <Button
                variant={preview ? 'normal' : 'primary'}
                onClick={onRunPreview}
                loading={isPreviewLoading}
                iconName="play"
              >
                {preview ? 'Re-run Preview' : `Run Preview (${selected.length})`}
              </Button>
            </SpaceBetween>
          ) : undefined
        }
      >
        Recommended Capabilities
      </Header>

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
                    id: 'rationale',
                    header: 'Rationale',
                    content: (item) => (
                      <Box variant="small" color="text-body-secondary">
                        {item.rationale}
                      </Box>
                    ),
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
