# Apply appearance before first paint

## Decision

Apply the stored theme, system theme fallback, and stored font stacks synchronously
in the document head. The app stylesheet and JavaScript load later. Waiting for
either to apply a dark theme can flash a light background on reload.

The installable web app manifest and Apple touch icon support adding the app to
the iOS Home Screen. iOS web push requires the installed web app. The browser
favicon uses the app shell's mark and theme colors. The Home Screen icon gives
the same mark a padded, solid tile.

## Consequences

The bootstrap and runtime must agree on the theme identifiers, initial background
colors, and storage format. The theme tests check identifiers and colors. Track
the work to derive the bootstrap from shared sources in
[issue #1](https://github.com/alex-bartleynees/wiki-llm-agents/issues/1).
