import { useMemo } from 'react';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Popover from '@cloudscape-design/components/popover';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import {
  CAPABILITIES,
  CAPABILITY_INFO,
  CAPABILITY_CATEGORIES,
  CATEGORY_INFO,
  METHODS,
  METHOD_INFO,
  getMethodFamily,
  getSupportLevel,
  getUnavailableReason,
  type Capability,
  type ProcessingMethod,
  type SupportLevel,
  type MethodFamily,
} from '@idp/shared';
import { useMethodAvailability } from '../../hooks/useMethodAvailability';
import { token } from '../../theme/tokens';

/**
 * The complete capability × method support matrix — every capability against every
 * method (currently 33 x 29; both counts are read from the catalog, never written here).
 *
 * The catalog previously listed capabilities and methods as two independent lists,
 * so the one question that decides everything ("can THIS method do THIS thing, and
 * how well?") could only be answered by opening a popover per capability. This
 * renders every cell, which also makes the matrix reviewable: gaps and implausible
 * uniform rows are visible at a glance rather than buried.
 *
 * Support is declared per method FAMILY (not per method), so all Claude tiers share
 * a column value. That is stated in the footnote rather than hidden, because it is
 * why e.g. Opus 5 and Haiku show the same level.
 */

const LEVEL_ORDER: Record<SupportLevel, number> = {
  excellent: 3, good: 2, limited: 1, none: 0,
};

/** Glyph + colour per level. Text, not colour alone, carries the meaning. */
function levelStyle(level: SupportLevel | undefined) {
  switch (level) {
    case 'excellent': return { glyph: '●', color: token.textSuccess, title: 'Excellent' };
    case 'good': return { glyph: '◐', color: token.link, title: 'Good' };
    case 'limited': return { glyph: '○', color: token.textSecondary, title: 'Limited' };
    default: return { glyph: '·', color: token.textInactive, title: 'Not supported' };
  }
}

