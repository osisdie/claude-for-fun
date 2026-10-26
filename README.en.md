# claude-for-fun

[繁體中文](README.md) · **English**

> Go fishing beside Claude Code: a pane in **classic 16-bit pixel-art RPG** style that moves with what Claude is doing.

![Clearbrook, the default river village theme](docs/screenshots/scene-river-rpg.png)

`fishing` is a Claude Code mod (a hooks-module plugin). It opens a pane beside the conversation with an animated pixel-art scene: a river seen from above, a waterfall, thatched huts, a market stall and an angler sitting on a rock. When Claude starts thinking the angler casts. While a tool runs a fish fights on the line. When Claude needs you a "！" pops up, and when the turn is done the catch is held up high.

## Features

- **A living scene**: flowing water and foam, the waterfall, swaying grass, the float and line, wandering villagers, and a dawn, noon, dusk and night tint from your local time.
- **Follows the session**: thinking, using a tool (a different fish and splash for reading, editing, shell, web and sub-agents), waiting for you, done, error and compacting each have their own animation. See [the table](#states).
- **A HUD bound to real numbers**: the status window shows context left (Focus), cost and turns. It can show tool calls, weekly or 5-hour limits left, or catches instead.
- **Original sounds**: cast, bite, catch, line snap, a waiting chime and a done jingle, all synthesized in code. Off by default; turn it on with `/fishing sound on`.
- **Themeable**: the scene, HUD words, colours, animations and sounds are data (`theme.json`, sprite text files and a map), with no code to touch. `river-rpg` (Clearbrook) is built in; [make your own theme](#make-your-own-theme) with the steps below.
- **Three languages**: 繁體中文, 日本語, English.

## States

| State | When | Scene | Sound | HUD |
| --- | --- | --- | --- | --- |
| `idle` | no turn running | the angler sits, the float drifts; now and then a bite of its own (`r` reels in) | `bite`, `catch` | the message line plays the fishing game |
| `thinking` | a turn starts, or a tool has finished | a cast, the float drifting on the current | `cast` | "Claude is thinking..." |
| `tool` | a tool runs | a fish on the line: read = sweetfish + ripples, edit = trout + splash, shell = char + splash, web = carp, sub-agent = the big one | `bite` (bursts merge) | "Working: editing" |
| `waiting` | a permission prompt, or Claude asks you a question | a blinking "！" over the angler | `waiting` | the command window's frame and cursor flash |
| `done` | the turn ends normally (about 3 s) | a splash, the reel-in, the fish held up | `done` | "Done!", catches +1 |
| `error` | a tool fails, or the turn is interrupted or errs | the line snaps, a little cloud overhead | `snap` | "The line snapped..." |
| `compacting` | `/compact` or auto-compaction | night falls, rain | — | "Tidying up memory..." |

| Thinking | Tool | Waiting |
| --- | --- | --- |
| ![](docs/screenshots/state-thinking.png) | ![](docs/screenshots/state-tool.png) | ![](docs/screenshots/state-waiting.png) |
| **Done** | **Error** | **Compacting** |
| ![](docs/screenshots/state-done.png) | ![](docs/screenshots/state-error.png) | ![](docs/screenshots/state-compacting.png) |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install fishing --marketplace osisdie/claude-for-fun
```

Answer `y` to add the marketplace, then pick the user scope (Enter).

From a shell:

```bash
claude plugin install fishing --marketplace osisdie/claude-for-fun
```

- **A private fork**: the install never prompts for credentials, so let git read GitHub first: `gh auth login`, then `gh auth setup-git` (or use an SSH key).
- **From a local clone**:

  ```bash
  git clone https://github.com/osisdie/claude-for-fun.git ~/projects/claude-for-fun
  claude plugin marketplace add ~/projects/claude-for-fun
  claude plugin install fishing@claude-for-fun
  ```

  A marketplace added from a folder is read from that folder, so after editing it run `/reload-plugins` in Claude Code.
- **Update**: `claude plugin update fishing`, then `/reload-plugins` in Claude Code.
- **Run it from the source** (no install):

  ```bash
  claude --plugin-dir ~/projects/claude-for-fun/plugins/fishing
  # or
  export CLAUDE_CODE_PLUGIN_DIRS=~/projects/claude-for-fun/plugins/fishing
  ```

  `CLAUDE_CODE_PLUGIN_DIRS` can also go in the `"env"` block of `~/.claude/settings.json`. Either way, saving a file reloads the mod.

### Opening the pane

- The pane docks on the right only in the **fullscreen layout**, 110+ columns: type `/tui fullscreen`, or start one run with `CLAUDE_CODE_NO_FLICKER=1`. In the default layout it sits above the prompt as a shorter strip.
- It opens by itself at 144+ columns; otherwise type `/fishing`.

## Platforms

| | Windows + WSL | macOS (not yet verified) |
| --- | --- | --- |
| Terminal | Windows Terminal. A WSL shell often has no `COLORTERM`, so the mod uses the theme's pinned 256 colours. For 24-bit add `export COLORTERM=truecolor` to `~/.bashrc`. | iTerm2 or Ghostty (truecolor) recommended. Terminal.app is 256-colour; `auto` switches to the theme's 256-colour palette. |
| `▀` width | If the picture shears (a CJK font draws `▀` two cells wide): `/fishing pixel full`, or a monospace font with its own block glyphs (Cascadia Mono). | Rare; `/fishing pixel full` works here too. |
| Sound | `auto`: `paplay` through WSLg's PulseAudio on Windows 11 (fastest); without WSLg, `powershell.exe` (Windows' SoundPlayer, about 0.6 s start-up each time). Try it with `/fishing sound test`. | `afplay` (built in). |
| Pane width | Docked right needs the fullscreen layout and 110+ columns; it opens by itself at 144+; else `/fishing`. | Same. |

## Usage

### Keys

Give the pane the keyboard with `ctrl+x tab` (or a click); `Esc` returns to the prompt.

| Key | Does |
| --- | --- |
| `r` | Reel in: during a bite it always lands the fish (a bigger one) |
| `z` | Run the command under ➤ |
| `h` `j` `k` `l` | Move ➤ left, down, up, right |
| `Tab` / arrows, `Enter` | Walk the buttons (➤ follows), press |

The command window: **Cast** (cast again), **Reel**, **Lure** (shorter waits), **Bag** (another rod: bigger fish), **Dex** (your catches), **Setup** (the theme and sound in use).

### Commands

| Command | Does |
| --- | --- |
| `/fishing` | Open the pane (`/fishing close` closes it) |
| `/fishing themes`, `/fishing theme <name>` | List or switch themes; a broken theme is refused, with its errors |
| `/fishing locale <zh-TW\|ja\|en>` | Language |
| `/fishing stats <source,...>` | The 1-4 numbers in the status window (see below) |
| `/fishing sound on\|off\|alerts\|all` | Sound; `alerts` plays only waiting and done |
| `/fishing sound test [event]` | Play one now (`cast`, `bite`, `catch`, `snap`, `waiting`, `done`) |
| `/fishing sound player <name>`, `volume <0-1>`, `quiet <HH:MM-HH:MM\|off>` | Player, volume, quiet hours |
| `/fishing fps <2-8>`, `pixel <half\|full>`, `color <auto\|truecolor\|256>` | Speed, pixel mode, colour mode |
| `/fishing reload`, `/fishing status` | Read the files again; show the state, player and paths |

### The status window's numbers

| Source | Shows | Default label (en) |
| --- | --- | --- |
| `contextLeft` | context window left, % | Focus |
| `cost` | this session's cost (USD) | Cost |
| `turns` | turns this session | Turns |
| `tools` | tool calls this session | Tools |
| `weeklyLeft`, `fiveHourLeft` | weekly / 5-hour usage limit left, % | Week, 5h |
| `catches` | fish caught, all time | Catch |

The figures come from `$.session.usage()` and `session.measure`. A figure the host has not reported shows as `--`. Rename the labels in a theme, or in the profile under `overrides.labels.<locale>.stats`.

### The profile

`~/.claude/fishing/profile.json`; if it is absent, everything is default. The commands above write to it and keep its other fields. Example: [`plugins/fishing/profile.example.json`](plugins/fishing/profile.example.json).

| Field | Default | Meaning |
| --- | --- | --- |
| `theme` | `"river-rpg"` | theme folder name |
| `locale` | `"zh-TW"` | `zh-TW`, `ja`, `en` |
| `stats` | `["contextLeft","cost","turns"]` | the status window's numbers |
| `sound.enabled` | `false` | sound on or off |
| `sound.player` | `"auto"` | `auto`, `afplay`, `paplay`, `aplay`, `powershell`, `engine`, `none` |
| `sound.volume` | `0.6` | 0-1 (`aplay` and `powershell` have no volume control) |
| `sound.quietHours` | `""` | e.g. `"22:00-07:00"` |
| `sound.mute` | `[]` | events never played, e.g. `["bite"]` |
| `sound.alertsOnly` | `false` | play only `waiting` and `done` |
| `sound.minGapMs` | `1500` | least time between two sounds of one event |
| `fps` | `6` | frames a second while active (2-8) |
| `pixelMode` | `"half"` | `half`: two pixels a cell with `▀`; `full`: one pixel a cell, no `▀` |
| `colorMode` | `"auto"` | `auto` reads `COLORTERM`; `truecolor`; `256` |
| `autoOpen` | `true` | open the pane when the session starts (wide terminals) |
| `idleSlowMinutes`, `idleFreezeMinutes` | `5`, `15` | idle minutes before 1 fps, and before drawing stops |
| `utcOffset` | `""` | e.g. `"+08:00"`; empty uses the system zone |
| `overrides.palette` / `window` / `labels` | `{}` | recolour, restyle the windows, rename any label |

## Make your own theme

A theme is a folder, in `~/.claude/fishing/themes/<name>/` (yours, read first) or `plugins/fishing/themes/<name>/` (shipped with the repo).

```
my-theme/
├─ theme.json        palette, map materials, objects, angler, fish, states, sounds, windows, labels in 3 languages
├─ map.txt           the map: one character a tile
├─ sprites/*.txt     sprites: one character a pixel
└─ sounds/*.wav      sounds (optional)
```

**Worked example: an autumn Clearbrook**

1. Copy: `mkdir -p ~/.claude/fishing/themes && cp -r ~/projects/claude-for-fun/plugins/fishing/themes/river-rpg ~/.claude/fishing/themes/autumn`
2. Recolour the `palette` in `theme.json`. Each key is one character; `c256` is the xterm-256 index used without truecolor, and `ascii` is only for text previews:

   ```json
   "g": { "hex": "#b8742c", "c256": 136, "ascii": "\"" },
   "G": { "hex": "#e0a84a", "c256": 179, "ascii": "'" },
   "f": { "hex": "#8c3b1e", "c256": 88,  "ascii": "t" }
   ```

3. Draw a sprite in `sprites/scenery.txt`, with `.` for transparent and `---` between frames:

   ```text
   [tree_autumn]
   ..kkk..
   .kGGgk.
   kGggffk
   .kfffk.
   ..kbk..
   ---
   ..kkk..
   .kGgGk.
   kgGgffk
   .kfffk.
   ..kbk..
   ```

   Then place it in `objects`: `{ "sprite": "tree_autumn", "x": 30, "y": 44, "layer": "objects", "anim": { "kind": "loop", "speed": 8 } }`
4. Change how a state looks in `states`, e.g. rain while compacting, another fish while reading:

   ```json
   "states": {
     "compacting": { "pose": "sit", "phase": "night", "rain": "c" },
     "tool": { "pose": "pull", "kinds": { "read": { "fish": "fish_koi", "effect": "ripple" } } }
   }
   ```

5. Change sounds: put your own `.wav` files in `sounds/` and name them under `"sounds"` (`cast`, `bite`, `catch`, `snap`, `waiting`, `done`), or edit `tools/synth.py` and synthesize them again.
6. Rename things, e.g. `labels.en.location`.
7. Check and preview (needs [Bun](https://bun.sh)):

   ```bash
   cd ~/projects/claude-for-fun
   bun tools/preview.ts --check --dir ~/.claude/fishing/themes
   bun tools/preview.ts autumn --dir ~/.claude/fishing/themes --session waiting
   bun tools/preview.ts autumn --dir ~/.claude/fishing/themes --shot autumn.png --phase evening
   ```

8. In Claude Code: `/fishing theme autumn`.

Themes are checked when they load. `/fishing theme` refuses a broken one and lists the first errors (file, line, field). If the theme a profile names breaks later, the default theme is shown instead, with one line in the transcript saying why. Every `theme.json` field is listed in the [table in the Chinese README](README.md#themejson-欄位). Its names are the same keys you see in the file.

## Sound and WSL

`$.audio.play` uses `afplay` on macOS and stays silent on Linux and Windows terminals. So the mod **runs a player itself** (`$.process.run`) rather than hooking the `audio.play` event. That way every platform behaves the same way, and volume works. The `engine` player keeps `$.audio.play`, for hosts where it does make sound.

- **WSLg (Windows 11)**: `PULSE_SERVER` is set, so `auto` picks `paplay`. If you hear nothing, check that Windows has an output device and try `paplay` on any wav from WSL.
- **Without WSLg**: `auto` picks `powershell.exe`. It hands Windows' SoundPlayer the file's `\\wsl.localhost\...` path, from `wslpath -w`. Each play has about 0.6 s of start-up and no volume control.
- **Plain Linux**: `paplay`, else `aplay`.
- Bursts merge: the same event waits at least `minGapMs`, and any two sounds wait 0.4 s, except that waiting and done are never swallowed.

## Troubleshooting

| Problem | Try |
| --- | --- |
| No pane | `/fishing`; docking on the right needs `/tui fullscreen` and 110+ columns |
| The picture shears or stripes slip | `/fishing pixel full`, or a font with block glyphs |
| Colours look alike | `export COLORTERM=truecolor`, or `/fishing color 256` for the theme's own 256 colours |
| No sound | `/fishing status` names the player; `/fishing sound test`; `/fishing sound player powershell` |
| A theme won't apply | `/fishing status` lists its errors; `bun tools/preview.ts --check --dir <folder>` |
| Numbers show `--` | not reported yet (they arrive with the first response), or no subscription (no limits) |
| Too busy | `/fishing fps 3`; it already slows after 5 idle minutes and stops after 15 |

## Development

```bash
./tools/lay-types.sh                     # lay the API types in .claude-plugin/types/ (git-ignored)
cd plugins/fishing
tsc -p .                                 # type-check
claude plugin validate .                 # manifest and hooks module
claude plugin test .                     # the mod's tests
cd ../.. && claude plugin validate .     # the marketplace
bun test tools/checks                    # shipped themes, originality and commit-message checks
python3 tools/synth.py                   # synthesize the sounds again
tools/screenshots.sh                     # render docs/screenshots/ again
```

## Originality & trademarks

All art, sound and text in this project is original. Every sprite, tile and layout is pixel art drawn from scratch, and every sound is synthesized by `tools/synth.py`. The style is **classic 16-bit pixel-art RPG**. This project has no affiliation with any game or company; any trademarks belong to their respective owners.

## License

MIT, see [LICENSE](LICENSE).
