# Brand TTFs — for the card renderer only

These four files exist for **Satori** (`/api/card`, `opengraph-image`), which renders the images
the bot posts to X and Telegram. Satori reads TTF/OTF/WOFF and **cannot decode woff2**, so the
`../*.woff2` set the browser uses is unusable here. Same families, same weights, different
container.

| file | family | weight |
|---|---|---|
| `SpaceGrotesk-400.ttf` | Space Grotesk | 400 |
| `SpaceGrotesk-700.ttf` | Space Grotesk | 700 |
| `PlusJakartaSans-400.ttf` | Plus Jakarta Sans | 400 |
| `PlusJakartaSans-800.ttf` | Plus Jakarta Sans | 800 |

Latin subset, as served by Google Fonts. Do not point the browser at these: the site loads woff2
via `src/app/fonts.css`, which is a third the size over the wire.

`next.config.ts` traces this directory into the `/api/card` function bundle. If that entry is ever
removed, the route falls back to a self-origin fetch and then to Satori's default face, and the
cards go out looking generic without anything failing loudly.

## Licence

Both families are licensed under the **SIL Open Font License 1.1**, which permits bundling and
redistribution with the reserved-name and same-licence conditions intact.

- Space Grotesk — © Florian Karsten, now maintained by the Space Grotesk project.
  <https://github.com/floriankarsten/space-grotesk> · OFL-1.1
- Plus Jakarta Sans — © Tokotype.
  <https://github.com/tokotype/PlusJakartaSans> · OFL-1.1

Full licence text ships with each upstream project at the links above.
