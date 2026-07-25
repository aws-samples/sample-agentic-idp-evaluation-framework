/**
 * Cloudscape design tokens, re-exported under short names.
 *
 * Import these instead of writing CSS variables by hand. Cloudscape SUFFIXES its
 * custom-property names with a build hash — the real variable is
 * `--color-border-divider-default-nr68jt`, not `--color-border-divider-default`.
 * So a hand-written `var(--color-border-divider-default, #e9ebed)` never resolves
 * and silently falls through to the literal fallback, which means it stays light
 * in dark mode: exactly the bug the fallback looked like it was preventing.
 *
 * Importing from the package keeps the hash correct and lets the value flip with
 * `applyMode()`.
 */
import {
  colorBackgroundContainerContent,
  colorBackgroundDropdownItemDefault,
  colorBackgroundDropdownItemHover,
  colorBackgroundInputDisabled,
  colorBackgroundItemSelected,
  colorBackgroundLayoutMain,
  colorBackgroundStatusInfo,
  colorBorderDividerDefault,
  colorBorderDividerSecondary,
  colorBorderItemSelected,
  colorTextBodyDefault,
  colorTextBodySecondary,
  colorTextStatusError,
  colorTextStatusInactive,
  colorTextStatusSuccess,
  colorTextLinkDefault,
  fontFamilyMonospace,
  borderRadiusItem,
} from '@cloudscape-design/design-tokens';

export const token = {
  /** Page/container surfaces. */
  surface: colorBackgroundContainerContent,
  surfaceMuted: colorBackgroundDropdownItemHover,
  surfaceRaised: colorBackgroundDropdownItemDefault,
  surfaceDisabled: colorBackgroundInputDisabled,
  surfaceLayout: colorBackgroundLayoutMain,
  surfaceInfo: colorBackgroundStatusInfo,
  surfaceSelected: colorBackgroundItemSelected,

  /** Text. */
  text: colorTextBodyDefault,
  textSecondary: colorTextBodySecondary,
  textInactive: colorTextStatusInactive,
  textSuccess: colorTextStatusSuccess,
  textError: colorTextStatusError,
  link: colorTextLinkDefault,

  /** Lines. */
  border: colorBorderDividerDefault,
  borderSubtle: colorBorderDividerSecondary,
  borderSelected: colorBorderItemSelected,

  /** Type + shape. */
  fontMono: fontFamilyMonospace,
  radius: borderRadiusItem,
} as const;
