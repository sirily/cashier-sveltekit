# Visual design

## Theme source

The current theme is defined in [cashier-theme-daisy.css](../cashier-theme-daisy.css) and
imported by [src/app.css](../src/app.css). The theme is named `cashier`, is the default,
and declares a dark color scheme.

This document describes the theme source, not a separate set of color requirements.
The CSS definitions are authoritative; update this reference when changing them.

## Main palette

The color names below are retained from the original palette notes. The token names and
values match the current theme.

| Theme role | CSS token | Value | Palette name |
| --- | --- | --- | --- |
| Primary | `--color-primary` | `#076461` | Blue Stone |
| Secondary | `--color-secondary` | `#92140c` | Sangria |
| Accent | `--color-accent` | `#ffd700` | Gold |
| Neutral | `--color-neutral` | `#1d1f20` | Shark |

The old notes called Gold **Tertiary** and Shark **Surface**. In the implemented theme,
Gold is the accent and Shark is the neutral color. Shark is not the `base-100` background.
The HTML browser-theme metadata also uses the primary color `#076461`.

## Backgrounds and text

| Theme role | CSS token | Current value |
| --- | --- | --- |
| Base background | `--color-base-100` | `oklch(22.47% 0 0)` |
| Second base background | `--color-base-200` | `oklch(18.15% 0 0)` |
| Third base background | `--color-base-300` | `oklch(16% 0 0)` |
| Base text | `--color-base-content` | `var(--color-accent-200)` |
| Primary content | `--color-primary-content` | `var(--color-accent-400)` |
| Accent content | `--color-accent-content` | `#000000` |
| Neutral content | `--color-neutral-content` | `var(--color-accent-300)` |

The theme also defines OKLCH shade scales from `50` to `950` for primary, secondary, and
accent colors. Their exact values remain in the stylesheet rather than being duplicated here.

## Status colors

| Role | Color token | Content token |
| --- | --- | --- |
| Info | `--color-neutral` | `--color-neutral-content` |
| Success | `--color-primary-400` | `--color-primary-content` |
| Warning | `--color-accent-400` | `--color-secondary` |
| Error | `--color-secondary-400` | `--color-accent-300` |

These are the token references declared in the theme, not independently verified contrast
or accessibility guarantees.

## Earlier palette notes

The README previously contained `$colour1` through `$colour5` as an informal list, not active
Sass variables. Three entries repeat the primary, secondary, and accent colors above;
`$colour1` repeats the neutral color.

Two additional colors appeared only in those notes and have no definition or use in the
current application/theme source searched during this review:

- `#d0cd94` — tan, previously `$colour2`.
- `#09814a` — Spanish viridian, previously suggested as an alternative to Sangria.

They are historical design references, not active theme colors.

## Source discrepancy

The stylesheet currently declares `--color-secondary-content: --var(--color-secondary)`.
The `--var(...)` expression is not a CSS variable reference, so it must not be documented as
an established secondary text color. This source issue was found during palette verification;
no theme code or replacement color is changed by this documentation update.
