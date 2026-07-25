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
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { CapabilityRecommendation, Capability, CapabilityCategory } from '@idp/shared';
import { CAPABILITY_INFO, CAPABILITY_CATEGORIES, CATEGORY_INFO, isModelBackedCapability } from '@idp/shared';
import type { PreviewResponse, MethodResult, CapabilityResult } from '../../hooks/usePreview';
import ExtractionView from '../common/ExtractionView';
import { token } from '../../theme/tokens';

interface CapabilityCardsProps {
  recommendations: CapabilityRecommendation[];
  selected: Capability[];
  onToggle: (capability: Capability, enabled: boolean) => void;
  onRunPreview?: () => void;
  isPreviewLoading?: boolean;
  preview?: PreviewResponse | null;
}

function InlinePreviewResult({
  capId,
  preview,
  isStreaming,
}: {
  capId: string;
  preview: PreviewResponse;
  isStreaming: boolean;
}) {
  const methodResults = preview.results.filter((r) => r.status === 'complete');
  const pendingCount = preview.methods.length - preview.results.length;

  // Nothing has come back yet: say so explicitly. This branch previously rendered
  // null, so a card that had requested a preview looked identical to one that had
  // not — no spinner, no "waiting", just an empty card for up to a minute.
  if (methodResults.length === 0) {
    return (
      <div style={{ marginTop: 8, borderTop: `1px solid ${token.borderSubtle}`, paddingTop: 8 }}>
        <Box color="text-body-secondary" fontSize="body-s">
          {isStreaming
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Spinner size="normal" />
                Extracting… waiting on {pendingCount} method{pendingCount === 1 ? '' : 's'}
              </span>
            : 'No method returned a result for this capability.'}
        </Box>
      </div>
    );
  }

  const tabs = methodResults.map((r) => {
    const capResult = r.results[capId] as CapabilityResult | undefined;
    const hasData = capResult && capResult.data != null;

    return {
      id: r.method,
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {r.shortName}
          {hasData ? (
            <span style={{ color: token.textSuccess, fontSize: '11px' }}>
              {capResult.confidence != null ? `${Math.round(capResult.confidence * 100)}%` : ''}
            </span>
          ) : (
            <span style={{ color: token.textInactive, fontSize: '11px' }}>N/A</span>
          )}
        </span>
      ) as unknown as string,
      content: hasData ? (
        // ExtractionView renders the natural form of the payload (a real table for
        // an HTML table) with the exact source one click away. Previously an HTML
        // table was dropped into a 200px box and everything else into a <pre>, so
        // a table extraction appeared as raw "```yaml / <thead> / <tr> / <th>"
        // markup — the single worst thing to be unreadable, since it is the result
        // the whole comparison exists to show.
        <div style={{ padding: '4px 0' }}>
          <ExtractionView data={capResult.data} format={capResult.format} />
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
      borderTop: `1px solid ${token.borderSubtle}`,
      paddingTop: '8px',
    }}>
      <Tabs tabs={tabs} />
      {isStreaming && pendingCount > 0 && (
        <Box color="text-body-secondary" fontSize="body-s" padding={{ top: 'xs' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Spinner size="normal" />
            {pendingCount} more method{pendingCount === 1 ? '' : 's'} still running
          </span>
        </Box>
      )}
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
              {isPreviewLoading ? 'Running Preview...' : preview ? 'Re-run Preview' : `Run Preview (${selected.length})`}
            </Button>
          ) : undefined
        }
      >
        Recommended Capabilities
      </Header>

      {/*
        The per-method summary bar that used to sit here has been removed.
        PreviewProgress (rendered directly above this component) already lists every
        method with its latency and status, so this repeated the same chip list a
        second time on one screen — and repeated each failure message truncated to
        50 characters, which is where the nine identical
        "…exceeded the 60s preview limit and w" fragments came from.
      */}

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
                  // Preprocessing capabilities (PDF conversion, format
                  // standardization) are performed in code before extraction,
                  // not by a model. Selecting one used to add it to every LLM
                  // prompt, where it asked for output that cannot exist. Label
                  // it and leave the toggle off rather than pretending it is a
                  // model choice.
                  const isPreprocessing = !isModelBackedCapability(item.capability);
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <Box variant="h3">{info?.name ?? item.capability}</Box>
                      {isPreprocessing ? (
                        <Badge color="grey">Preprocessing</Badge>
                      ) : (
                        <Toggle
                          checked={selected.includes(item.capability)}
                          onChange={({ detail }) => onToggle(item.capability, detail.checked)}
                        />
                      )}
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
                    content: (item) => {
                      // Rounded before it reaches the bar. Cloudscape renders the
                      // raw `value` as the visible label, so `0.55 * 100` printed
                      // "55.00000000000001%" on the card.
                      const pct = Math.round(item.relevance * 100);
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Box variant="awsui-key-label">Relevance</Box>
                          {/* A slim bar rather than a full ProgressBar per card:
                              with 6+ cards on screen the stacked bars dominated
                              the layout while carrying one number each. */}
                          <div
                            style={{
                              flex: 1, height: 4, borderRadius: 2,
                              background: token.borderSubtle, overflow: 'hidden',
                            }}
                            role="img"
                            aria-label={`Relevance ${pct} percent`}
                          >
                            <div style={{
                              width: `${pct}%`, height: '100%',
                              background: token.borderSelected,
                            }} />
                          </div>
                          <Box fontSize="body-s" color="text-body-secondary">{pct}%</Box>
                        </div>
                      );
                    },
                  },
                  {
                    id: 'preview-results',
                    content: (item) => {
                      if (!preview) return null;
                      if (!selected.includes(item.capability)) return null;
                      // Render whatever has arrived, rather than waiting for the
                      // whole fan-out: `isPreviewLoading` used to hide ALL results
                      // until every method finished, so a run where one model
                      // answered in 7s showed nothing for another 40s.
                      return (
                        <InlinePreviewResult
                          capId={item.capability}
                          preview={preview}
                          isStreaming={!!isPreviewLoading}
                        />
                      );
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
