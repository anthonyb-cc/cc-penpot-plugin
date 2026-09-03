# CC Palette — Penpot plugin

Recomputes a colour ramp from brand seeds and repaints every bound shape, inside
[Penpot](https://penpot.app).

## Install

In Penpot press **Ctrl + Alt + P** and paste:

```
https://anthonyb-cc.github.io/cc-penpot-plugin/manifest.json
```

## What it does

Penpot's own `lighten()` / `darken()` / `mix()` token functions resolve correctly when read
through the API but **cannot be applied to a shape** — the shape paints placeholder grey
and the binding is dropped. So a derived ramp has to be computed outside the token engine.
This plugin does that computation in the file.

| Button | Does |
|---|---|
| **Apply & recompute** | writes the seeds, rebuilds all 40 ramp steps + 4 status surfaces, repaints every bound shape |
| **Repaint bound shapes** | repaint only — use after importing a token file |
| **Check for drift** | reports shapes whose paint disagrees with their token, and any `#B1B2B5` placeholders |

## Expected tokens

It looks for seeds named `color.primary`, `color.secondary`, `color.neutral`,
`color.white`, `color.black`, `color.success`, `color.danger`, `color.warning`,
`color.info`, and writes `color.<palette>-l-1..6` / `-d-1..6` plus `color.<status>-surface`.

## The ramp

Lightness is linear in the seed's own OKLCH lightness — the light end converges on white,
the deep end on an absolute dark surface — and chroma follows a fixed curve as a multiple
of the seed's chroma. Out-of-gamut results are resolved by reducing chroma while holding
lightness and hue, as a browser does for `oklch()`.

## Two Penpot behaviours worth knowing

- **`applyToken` is a toggle.** Applying a token to a property already bound to it REMOVES
  the binding. Repaint a stale bound shape by calling it twice; call it once on a shape
  that has lost its binding.
- **Changing a token's value never repaints bound shapes** — on import or on edit. The
  binding survives, `resolvedValue` updates, the shape keeps its old paint.

## Generated

This repo is generated from the private `framework-penpot` pipeline. Do not hand-edit —
changes here are overwritten on the next publish.
