# Changelog

## 0.2.0

- The scene, HUD and sound follow the Claude session: idle, thinking, tool (by kind), waiting, done, error and compacting, from one state machine fed by the session's hooks.
- The status window shows session figures (context left, cost, turns, tool calls, usage limits left, catches), chosen in the profile.
- Original synthesized sounds per theme, played through `afplay`, `paplay`, `aplay`, PowerShell (WSL) or the engine; off by default, with alerts-only, quiet hours, mutes and debounce.
- A new HUD: windows along the bottom with rounded frames and a title tab, the ➤ cursor, and an original command set and labels in zh-TW, ja and en.
- Screenshots rendered from the mod's own renderer (`tools/screenshots.sh`).

## 0.1.0

- The fishing pane: an animated top-down river village, a window HUD, and the angler's own fishing game.
- Themes as data (`theme.json`, sprite text files, a tile map) with validation and fallback; built-in `river-rpg`.
- A user profile (`~/.claude/fishing/profile.json`) and `/fishing` commands.
- Half-block and full-cell pixel modes, 256-colour palettes, and a frame loop that slows and stops when idle.
