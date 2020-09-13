# EmptyEpsilon Game State Log viewer

Enable game state logging in [EmptyEpsilon](https://github.com/daid/EmptyEpsilon) by creating a `logs` directory in the directory where you installed EmptyEpsilon (on Windows), or in a relative path (on \*nix), or in the app bundle (on macOS; `EmptyEpsilon/Contents/Resources/logs`).

Run an EmptyEpsilon scenario and a very large JSON file should be present: `game_log_(timestamp).txt`

Open `index.html` in this repo (or https://oznogon.github.io/ee-gsl-viewer/) and drag the game state log onto it, or select it using the "Browse..." button.

You can then view a replay of the scenario, at one second of gameplay per frame of playback.

![Demonstration of a scenario being played back in the game state log viewer](https://i.imgur.com/j07hRlx.png)

- Start and stop automatic playback by clicking the "Play" button.
- Scrub through the scenario timeline by dragging the slider at the bottom.
- Toggle callsign displays by clicking the "Callsigns" button.
- Zoom with your mouse wheel or by dragging the zoom slider at top right.
- Click and drag on the map to scroll.

Based on `logs/index.html` in the EmptyEpsilon repository: https://github.com/daid/EmptyEpsilon/blob/master/logs/index.html