export default function SupportMatrix() {
  const { isUnavailable } = useMethodAvailability();

  /*
   * One column per METHOD — all of them, always.
   *
   * There used to be a family/method toggle, on the theory that dozens of columns of
   * which groups share a value invited false distinctions. That stopped being true
   * once per-method overrides existed (CAPABILITY_SUPPORT_OVERRIDES): tiers within
   * a family genuinely differ now — the frontier GPT-5.6 and Opus tiers return
   * usable bounding boxes where the small tiers do not — so collapsing to one column
   * per family would hide real information. One view, no control to reason about.
   */
  const columns = useMemo(
    () => (METHODS as readonly ProcessingMethod[]).map((m, i, all) => ({
      key: m,
      method: m,
      label: METHOD_INFO[m].shortName,
      family: getMethodFamily(m),
      // First column of a family group, so a separator can be drawn there. Dozens of
      // rotated labels are hard to parse as groups; a hairline per family is not.
      groupStart: i > 0 && getMethodFamily(all[i - 1]) !== getMethodFamily(m),
    })),
    [],
  );

  const supportedCount = useMemo(() => {
    let n = 0;
    for (const c of CAPABILITIES) {
      for (const m of METHODS as readonly ProcessingMethod[]) {
        const lvl = getSupportLevel(m, c as Capability);
        if (lvl && lvl !== 'none') n++;
      }
    }
    return n;
  }, []);

  return (
    <SpaceBetween size="m">
      <Box fontSize="body-s" color="text-body-secondary">
        {`${CAPABILITIES.length} capabilities x ${METHODS.length} methods — `}
        {`${supportedCount} of ${CAPABILITIES.length * METHODS.length} pairs supported`}
      </Box>

      {/* Legend — the glyphs carry meaning, so they must be named. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
        {(['excellent', 'good', 'limited', 'none'] as const).map((lvl) => {
          const s = levelStyle(lvl);
          return (
            <span key={lvl} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: s.color, fontSize: 14 }}>{s.glyph}</span>
              <span style={{ color: token.textSecondary }}>{s.title}</span>
            </span>
          );
        })}
      </div>

      <div style={{ overflowX: 'auto', maxHeight: 620, overflowY: 'auto' }}>
        <table className="idp-matrix">
          <thead>
            <tr>
              <th className="idp-matrix-corner">Capability</th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`idp-matrix-col${col.groupStart ? ' idp-matrix-groupstart' : ''}`}
                  title={`${METHOD_INFO[col.method].name} — ${col.family} family${isUnavailable(col.method) ? ' (not available in this deployment)' : ''}`}
                >
                  {/* Rotated labels keep every column legible without a 3000px table. */}
                  <span className="idp-matrix-collabel">
                    {col.label}
                    {isUnavailable(col.method) && ' ⚠'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITY_CATEGORIES.map((catId) => {
              const caps = CAPABILITIES.filter(
                (c) => CAPABILITY_INFO[c as Capability]?.category === catId,
              );
              if (caps.length === 0) return null;
              return [
                <tr key={`cat-${catId}`} className="idp-matrix-catrow">
                  <th colSpan={columns.length + 1}>{CATEGORY_INFO[catId].name}</th>
                </tr>,
                ...caps.map((capId) => {
                  const cap = CAPABILITY_INFO[capId as Capability];
                  const levels = columns.map((col) => ({
                    col,
                    // Per (method, capability), so a per-method override is visible
                    // rather than being flattened to the family baseline.
                    level: getSupportLevel(col.method, capId as Capability),
                  }));
                  const best = levels.reduce(
                    (acc, l) => Math.max(acc, LEVEL_ORDER[l.level ?? 'none']),
                    0,
                  );
                  const reason = getUnavailableReason(capId as Capability);
                  return (
                    <tr
                      key={capId}
                      className={best === 0 ? 'idp-matrix-unavailable' : undefined}
                    >
                      <th className="idp-matrix-row">
                        <Popover
                          dismissButton={false}
                          /*
                            Opens to the LEFT. `position="right"` pushed the popover
                            across the grid and under the sticky column headers, which
                            is the other half of why the description was unreadable —
                            the z-index fix alone would still have it overlapping every
                            column of glyphs.
                          */
                          position="left"
                          size="medium"
                          triggerType="text"
                          /*
                            Rendered in a portal, or the scroll container clips it.
                            The matrix lives in `overflow: auto` (it has to — every method
                            column plus every capability row can overflow), and an absolutely-positioned child
                            of a scrolling ancestor is clipped at that ancestor's edge.
                            Since the popover opens LEFT from a column pinned to the
                            container's left edge, it opened straight into the clip and
                            lost its first ~40% — the reader saw "…nns, sections," with
                            the beginning of every sentence cut off. No z-index can fix
                            that; only escaping the overflow context does.
                          */
                          renderWithPortal
                          content={
                            <SpaceBetween size="xs">
                              <Box variant="strong">{cap?.name ?? capId}</Box>
                              <Box fontSize="body-s" color="text-body-secondary">
                                {cap?.description}
                              </Box>
                              {/*
                                State WHY, not just that it is unsupported. An empty
                                row of grey dots is indistinguishable from a
                                capability the catalog forgot to rate, so every
                                unrunnable capability names its blocker and what would
                                unblock it.
                              */}
                              {best === 0 && reason && (
                                <>
                                  <StatusIndicator type="stopped">
                                    Not available here
                                  </StatusIndicator>
                                  <Box fontSize="body-s">{reason.summary}</Box>
                                  <Box fontSize="body-s" color="text-body-secondary">
                                    <strong>Would need:</strong> {reason.needs}
                                  </Box>
                                </>
                              )}
                              {best === 0 && !reason && (
                                <StatusIndicator type="stopped">
                                  No processing method performs this
                                </StatusIndicator>
                              )}
                            </SpaceBetween>
                          }
                        >
                          {cap?.name ?? capId}
                        </Popover>
                        {/* A visible marker, so the reason is discoverable without hovering. */}
                        {best === 0 && (
                          <span
                            style={{ marginLeft: 6, color: token.textSecondary, fontSize: 11 }}
                            title={reason?.summary ?? 'No processing method performs this'}
                          >
                            ⓘ
                          </span>
                        )}
                      </th>
                      {levels.map(({ col, level }) => {
                        const s = levelStyle(level);
                        return (
                          <td
                            key={col.key}
                            className={col.groupStart ? 'idp-matrix-groupstart' : undefined}
                            title={`${cap?.name ?? capId} · ${METHOD_INFO[col.method].name}: ${s.title}`}
                            style={{ color: s.color }}
                          >
                            {s.glyph}
                          </td>
                        );
                      })}
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>

      <Box fontSize="body-s" color="text-body-secondary">
        Ratings default to the method <strong>family</strong>, so tiers within a family
        usually share a value — the level describes the approach. Where a specific
        tier genuinely differs it is overridden per model, which is why the frontier
        GPT-5.6 and Opus tiers outrank the small tiers on bounding boxes. Levels
        reflect what this application actually <em>requests</em>: the Textract stage
        runs plain OCR only, so Textract+LLM is rated on an LLM reading OCR text, not
        on Textract&apos;s paid table and form detection. A vertical rule separates
        method families; ⚠ marks a method unavailable in this deployment; ⓘ marks a
        capability nothing here can run — hover it for the blocker and what would fix
        it. Media rows were measured against live Bedrock: every Claude tier rejects
        the Converse video block, so Claude is absent from video.
      </Box>
    </SpaceBetween>
  );
}
