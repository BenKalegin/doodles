# doodles

A versioned diagram-authoring format with compilers from Mermaid (and later PlantUML, BPMN, UML), an auto-layout pipeline that wraps [filigree](https://github.com/BenKalegin/filigree), an SVG renderer, and a CQRS-shaped command/event surface for AI-driven morph animations.

Consumed by:
- [clouddiagram](https://github.com/BenKalegin/clouddiagram) — Konva-based interactive editor.
- [axonize](https://github.com/BenKalegin/axonize) — Electron markdown app, renders Mermaid blocks inline.

## Status

Early. `0.1.0` is a mechanical extract of clouddiagram's parsing + layout pipeline. Public schema, validation, SVG renderer, and morph subsystem land in `0.2.0`+.

See [`docs/`](./docs) for the design plan.

## Packages

| Package | Purpose | License |
|---|---|---|
| `@benkalegin/doodles-core` | Types, validate, migrate | MIT |
| `@benkalegin/doodles-mermaid` | Mermaid parser → Doodle | MIT |
| `@benkalegin/doodles-layout` | Wraps filigree, applies hints | MIT |
| `@benkalegin/doodles-svg` | Doodle → SVG with theme | MIT |
| `@benkalegin/doodles-api` | Single-import facade | MIT |

## Install

```sh
# .npmrc
@benkalegin:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}

# package.json
"@benkalegin/doodles-api": "^0.1.0"
```

## Layout

```
                    apps (clouddiagram, axonize)
                              │
                              ▼
                         @benkalegin/doodles-api      (this repo)
                              │
                              ▼
                       @benkalegin/filigree-api       (separate repo)
```

filigree provides the layout algorithms; doodles owns everything else (parsing, theming, rendering, morphing).
