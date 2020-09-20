# EmptyEpsilon Game State Log viewer

Enable game state logging in [EmptyEpsilon](https://github.com/daid/EmptyEpsilon) by creating a `logs` directory in the directory where you installed EmptyEpsilon (on Windows), or in a relative path (on \*nix), or in the app bundle (on macOS; `EmptyEpsilon/Contents/Resources/logs`).

Run an EmptyEpsilon scenario and a very large JSON file should be present: `game_log_(timestamp).txt`

Open `index.html` in this repo (or https://oznogon.github.io/ee-gsl-viewer/) and drag the game state log onto it, or select it using the "Browse..." button.

You can then view a replay of the scenario, at one second of gameplay per frame of playback.

Demonstration of a scenario being played back in the game state log viewer: https://i.imgur.com/j07hRlx.gif

## Controls

- Start and stop automatic playback by clicking the "Play" button.
- Scrub through the scenario timeline by dragging the slider at the bottom.
- Toggle callsign displays by clicking the "Callsigns" button.
- Zoom with your mouse wheel, by dragging the zoom slider at top right, or by clicking the +/- buttons near the zoom bar.
- Click and drag on the map to scroll.
- Click a ship or station to display stats, such as its shield and hull strength, weapons, etc.
- Click the "Lock" button to lock the view on the selected object, following it during playback or when scrubbing through the timeline. This prevents panning the camera until you unlock, or if you lose the selection (by clicking in empty space, or the selected object being destroyed).

### Keyboard shortcuts

<kbd>=</kbd>, <kbd>-</kbd>: Zoom in and out, respectively. Hold shift to increase the zoom magnitude.

<kbd>space</kbd>: Toggle playback.

<kbd>]</kbd>: Cycle through playback speeds (1x, 2x, 4x, 10x, 20x, 40x).

<kbd>c</kbd>: Toggle callsign display.

<kbd>l</kbd>: Toggle locking the view on the selected object.

<kbd>x</kbd>: Advance and retreat, respectively, through the timeline by 1 second. Hold shift to move by 10 seconds.

<kbd>w</kbd>, <kbd>a</kbd>, <kbd>s</kbd>, <kbd>d</kbd>: Pan the map up, left, down, or right, respectively. The distance panned scales to the current zoom level. Hold shift to pan 10x faster.

## Credits

Based on `logs/index.html` in the EmptyEpsilon repository: https://github.com/daid/EmptyEpsilon/blob/master/logs/index.html
