/* eslint-env jquery */
/* eslint semi: "error", indent: ["error", 2] */
/* eslint padded-blocks: ["error", "never"] */
/* eslint function-call-argument-newline: ["error", "never"] */
/* eslint max-len: ["warn", { "code": 120 }] */
/* eslint no-extra-parens: ["error", "functions"] */
/* eslint-disable max-classes-per-file, no-console, max-statements, no-underscore-dangle, sort-vars */
/* eslint-disable max-lines, max-lines-per-function, complexity, no-warning-comments, max-params */
/* eslint-disable capitalized-comments, id-length, no-magic-numbers, strict, func-style, no-inline-comments */
/* eslint-disable no-fallthrough */

/*
 * --------------------------------------------------------------------------------------------------------------------
 * Global values.
 * --------------------------------------------------------------------------------------------------------------------
 */

let log,
  canvas;
// Each sector is a 20U (20000) square.
const sectorSize = 20000.0;

/*
 * --------------------------------------------------------------------------------------------------------------------
 * Classes.
 * --------------------------------------------------------------------------------------------------------------------
 */

// Consume and organize EmptyEpsilon game state log data.
class LogData {
  constructor (text) {
    // Delineate text by CRLF line endings.
    const lines = text.match(/^.*(?<id>[\n\r]+|$)/ugm);

    this.entries = [];

    // Parse each line if it's valid, and throw an error if it's not.
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      try {
        if (lines[lineIndex].trim() !== "") {
          this.entries.push(JSON.parse(lines[lineIndex]));
        }
      } catch (err) {
        console.debug(`Read json line error: ${err}`);
      }
    }

    console.debug(`Loaded: ${this.entries.length} log entries`);
  }

  // Get the total scenario runtime from the last entry's timestamp.
  getMaxTime () {
    return this.entries[this.entries.length - 1].time;
  }

  // Get log entries for a given point in the scenario timeline.
  getEntriesAtTime (time) {
    let lastObjects = {};
    const staticObjects = {};

    for (let entryIndex = 0; entryIndex < this.entries.length; entryIndex += 1) {
      const entry = this.entries[entryIndex];

      /*
       * Work from beginning to end, and stop if the entry timestamp is later than the given time.
       * We collect all entries up to the given time, because static objects are only guaranteed to
       * be listed when they're added and might be modified or deleted between the scenario start
       * and the given time, so we need to compare any added or deleted objects to the previous
       * cumulative state.
       */
      if (entry.time > time) {
        break;
      }

      // Collect all objects into the state at the point in time being added to the data.
      lastObjects = entry.objects;

      // Add each static object in the entry to a running list of static objects.
      for (let newStaticIndex = 0; newStaticIndex < entry.new_static.length; newStaticIndex += 1) {
        const object = entry.new_static[newStaticIndex];
        staticObjects[object.id] = object;
      }

      // Delete each static object flagged in the entry from the list of static objects.
      for (let delStaticIndex = 0; delStaticIndex < entry.del_static.length; delStaticIndex += 1) {
        const objectId = entry.del_static[delStaticIndex];
        delete staticObjects[objectId];
      }
    }

    // Update the state of all existing objects using the currently examined entry.
    for (let lastObjectsIndex = 0; lastObjectsIndex < lastObjects.length; lastObjectsIndex += 1) {
      const lastObject = lastObjects[lastObjectsIndex];
      staticObjects[lastObject.id] = lastObject;
    }

    // Return the updated list of static objects.
    return staticObjects;
  }
}

// Create and manage the HTML canvas to visualize game state at a point in time.
class Canvas {
  constructor () {
    // Initialize tracking for throttling zoom/mousewheel events.
    this._zoomThrottle = false;

    // Initialize view locking on selected objects.
    this.isViewLocked = false;

    // Get canvases for background (grid, terrain) and foreground (ships, stations) objects.
    this._backgroundCanvas = $("#canvas-bg");
    this._canvas = $("#canvas-fg");

    // Get the infobox for displaying selected object data.
    this._infobox = $("#infobox");

    // Initialize the currently selected object.
    this._selectedObject = {
      "type": "No selection"
    };

    // Initialize Image objects for rendering sprites.
    this.nebulaImages = [
      new Image(),
      new Image(),
      new Image()
    ];

    for (let i = 0; i < this.nebulaImages.length; i += 1) {
      this.nebulaImages[i].src = `images/Nebula${i + 1}.png`;
    }

    this.wormHoleImages = [
      new Image(),
      new Image(),
      new Image()
    ];

    for (let i = 0; i < this.wormHoleImages.length; i += 1) {
      this.wormHoleImages[i].src = `images/wormHole${i + 1}.png`;
    }

    this.blackHoleImage = new Image();
    this.blackHoleImage.src = "images/blackHole3d.png";

    /*
     * Create the hit canvas for clickable objects. We won't draw this for the user.
     * https://lavrton.com/hit-region-detection-for-html5-canvas-and-how-to-listen-to-click-events-on-canvas-shapes-815034d7e9f8/
     */
    this._hitCanvas = document.createElement("canvas");
    $(this._hitCanvas).attr("id", "canvas-hit");

    // 100px = 20000U, or 1 sector
    const zoomScalePixels = 100.0,
      zoomScaleUnits = sectorSize;

    // Handle canvas mouse events.
    this._canvas.mousedown((event) => this._mouseDown(event));
    this._canvas.mousemove((event) => this._mouseMove(event));
    this._canvas.mouseup((event) => this._mouseUp(event));
    this._canvas.bind("wheel", (event) => {
      // Prevent default scroll behavior in Webkit
      event.preventDefault();
      this._mouseWheel(event);
    });

    // Update canvas on window resize.
    $(window).resize(() => this.update());

    // Initialize view origin, zoom, and options.
    this._view = {
      "x": 0.0,
      "y": 0.0
    };

    /*
     * Initialize target point in world space.
     *
     * this._worldPoint = {
     *   "x": 0.0,
     *   "y": 0.0
     * };
     */

    // Initialize drag delta points.
    this._firstMouse = {
      "x": 0.0,
      "y": 0.0
    };
    this._lastMouse = {
      "x": 0.0,
      "y": 0.0
    };

    // Disable callsigns by default.
    this.showCallsigns = false;

    // Initialize zoom scale at 20U = 100 pixels.
    this._zoomScale = zoomScalePixels / zoomScaleUnits;
    $("#zoom_selector").val(this._zoomScale * 1000.0);

    // Update the initialized canvas.
    this.update();
  }

  // Record cursor coordinates on click and release, for dragging.
  _mouseDown (event) {
    this._firstMouse.x = event.clientX;
    this._firstMouse.y = event.clientY;
    this._lastMouse.x = this._firstMouse.x;
    this._lastMouse.y = this._firstMouse.y;
  }

  // Handle the end of click/drag events.
  _mouseUp (event) {
    // Detect a non-drag click by confirming the mouse didn't move since mousedown.
    if (this._lastMouse.x === this._firstMouse.x && this._lastMouse.y === this._firstMouse.y) {
      // Get mouse position relative to the canvas and check its hit canvas pixel.
      const mousePosition = {
          "x": event.clientX - this._canvas[0].offsetLeft,
          "y": event.clientY - this._canvas[0].offsetTop
        },
        ctxHit = this._hitCanvas.getContext("2d", {"alpha": false}),
        pixel = ctxHit.getImageData(mousePosition.x, mousePosition.y, 1, 1).data,
        // Convert the color to an object ID.
        id = Canvas.rgbToId(pixel[0], pixel[1], pixel[2]),
        // Get the current timeline value from the time selector element.
        time = $("#time_selector").val(),
        // Get the log entry for the given time.
        entry = log.getEntriesAtTime(time);

      this._selectedObject = entry[id];

      // Confirm whether the selection is valid.
      if (Canvas.isSelectionValid(this._selectedObject) === true) {
        // Update the infobox with this object's info for this point in time.
        this.updateSelectionInfobox(time);

        // If view locking is enabled, point the camera at the selected object.
        if (this.isViewLocked === true) {
          this.pointCameraAt(this._selectedObject.position[0], this._selectedObject.position[1]);

          // Update the canvas.
          this.update();
        }
      } else {
        // Otherwise, hide the infobox if there's no selected object.
        this._infobox.hide();
      }
    } else {
      // Otherwise, we're dragging, so update lastMouse.
      this._lastMouse.x = event.clientX;
      this._lastMouse.y = event.clientY;
    }
  }

  // Check whether the given object is defined, and still present and valid.
  static isSelectionValid (selectedObject) {
    // selectedObject can't have a default value. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Default_parameters#Passing_undefined_vs._other_falsy_values
    if (isUndefined(selectedObject) ||
      selectedObject === null) {
      // If the object is undefined or null, it's invalid.
      console.debug(`Object is invalid: ${selectedObject}`);
      return false;
    } else if (selectedObject.id < 1 ||
      selectedObject.type === "No selection") {
      // If the object has an invalid ID or explicitly "No selection", nothing's selected.
      console.debug("No object selected");
      return false;
    }

    // Must be valid otherwise.
    return true;
  }

  // Move the camera to the given world-space coordinates.
  pointCameraAt (positionX, positionY) {
    if (typeof positionX === "number" && typeof positionY === "number") {
      this._view.x = positionX;
      this._view.y = positionY;
    } else {
      console.error(`Invalid position values ${positionX}, ${positionY}`);
    }
  }

  // Zoom camera in (positive zoomFactor), out (negative zoomFactor), or to a given level (zoomValue).
  zoomCamera (zoomFactor = 1, zoomValue = null) {
    // If a valid zoomValue is passed, just go to it.
    if (zoomValue > 0 && zoomValue < 0.15) {
      this._zoomScale = zoomValue;
    } else if (zoomFactor > -3 && zoomFactor < 3) {
      // Otherwise, zoom in or out relative to the existing zoomScale by the given zoomFactor.
      this._zoomScale = Math.max(0.002, Math.min(0.15, this._zoomScale + (zoomFactor * (Math.max(0.001, Math.min(0.1, this._zoomScale * this._zoomScale))))));
    } else {
      console.error("Invalid zoomValue or zoomFactor");
      return;
    }

    // Update the Canvas.
    this.update();

    // Update zoom selector bar value with the new zoom scale.
    $("#zoom_selector").val(this._zoomScale * 1000.0);
  }

  // Update the selected object for the current point in the timeline.
  updateSelection (timeValue = $("#time_selector").val()) {
    const {id} = this._selectedObject,
      entry = log.getEntriesAtTime(timeValue);

    this._selectedObject = entry[id];
  }

  updateSelectionInfobox (timeValue = $("#time_selector").val()) {
    // Clear the infobox and don't bother continuing if the selected object isn't valid.
    if (Canvas.isSelectionValid(this._selectedObject) === false) {
      this._infobox.hide();
      return;
    }

    // Reference the Canvas's selected object.
    const selectedObject = this._selectedObject;

    // Update the selected object for the current time.
    this.updateSelection(timeValue);

    // Populate the infobox with data. TODO: Customize mapping by key type.
    // eslint-disable-next-line one-var
    const infoboxContent = $("#infobox-content"),
      cssFaction = selectedObject.faction.split(" ").join("_") || "no_faction",
      entryMap = new Map([
        [
          "callsign",
          `<span class="ee-faction ee-faction-${cssFaction}">${selectedObject.callsign || "No callsign"} (${selectedObject.faction || "No faction"})</span>`
        ],
        // ["faction", selectedObject.faction || "No faction"],
        [
          "type",
          ""
        ],
        [
          "— Navigation",
          ""
        ],
        [
          "position",
          `${selectedObject.position[0].toFixed(2)}, ${selectedObject.position[1].toFixed(2)}`
        ],
        [
          "heading",
          ""
        ],
        [
          "— Defense",
          ""
        ],
        [
          "hull",
          `${Math.floor(selectedObject.hull)} / ${selectedObject.config.hull} (${((selectedObject.hull / selectedObject.config.hull) * 100.0).toFixed(1)}%)`
        ]
      ]);
    let infoboxContents = "",
      // Rotation at 0.0 points right/east. Adjust it so 0.0 points up/north.
      heading = selectedObject.rotation + 90.0;

    // Normalize the heading to 0-360.
    while (heading >= 360.0) {
      heading -= 360.0;
    }

    // Set the heading in infobox data.
    entryMap.set("heading", heading.toFixed(1));

    // List each shield segment.
    if (Object.prototype.hasOwnProperty.call(selectedObject, "shields")) {
      const {shields} = selectedObject;
      for (let shield = 0; shield < shields.length; shield += 1) {
        const currentShield = selectedObject.shields[shield],
          maxShield = selectedObject.config.shields[shield];

        entryMap.set(`shield ${shield + 1}`, `${Math.floor(currentShield)} / ${maxShield} (${((currentShield / maxShield) * 100.0).toFixed(1)}%)`);
      }
    }

    // List ship missile stocks.
    if (selectedObject.type === "PlayerSpaceship" || selectedObject.type === "CpuShip") {
      if (Object.prototype.hasOwnProperty.call(selectedObject, "missiles")) {
        const currentMissiles = selectedObject.missiles,
          maxMissiles = selectedObject.config.missiles;

        entryMap.set("— Offense", "");
        for (const missileType in currentMissiles) {
          if (Object.prototype.hasOwnProperty.call(currentMissiles, missileType)) {
            const currentMissileCount = currentMissiles[missileType],
              maxMissileCount = maxMissiles[missileType];

            entryMap.set(missileType, `${currentMissileCount} / ${maxMissileCount} (${((currentMissileCount / maxMissileCount) * 100.0).toFixed(1)}%)`);
          }
        }
      }
    }

    // Update type.
    switch (selectedObject.type) {
    case "PlayerSpaceship":
      entryMap.set("type", `${selectedObject.ship_type} (Player)`);
      break;
    case "CpuShip":
      entryMap.set("type", `${selectedObject.ship_type}`);
      break;
    case "SpaceStation":
      entryMap.set("type", `${selectedObject.station_type}`);
      break;
    default:
    }

    // Systems data.
    entryMap.set("— Systems", "");

    switch (selectedObject.type) {
    case "PlayerSpaceship":
      entryMap.set("energy", `${Math.floor(selectedObject.energy_level)}`);
    case "CpuShip":
      const {systems} = selectedObject;

      for (const [systemName, system] of Object.entries(systems)) {
        entryMap.set(systemName, "");

        for (const [stateName, stateValue] of Object.entries(system)) {
          const statePercent = Math.floor(stateValue * 100.0);

          if (stateName === "health") {
            entryMap.set(systemName, `${statePercent}%`);
          } else {
            entryMap.set(`&nbsp;&nbsp;${stateName}`, `${statePercent}%`);
          }
        }
      }
      break;
    default:
    }

    /*
     * Why does this work:
     *
     * console.debug((entry[id].faction).split(" ").join("_"));
     *
     * and this does not:
     *
     * console.debug((entry[id].faction).replace("/ +/_/gu"));
     */

    /*
     * Map all entry keys to values and return them as strings.
     *
     * infoboxKeyValues = jQuery.map(entry[id], (value, key) => {
     *   return `${key}: ${value}`;
     * });
     */

    /*
     * Convert relative mouse position on click to absolute world position.
     *
     * this._worldPoint = {
     *   "x": this._view.x + ((event.clientX - (this._canvas[0].width / 2)) / this._zoomScale),
     *   "y": this._view.y + ((event.clientY - (this._canvas[0].height / 2)) / this._zoomScale)
     * };
     */

    /*
     * console.debug("Hitbox color clicked:", pixel);
     * console.debug("Object ID:", (pixel[0] * 256 * 256) + (pixel[1] * 256) + (pixel[2]));
     * console.debug("Time: ", time);
     * console.debug("Entry: ", entry);
     * console.debug("Object clicked: ", entry[id], id);
     * console.debug("Pixel value: ", pixel);
     */

    // Populate infobox with object info.
    for (const row of entryMap) {
      infoboxContents = infoboxContents.concat(`<tr class="ee-${row[0]}"><td class="ee-table-key">`, row.join("</td><td class=\"ee-table-value\">"), "</td>");
    }

    // Show and populate the infobox.
    this._infobox.show();
    infoboxContent.html(infoboxContents);
  }

  // Move view on mouse drag.
  _mouseMove (event) {
    // Don't do anything unless a button's down.
    if (!event.buttons) {
      return;
    }

    // Translate mouse coordinates to world scale.
    this._view.x += (this._lastMouse.x - event.clientX) / this._zoomScale;
    this._view.y += (this._lastMouse.y - event.clientY) / this._zoomScale;

    // Update mouse position from event.
    this._lastMouse.x = event.clientX;
    this._lastMouse.y = event.clientY;

    // Update the canvas.
    this.update();
  }

  // Zoom view when using the mouse wheel.
  _mouseWheel (event) {
    // Throttle mousewheel zoom to update no more than once every 16.67ms. https://codeburst.io/throttling-and-debouncing-in-javascript-b01cad5c8edf
    if (!this._zoomThrottle) {
      this._zoomThrottle = true;

      setTimeout(() => {
        this._zoomThrottle = false;
      }, 16.67);

      const {wheelDelta} = event.originalEvent,
        {deltaY} = event.originalEvent;
      let delta = 0.0;

      // Cross-browser/platform delta normalization isn't easy: https://stackoverflow.com/questions/5527601/normalizing-mousewheel-speed-across-browsers
      if (wheelDelta) {
        // Chrome Win/Mac | Safari Mac | Opera Win/Mac | Edge
        delta = wheelDelta / 120.0;
      }

      if (deltaY) {
        // Firefox Win/Mac | IE
        if (deltaY > 0.0) {
          delta = -1.0;
        } else {
          delta = 1.0;
        }
      }

      // Modify zoom based on delta.
      this.zoomCamera(delta);
    }
  }

  // Convert an object's unique integer ID to a color code, using components from right to left (blue to red).
  static idToHex (id) {
    return Canvas.rgbToHex(Math.floor((id / 256) / 256), Math.floor(id / 256), id % 256);
  }

  // Convert a hit canvas color code to an integer object ID.
  static rgbToId (red, green, blue) {
    return (red * 256 * 256) + (green * 256) + (blue);
  }

  // Updates the canvas.
  update () {
    // Don't bother doing anything else if we don't have a log to read.
    if (!log) {
      return;
    }

    // If a valid object is selected and view locking is enabled, lock the viewport on it.
    if (Canvas.isSelectionValid(this._selectedObject) === true && this.isViewLocked === true) {
      this.pointCameraAt(this._selectedObject.position[0], this._selectedObject.position[1]);
    }

    // Set the current scenario time to the time selector's current value. (Should start at 0:00)
    const time = $("#time_selector").val(),
      // Scale the canvas to fill the browser window.
      width = document.documentElement.clientWidth,
      height = document.documentElement.clientHeight,
      // Define zoom limits.
      maxZoom = 1.25,
      minZoom = 0.001,
      // Get the canvas' contexts. We'll use these throughout for drawing.
      ctx = this._canvas[0].getContext("2d"),
      ctxBg = this._backgroundCanvas[0].getContext("2d"),
      ctxHit = this._hitCanvas.getContext("2d", {"alpha": false}),
      // For each entry at the given time, determine its type and draw an appropriate shape.
      entries = log.getEntriesAtTime(time),
      // Current position and zoom text bar values.
      stateTextTime = formatTime(time),
      stateTextZoom = `100px = ${(0.1 / this._zoomScale).toPrecision(3)}U`,
      stateTextX = `X: ${this._view.x.toPrecision(6)}`,
      stateTextY = `Y: ${this._view.y.toPrecision(6)}`,
      stateTextSector = `(${Canvas.getSectorDesignation(this._view.x, this._view.y)})`,
      // TODO: Fix out-of-range sector designations in-game.
      stateText = `${stateTextTime} / ${stateTextZoom} / ${stateTextX} / ${stateTextY} ${stateTextSector}`;

    // Set canvas size to document size.
    this._canvas[0].width = width;
    this._canvas[0].height = height;
    this._backgroundCanvas[0].width = width;
    this._backgroundCanvas[0].height = height;
    this._hitCanvas.width = width;
    this._hitCanvas.height = height;

    // Workaround for weird intermittent canvas bug.
    if (isNaN(this._view.x)) {
      console.error("x was undef: ", this._view.x);
      this._view.x = 0;
    }

    if (isNaN(this._view.y)) {
      console.error("y was undef: ", this._view.y);
      this._view.y = 0;
    }

    /*
     * Cap the zoom scales to reasonable levels.
     * maxZoom: 100px = 0.08U
     * minZoom: 100px = 100U
     */
    this._zoomScale = Math.min(maxZoom, Math.max(minZoom, this._zoomScale));

    // Draw the canvas background.
    ctxBg.fillStyle = "#000";
    ctxBg.fillRect(0, 0, width, height);

    // Draw the background grid.
    this.drawGrid(ctxBg, this._view.x, this._view.y, width, height, sectorSize, "#202040");

    for (const id in entries) {
      if (Object.prototype.hasOwnProperty.call(entries, id)) {
        // Extract entry position and rotation values.
        const entry = entries[id],
          // Lock shapes to whole pixels to avoid subpixel antialiasing as much as possible.
          positionX = Math.floor(((entry.position[0] - this._view.x) * this._zoomScale) + (width / 2.0)),
          positionY = Math.floor(((entry.position[1] - this._view.y) * this._zoomScale) + (height / 2.0)),
          {rotation} = entry,
          // Define common alpha values.
          opaque = 1.0,
          halfTransparent = 0.5,
          mostlyTransparent = 0.3,
          nearlyTransparent = 0.1,
          // Define common size values.
          size5U = 300,
          size05U = 30,
          sizeJammer = 4,
          sizeExplosion = 3,
          sizeCollectible = 2,
          sizeBeamHit = 2,
          sizeMin = 2,
          // Initialize RNG variable for nebula images.
          imageRNG = alea(`${entry.id}`);

        if (entry.type === "Nebula") {
          Canvas.drawImage(ctxBg, positionX, positionY, this._zoomScale, halfTransparent, size5U / 2, this.nebulaImages[Math.floor(imageRNG() * 3)], rotation, true);
        } else if (entry.type === "BlackHole") {
          Canvas.drawImage(ctxBg, positionX, positionY, this._zoomScale, opaque, size5U / 2, this.blackHoleImage, rotation, true);
        } else if (entry.type === "WormHole") {
          Canvas.drawImage(ctxBg, positionX, positionY, this._zoomScale, opaque, size5U / 2, this.wormHoleImages[Math.floor(imageRNG() * 3)], rotation, true);
          // Canvas.drawCircle(ctxBg, positionX, positionY, this._zoomScale, "#800080", mostlyTransparent, size5U);
        } else if (entry.type === "Mine") {
          // Draw mine radius.
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#808080", mostlyTransparent, size05U);

          // Draw mine location.
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#FFFFFF", opaque, sizeMin);
        } else if (entry.type === "PlayerSpaceship") {
          // Draw the ship on the foreground canvas, and its hit shape on the hit canvas.
          this.drawShip(ctx, positionX, positionY, entry);
          Canvas.drawRectangle(ctxHit, positionX, positionY, this._zoomScale, Canvas.idToHex(entry.id), 1.0, 8.0, 1.33);
        } else if (entry.type === "CpuShip") {
          // Draw the ship on the foreground canvas, and its hit shape on the hit canvas.
          this.drawShip(ctx, positionX, positionY, entry);
          Canvas.drawRectangle(ctxHit, positionX, positionY, this._zoomScale, Canvas.idToHex(entry.id), 1.0, 8.0, 1.33);
        } else if (entry.type === "WarpJammer") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#C89664", opaque, sizeJammer);
        } else if (entry.type === "SupplyDrop") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#00FFFF", opaque, sizeCollectible);
        } else if (entry.type === "SpaceStation") {
          // Draw the station on the foreground canvas, and its hit shape on the hit canvas.
          this.drawStation(ctx, positionX, positionY, entry);
          Canvas.drawRectangle(ctxHit, positionX, positionY, this._zoomScale, Canvas.idToHex(entry.id), 1.0, 18.0);
        } else if (entry.type === "Asteroid") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#FFC864", opaque, sizeMin);
        } else if (entry.type === "VisualAsteroid") {
          Canvas.drawCircle(ctxBg, positionX, positionY, this._zoomScale, "#FFC864", mostlyTransparent, sizeMin);
        } else if (entry.type === "Artifact") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#FFFFFF", opaque, sizeCollectible);
        } else if (entry.type === "Planet") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#0000AA", opaque, Math.floor(entry.planet_radius / 20));
        } else if (entry.type === "ScanProbe") {
          // Draw probe scan radius.
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#60C080", nearlyTransparent, size5U);

          // Draw probe location.
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#60C080", opaque, sizeMin);
        } else if (entry.type === "Nuke") {
          Canvas.drawShapeWithRotation("delta", ctx, positionX, positionY, this._zoomScale, "#FF4400", opaque, sizeMin, rotation);
        } else if (entry.type === "EMPMissile") {
          Canvas.drawShapeWithRotation("delta", ctx, positionX, positionY, this._zoomScale, "#00FFFF", opaque, sizeMin, rotation);
        } else if (entry.type === "HomingMissile") {
          Canvas.drawShapeWithRotation("delta", ctx, positionX, positionY, this._zoomScale, "#FFAA00", opaque, sizeMin, rotation);
        } else if (entry.type === "HVLI") {
          Canvas.drawShapeWithRotation("delta", ctx, positionX, positionY, this._zoomScale, "#AAAAAA", opaque, sizeMin, rotation);
        } else if (entry.type === "BeamEffect") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#AA6600", halfTransparent, sizeBeamHit);
        } else if (entry.type === "ExplosionEffect") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#FFFF00", halfTransparent, sizeExplosion);
        } else if (entry.type === "ElectricExplosionEffect") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#00FFFF", halfTransparent, sizeExplosion);
        } else {
          // If an object is an unknown type, log a debug message and display it in fuscia.
          console.error(`Unknown object type: ${entry.type}`);
          Canvas.drawSquare(ctx, positionX, positionY, this._zoomScale, "#FF00FF", opaque, sizeMin);
        }
      }
    }

    // Draw the info line showing the scenario time, scale, X/Y coordinates, and sector designation.
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "20px 'Bebas Neue', Impact, Arial, sans-serif";
    ctx.fillText(stateText, 20, 40);

    /*
     * Debug hitCanvas by drawing it.
     *
     * ctx.globalAlpha = 0.5;
     * ctx.drawImage(this._hitCanvas, 0, 0);
     * ctx.globalAlpha = 1.0;
     */
  }

  /*
   * Sectors are designated with a letter (Y axis) and number (X axis). Coordinates 0, 0 represent the intersection of
   * F and 5. Each sector is a 20U (20000) square.
   */
  static getSectorDesignation (positionX, positionY) {
    // TODO: Fix out-of-range sector designations in-game.
    const sectorLetter = String.fromCharCode("F".charCodeAt() + Math.floor(positionY / sectorSize));
    // Sector numbers are 0-99. Sector at 0,0 always ends in 5.
    let sectorNumber = 5 + Math.floor(positionX / sectorSize);

    // If the sector number would be negative, loop it around by 100.
    if (sectorNumber < 0) {
      sectorNumber += 100;
    }

    return `${sectorLetter}${sectorNumber}`;
  }

  static drawGridline (ctx, positionX, positionY, horizontal, lineLength, lineStroke, lineColor) {
    // Define gridline stroke width and color.
    ctx.lineWidth = lineStroke;
    ctx.strokeStyle = lineColor;

    // Draw the line.
    ctx.beginPath();
    ctx.moveTo(positionX, positionY);

    if (horizontal) {
      ctx.lineTo(lineLength, positionY);
    } else {
      ctx.lineTo(positionX, lineLength);
    }

    ctx.closePath();
    ctx.stroke();
  }

  drawGrid (ctx, positionX, positionY, canvasWidth, canvasHeight, gridIntervalSize, gridlineColor) {
    // Translate the visible canvas into world coordinates.
    const canvasEdges = {
        "left": positionX - ((canvasWidth / 2) / this._zoomScale),
        "right": positionX + ((canvasWidth / 2) / this._zoomScale),
        "top": positionY - ((canvasHeight / 2) / this._zoomScale),
        "bottom": positionY + ((canvasHeight / 2) / this._zoomScale)
      },
      // Find the first gridlines from the top left.
      gridlineHorizTop = canvasEdges.top - (canvasEdges.top % gridIntervalSize),
      gridlineVertLeft = canvasEdges.left - (canvasEdges.left % gridIntervalSize),
      gridlineVertWorldList = [],
      gridlineVertCanvasList = [],
      gridlineHorizWorldList = [],
      gridlineHorizCanvasList = [],
      gridlineStrokeSize = 0.5;

    let gridlineHoriz = 0,
      gridlineVert = 0;

    // Draw horizontal gridlines until we run out of canvas.
    for (let gridlineHorizPosition = gridlineHorizTop; gridlineHorizPosition <= canvasEdges.bottom;
      gridlineHorizPosition += gridIntervalSize) {
      // Translate screen position to world position.
      gridlineHoriz = ((gridlineHorizPosition - positionY) * this._zoomScale) + (canvasHeight / 2.0);
      gridlineHorizWorldList.push(gridlineHorizPosition);
      gridlineHorizCanvasList.push(gridlineHoriz);

      // Draw gridline.
      Canvas.drawGridline(ctx, 0, gridlineHoriz, true, canvasWidth, gridlineStrokeSize, gridlineColor);
    }

    // Draw vertical gridlines until we run out of canvas.
    for (let gridlineVertPosition = gridlineVertLeft; gridlineVertPosition < canvasEdges.right;
      gridlineVertPosition += gridIntervalSize) {
      // Translate screen position to world position.
      gridlineVert = ((gridlineVertPosition - positionX) * this._zoomScale) + (canvasWidth / 2.0);
      gridlineVertWorldList.push(gridlineVertPosition);
      gridlineVertCanvasList.push(gridlineVert);

      // Draw gridline.
      Canvas.drawGridline(ctx, gridlineVert, 0, false, canvasHeight, gridlineStrokeSize, gridlineColor);
    }

    // Draw sector designations on the grid, unless the grid is zoomed out far enough.
    ctx.fillStyle = gridlineColor;
    ctx.font = "24px 'Bebas Neue', Impact, Arial, sans-serif";

    if (gridlineHorizCanvasList.length <= 25 && gridlineVertCanvasList.length <= 25) {
      for (let eachGridlineHoriz = 0; eachGridlineHoriz < gridlineHorizCanvasList.length;
        eachGridlineHoriz += 1) {
        for (let eachGridlineVert = 0; eachGridlineVert < gridlineVertCanvasList.length;
          eachGridlineVert += 1) {
          ctx.fillText(Canvas.getSectorDesignation(gridlineVertWorldList[eachGridlineVert], gridlineHorizWorldList[eachGridlineHoriz]), gridlineVertCanvasList[eachGridlineVert] + 16, gridlineHorizCanvasList[eachGridlineHoriz] + 32);
        }
      }
    }
  }

  /*
   * Get a color code for the faction, with specified magnitude for the color mix.
   * Would be nice to use the GM colors directly from factioninfo.lua. Returns a long hex color string (ie. #FF0000).
   */
  static getFactionColor (faction, lowColorMagnitude, highColorMagnitude) {
    let lowColor = `${lowColorMagnitude}`,
      highColor = `${highColorMagnitude}`;

    // Convert short color codes to long codes by doubling the character.
    if (lowColorMagnitude.length === 1) {
      lowColor = `${lowColorMagnitude}${lowColorMagnitude}`;
    }

    if (highColorMagnitude.length === 1) {
      highColor = `${highColorMagnitude}${highColorMagnitude}`;
    }

    /*
     * From factionInfo.lua:
     *
     * neutral:setGMColor(128, 128, 128)
     * human:setGMColor(255, 255, 255)
     * kraylor:setGMColor(255, 0, 0)
     * arlenians:setGMColor(255, 128, 0)
     * exuari:setGMColor(255, 0, 128)
     * GITM:setGMColor(0, 255, 0)
     * Hive:setGMColor(128, 255, 0)
     * TSN:setGMColor(255, 255, 128)
     * USN:setGMColor(255, 128, 255)
     * CUF:setGMColor(128, 255, 255)
     */

    if (faction === "Human Navy") {
      return `#${highColor}${highColor}${highColor}`;
    } else if (faction === "Independent") {
      return `#${lowColor}${lowColor}${lowColor}`;
    } else if (faction === "Kraylor") {
      return `#${highColor}0000`;
    } else if (faction === "Arlenians") {
      return `#${highColor}${lowColor}00`;
    } else if (faction === "Exuari") {
      return `#${highColor}00${lowColor}`;
    } else if (faction === "Ghosts") {
      // GITM in factionInfo.lua
      return `#00${highColor}00`;
    } else if (faction === "Ktlitans") {
      // Hive in factionInfo.lua
      return `#${lowColor}${highColor}00`;
    } else if (faction === "TSN") {
      return `#${highColor}${highColor}${lowColor}`;
    } else if (faction === "USN") {
      return `#${highColor}${lowColor}${highColor}`;
    } else if (faction === "CUF") {
      return `#${lowColor}${highColor}${highColor}`;
    }

    // Everybody else is fuschia.
    console.debug(`Unknown faction: ${faction}`);
    return "#FF00FF";
  }

  // Return an effective minimum size for the square, unless its size modifier is huge.
  static calculateMinimumSize (sizeMultiplier, zoomScale, sizeModifier) {
    const hugeSizeModifier = 50;

    if (sizeModifier < hugeSizeModifier) {
      return Math.max(sizeMultiplier * zoomScale, Math.max(2, sizeModifier));
    }

    return sizeMultiplier * zoomScale;
  }

  // Draw a square that scales with the zoom level.
  static drawRectangle (ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier, ratio = 1.0) {
    // Set an effective minimum size for the shape.
    const squareSize = Canvas.calculateMinimumSize(sizeModifier * 33.3, zoomScale, sizeModifier);

    // Define the shape's appearance.
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;

    // Draw the shape.
    ctx.fillRect(positionX - (ratio * (squareSize / 2)), positionY - (1.0 / ratio * (squareSize / 2)), ratio * squareSize, (1.0 / ratio) * squareSize);

    // Reset global alpha.
    ctx.globalAlpha = 1.0;
  }

  // Draw a square that scales with the zoom level.
  static drawSquare (ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier) {
    // Deprecate for drawRectangle with a 1.0 ratio.
    Canvas.drawRectangle(ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier);
  }

  // Draw a triangle that scales with the zoom level.
  static drawTriangle (ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier) {
    // Set an effective minimum size for the shape.
    const triangleSize = Canvas.calculateMinimumSize(sizeModifier * 33.3, zoomScale, sizeModifier);

    // Define the shape's appearance.
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;

    // Draw the shape.
    ctx.beginPath();
    ctx.moveTo(positionX - (triangleSize / 2), positionY + triangleSize);
    ctx.lineTo(positionX + (triangleSize / 2), positionY);
    ctx.lineTo(positionX - (triangleSize / 2), positionY - triangleSize);
    ctx.fill();

    // Reset global alpha.
    ctx.globalAlpha = 1.0;
  }

  // Draw a delta (notched triangular icon) that scales with the zoom level.
  static drawDelta (ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier) {
    // Set an effective minimum size for the shape.
    const deltaSize = Canvas.calculateMinimumSize(sizeModifier * 33.3, zoomScale, sizeModifier);

    // Define the shape's appearance.
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;

    // Draw the shape.
    ctx.beginPath();
    ctx.moveTo(positionX - (deltaSize / 2), positionY);
    ctx.lineTo(positionX - deltaSize, positionY + (deltaSize / 1.5));
    ctx.lineTo(positionX + deltaSize, positionY);
    ctx.lineTo(positionX - deltaSize, positionY - (deltaSize / 1.5));
    ctx.fill();

    // Reset global alpha.
    ctx.globalAlpha = 1.0;
  }

  // Draw a hexagon that scales with the zoom level.
  static drawHex (ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier) {
    // Set an effective minimum size for the shape.
    const hexSize = Canvas.calculateMinimumSize(sizeModifier * 33.3, zoomScale, sizeModifier) / 2;

    // Define the shape's appearance.
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;

    // Draw the shape.
    ctx.beginPath();
    ctx.moveTo(positionX + (hexSize * Math.cos(0)), positionY + (hexSize * Math.sin(0)));
    for (let side = 0; side < 7; side += 1) {
      ctx.lineTo(positionX + (hexSize * Math.cos(side * 2 * Math.PI / 6)), positionY + (hexSize * Math.sin(side * 2 * Math.PI / 6)));
    }
    ctx.fill();

    // Reset global alpha.
    ctx.globalAlpha = 1.0;
  }

  // Draw a circle that scales with the zoom level.
  static drawCircle (ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier, drawStroke = false, strokeColor = "#FF00FF", strokeSize = 5) {
    // Set an effective minimum size for the shape.
    const circleSize = Canvas.calculateMinimumSize(sizeModifier * 33.3, zoomScale, sizeModifier / 2);

    // Define the shape's appearance.
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;

    // Draw the shape.
    ctx.beginPath();
    ctx.arc(positionX, positionY, circleSize / 2, 0, 2 * Math.PI, false);
    ctx.fill();

    // Draw a stroke around the shape, if enabled.
    if (drawStroke) {
      ctx.lineWidth = Math.min(strokeSize, circleSize / 10);
      ctx.strokeStyle = strokeColor;
      ctx.stroke();
    }

    // Reset global alpha.
    ctx.globalAlpha = 1.0;
  }

  // Convert hex string value to RGB.
  static hexToRgb (hex) {
    const hexStringLength = hex.length;
    let conversion = {},
      codeIsShort = false,
      result = {
        "blue": 0,
        "green": 0,
        "red": 0
      };

    // Detect whether the hex string is short (#FFF) or long (#FFFFFF).
    if (hexStringLength < 3) {
      console.error(`Color hex string ${hex} is invalid.`);
      return result;
    } else if (hexStringLength < 5) {
      codeIsShort = true;
      conversion = (/^#?(?<red>[a-f\d]{1})(?<green>[a-f\d]{1})(?<blue>[a-f\d]{1})$/iu).exec(hex);
    } else if (hexStringLength > 6) {
      codeIsShort = false;
      conversion = (/^#?(?<red>[a-f\d]{2})(?<green>[a-f\d]{2})(?<blue>[a-f\d]{2})$/iu).exec(hex);
    } else {
      console.error(`Color hex string ${hex} is invalid.`);
      return result;
    }

    // Convert hex to int.
    if (codeIsShort) {
      // Double up hex values on short codes.
      result = {
        "blue": `${conversion.groups.blue}${conversion.groups.blue}`,
        "green": `${conversion.groups.green}${conversion.groups.green}`,
        "red": `${conversion.groups.red}${conversion.groups.red}`
      };
    } else {
      result = {
        "blue": conversion.groups.blue,
        "green": conversion.groups.green,
        "red": conversion.groups.red
      };
    }

    // Convert the result.
    result = {
      "blue": parseInt(result.blue, 16),
      "green": parseInt(result.green, 16),
      "red": parseInt(result.red, 16)
    };

    return result;
  }

  // Convert an integer color code component to a hex value.
  static componentToHex (component) {
    const hex = component.toString(16);

    // If the component is a single-digit integer, its hex value needs a leading zero.
    if (hex.length === 1) {
      return `0${hex}`;
    }

    return hex;
  }

  // Convert a RGB color code to a long hex color code.
  static rgbToHex (red, green, blue) {
    return `#${Canvas.componentToHex(red)}${Canvas.componentToHex(green)}${Canvas.componentToHex(blue)}`.toUpperCase();
  }

  // Draw an image that scales with the zoom level.
  static drawImage (ctx, positionX, positionY, zoomScale, fillAlpha, sizeModifier, image, rotation = 0.0, useScreen = false) {
    // Convert degrees to radians.
    const radians = Canvas.degreesToRadians(rotation),
      // Set an effective minimum size for the shape.
      imageSize = Math.max(8, Canvas.calculateMinimumSize(sizeModifier * 100, zoomScale, sizeModifier)),
      origin = {
        "x": positionX - (imageSize / 2),
        "y": positionY - (imageSize / 2)
      };
      // fillColorRGB = Canvas.hexToRgb(fillColor);

    // Save the canvas context state.
    ctx.save();

    // Move the center of the image to the origin.
    ctx.translate(origin.x, origin.y);

    // Rotate the canvas around the origin.
    ctx.rotate(radians);

    // Define the image's appearance.
    ctx.globalAlpha = fillAlpha;
    // ctx.fillStyle = fillColor;

    // Screen the image if we choose to.
    if (useScreen) {
      ctx.globalCompositeOperation = "screen";
    }

    // Draw the image. Must be square; most EE object sprites are anyway.
    ctx.drawImage(image, 0, 0, imageSize, imageSize);

    /*
     * TODO: Blend a rect filled with fillColorRGB to tint the image. This is a requirement for using sprites for
     * faction-specific objects, especially ships and stations.
     *
     * The following doesn't work — it wipes the rest of the canvas rendered before this — and it's unclear why.
     *
     * ```
     * ctx.globalCompositeOperation = "source-in";
     *
     * // Draw the shape.
     * ctx.fillRect(0, 0, imageSize, imageSize);
     * ```
     *
     * Doing the rendering in a separate off-screen canvas didn't help.
     *
     * The alternatives are to rewrite the color of every pixel, which is ridiculously expensive, or to tint the
     * source files in a sprite sheet, which is a lot of work required for every game sprite.
     */

    // Reset global alpha.
    ctx.globalAlpha = 1.0;

    // Restore the saved context state.
    ctx.restore();
  }

  // Draw the object's callsign.
  static drawCallsign (ctx, positionX, positionY, zoomScale, entry, fontSize, lowColor, highColor, textDrift) {
    // Callsign should be off center and to the side of the object.
    const textDriftAmount = Math.max((textDrift * 66.666) * zoomScale, textDrift);

    // Draw the callsign.
    ctx.fillStyle = Canvas.getFactionColor(entry.faction, lowColor, highColor);
    ctx.font = `${fontSize}px 'Bebas Neue', Impact, Arial, sans-serif`;
    ctx.fillText(entry.callsign, positionX + textDriftAmount, positionY + textDriftAmount);
  }

  // Draw a station.
  drawStation (ctx, positionX, positionY, entry, overrideFillColor = "#FF00FF") {
    // Get its faction color.
    const highColorMagnitude = "FF",
      lowColorMagnitude = "55";

    // Draw a shape and scale it by zoom and station type.
    let sizeModifier = 12,
      // Set a default faction color.
      factionColor = overrideFillColor;

    switch (entry.station_type) {
    case "Huge Station":
      sizeModifier = 27;
      break;
    case "Large Station":
      sizeModifier = 21;
      break;
    case "Medium Station":
      sizeModifier = 17;
      break;
    case "Small Station":
      sizeModifier = 12;
      break;
    default:
    }

    // Get the station's faction color, unless we're overriding the fill color.
    if (overrideFillColor === "#FF00FF") {
      factionColor = Canvas.getFactionColor(entry.faction, lowColorMagnitude, highColorMagnitude);
    } else {
      factionColor = overrideFillColor;
    }

    Canvas.drawHex(ctx, positionX, positionY, this._zoomScale, factionColor, 1.0, sizeModifier);

    // Draw the station's callsign, if callsigns are enabled.
    if (this.showCallsigns === true) {
      Canvas.drawCallsign(ctx, positionX, positionY, this._zoomScale, entry, "18", lowColorMagnitude, highColorMagnitude, sizeModifier / Math.PI);
    }
  }

  // Draw a player or CPU ship.
  drawShip (ctx, positionX, positionY, entry, overrideFillColor = "#FF00FF") {
    // Initialize color brightness.
    let highColorMagnitude = "CC",
      lowColorMagnitude = "66",
      // Set a default faction color.
      factionColor = overrideFillColor,
      // Assume we're not drawing on the hit canvas by default.
      drawingOnHitCanvas = false;

    // Use a brighter color for player ships.
    if (entry.type === "PlayerSpaceship") {
      highColorMagnitude = "FF";
      lowColorMagnitude = "80";
    }

    // Get the ship's faction color, unless we're overriding the fill color to draw on the hit canvas.
    if (overrideFillColor === "#FF00FF") {
      factionColor = Canvas.getFactionColor(entry.faction, lowColorMagnitude, highColorMagnitude);
    } else {
      drawingOnHitCanvas = true;
      factionColor = overrideFillColor;
    }

    /*
     * Draw shield arcs if the object has them. #4
     * For each segment in entry.shields.
     *  Divide a circle into equal sized arcs.
     *  Draw each arc at an alpha value relative to its current percentile strength.
     *  Max is in the entry.config.shields array.
     *
     * Draw hull strength bar. #4
     * For entry.hull.
     *  Draw the width at a value relative to its current percentile strength.
     *  Max is in entry.config.hull.
     */

    // Draw beam arcs if the object has them and we're not drawing on the hit canvas.
    if (typeof entry.config !== "undefined" && typeof entry.config.beams !== "undefined" && !drawingOnHitCanvas) {
      for (let beamIndex = 0; beamIndex < entry.config.beams.length; beamIndex += 1) {
        const beam = entry.config.beams[beamIndex],
          arc = entry.rotation + beam.direction,
          range = beam.range * this._zoomScale,
          a1 = (arc - (beam.arc / 2.0)) / 180.0 * Math.PI,
          a2 = (arc + (beam.arc / 2.0)) / 180.0 * Math.PI,
          x1 = positionX + (Math.cos(a1) * range),
          y1 = positionY + (Math.sin(a1) * range),
          x2 = positionX + (Math.cos(a2) * range),
          y2 = positionY + (Math.sin(a2) * range);

        // Draw the arc.
        ctx.beginPath();
        ctx.moveTo(positionX, positionY);
        ctx.lineTo(x1, y1);
        ctx.arc(positionX, positionY, range, a1, a2, false);
        ctx.lineTo(x2, y2);
        ctx.lineTo(positionX, positionY);

        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#FF0000";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1.0;

        // TODO: Draw turret arcs. #15
      }
    }

    // Draw the shape and scale it on zoom.
    Canvas.drawShapeWithRotation("delta", ctx, positionX, positionY, this._zoomScale, factionColor, 1.0, 4, entry.rotation);

    // Draw its callsign. Draw player callsigns brighter.
    if (this.showCallsigns === true) {
      Canvas.drawCallsign(ctx, positionX, positionY, this._zoomScale, entry, "18", lowColorMagnitude, highColorMagnitude, 2);
    }
  }

  // Convert degrees to radians. Used for canvas rotation.
  static degreesToRadians (degrees) {
    return degrees * Math.PI / 180;
  }

  // Rotate a given shape before drawing it.
  static drawShapeWithRotation (shape, ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier, rotation = 0.0) {
    // Convert degrees to radians.
    const radians = Canvas.degreesToRadians(rotation);

    // Save the canvas context state.
    ctx.save();

    // Move the center of the image to the origin.
    ctx.translate(positionX, positionY);

    // Rotate the canvas around the origin.
    ctx.rotate(radians);

    // Draw the given shape, or log that this method doesn't support it.
    switch (shape) {
    case "square":
      Canvas.drawSquare(ctx, 0, 0, zoomScale, fillColor, fillAlpha, sizeModifier);
      break;
    case "circle":
      Canvas.drawCircle(ctx, 0, 0, zoomScale, fillColor, fillAlpha, sizeModifier);
      break;
    case "delta":
      Canvas.drawDelta(ctx, 0, 0, zoomScale, fillColor, fillAlpha, sizeModifier);
      break;
    case "triangle":
      Canvas.drawTriangle(ctx, 0, 0, zoomScale, fillColor, fillAlpha, sizeModifier);
      break;
    default:
      console.error(`Shape ${shape} not supported.`);
    }

    // Restore the saved context state.
    ctx.restore();
  }
}

/*
 * --------------------------------------------------------------------------------------------------------------------
 * Functions.
 * --------------------------------------------------------------------------------------------------------------------
 */
/* eslint-disable prefer-arrow-callback, func-names, no-implicit-globals */

// The hell is wrong with you, javascript? https://www.codereadability.com/how-to-check-for-undefined-in-javascript/
function isUndefined (value) {
  // Obtain "undefined" value that's guaranteed to not have been re-assigned.
  // eslint-disable-next-line no-shadow-restricted-names, no-undefined, no-void, space-unary-ops
  const undefined = void (0);
  // eslint-disable-next-line no-undefined
  return value === undefined;
}

// Load log data, hide the dropzone div, and setup the time selector.
function loadLog (data) {
  log = new LogData(data);

  if (log.entries.length > 0) {
    $("#dropzone").hide();
    $("#time_selector").attr("max", log.getMaxTime());
    canvas.update();
  }
}

// Programmatically advance the time selector.
function autoPlay (isAutoplaying) {
  let timeValue = parseInt($("#time_selector").val(), 10);

  // Advance the timeline by 1 second. TODO: Make adjustible.
  timeValue += 1;
  $("#time_selector").val(timeValue);

  // Update the canvas.
  canvas.update();

  // Update the infobox if there's a selected object. Otherwise, hide it.
  if (typeof canvas._selectedObject !== "undefined" && canvas._selectedObject.type !== "No selection") {
    canvas.updateSelectionInfobox(timeValue);
  } else {
    canvas._infobox.hide();
  }

  // If we reach the end, stop autoplaying.
  if (parseInt($("#time_selector").val(), 10) >= parseInt($("#time_selector").attr("max"), 10)) {
    return !isAutoplaying;
  }

  // Otherwise, keep going.
  return isAutoplaying;
}

// Format scenario time into MM:SS.
function formatTime (time) {
  if (time % 60 < 10) {
    return `${Math.floor(time / 60)}:0${time % 60}`;
  }

  return `${Math.floor(time / 60)}:${time % 60}`;
}

// Main function.
$().ready(function () {
  // Listen from drag and drop events to load log files.
  document.addEventListener("dragover", function (event) {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  document.addEventListener("drop", function (event) {
    event.stopPropagation();
    event.preventDefault();

    const {files} = event.dataTransfer;

    // eslint-disable-next-line no-cond-assign
    for (let fileIndex = 0, file; file = files[fileIndex]; fileIndex += 1) {
      const reader = new FileReader();

      reader.onload = function (event2) {
        loadLog(event2.target.result);
      };

      reader.readAsText(file);
    }
  });

  // Manage interactive file selector.
  const filepicker = document.getElementById("filepicker"),
    // Define options for playbackUpdateInterval.
    playbackUpdateOptions = [
      1000,
      500,
      250,
      100,
      50,
      25
    ];

  // Initialize playback update interval in ms per frame.
  let playbackUpdateInterval = playbackUpdateOptions[2],
    zoomTimeout = 0,
    isAutoplaying = false;

  filepicker.addEventListener("change", function (event) {
    event.stopPropagation();
    event.preventDefault();

    const [file] = filepicker.files,
      reader = new FileReader();

    if (file) {
      reader.onload = function (e2) {
        const contents = e2.target.result;
        loadLog(contents);
      };

      reader.readAsText(file);
    }
  });

  // Initialize canvas.
  canvas = new Canvas();

  // Update the canvas when the time selector is modified.
  $("#time_selector").on("input change", function (/* event */) {
    const timeValue = $("#time_selector").val();

    // Update the canvas.
    canvas.update();

    // Update the infobox if there's a selected object. Otherwise, hide it.
    if (typeof canvas._selectedObject !== "undefined" && canvas._selectedObject.type !== "No selection") {
      canvas.updateSelectionInfobox(timeValue);
    } else {
      canvas._infobox.hide();
    }
  });

  // Zoom bar.
  $("#zoom_selector").on("input change", function (/* event */) {
    canvas._zoomScale = $("#zoom_selector").val() / 1000;
    canvas.update();
  });

  $("#zoom_in").on("touchstart mousedown", function (/* event */) {
    zoomTimeout = setInterval(function () {
      canvas.zoomCamera(1);
      $("#zoom_in").addClass("ee-button-active");
    }, 50);
  }).
    on("click", function (/* event */) {
      canvas.zoomCamera(1);
    }).
    on("mouseup mouseleave touchend", function (/* event */) {
      clearInterval(zoomTimeout);
      $("#zoom_in").removeClass("ee-button-active");
    });

  $("#zoom_out").on("touchstart mousedown", function (/* event */) {
    zoomTimeout = setInterval(function () {
      canvas.zoomCamera(-1);
      $("#zoom_out").addClass("ee-button-active");
    }, 50);
  }).
    on("click", function (/* event */) {
      canvas.zoomCamera(-1);
    }).
    on("mouseup mouseleave touchend", function (/* event */) {
      clearInterval(zoomTimeout);
      $("#zoom_out").removeClass("ee-button-active");
    });

  $("#lock_view").on("click", function (/* event */) {
    // If the view is locked on a valid selected object, toggle the button.
    if (log !== null) {
      canvas.isViewLocked = !canvas.isViewLocked;

      if (canvas.isViewLocked === true) {
        $("#lock_view").addClass("ee-button-active");

        // If a valid object is selected when activating the button, move the camera.
        if (Canvas.isSelectionValid(canvas._selectedObject) === true) {
          canvas.update();
        }
      } else {
        $("#lock_view").removeClass("ee-button-active");
      }
    }
  });

  function resetAutoplay (autoplayLoop) {
    // Clear and reset the autoplay interval to change it.
    clearInterval(autoplayLoop);

    return setInterval(function () {
      if (isAutoplaying === true) {
        isAutoplaying = autoPlay(isAutoplaying);
        $("#autoplay").addClass("ee-button-active");
      } else {
        $("#autoplay").removeClass("ee-button-active");
      }
    }, playbackUpdateInterval);
  }

  // On an interval when autoplay is enabled, increment the time controller.
  // eslint-disable-next-line no-unused-vars, one-var
  let loopAutoplay = 0;
  loopAutoplay = resetAutoplay(loopAutoplay);

  $("#autoplay").on("click", function (/* event */) {
    if (log !== null) {
      // Toggle autoplaying state.
      isAutoplaying = !isAutoplaying;

      // If autoplaying is enabled, activate the button and check if we've reached the end.
      if (isAutoplaying === true) {
        if (parseInt($("#time_selector").val(), 10) >= parseInt($("#time_selector").attr("max"), 10)) {
          $("#time_selector").val(0);
        }
      } else {
        $("#autoplay").removeClass("ee-button-active");
      }
    }
  });

  // Cycle through autoplay speed options.
  $("#autoplay_speed").on("click", function (/* event */) {
    console.debug("playbackUpdateInterval", playbackUpdateInterval);
    console.debug("playbackUpdateOptions", playbackUpdateOptions);
    for (let index = playbackUpdateOptions.length - 1; index >= 0; index -= 1) {
      console.debug("playbackUpdateOptions[index]", playbackUpdateOptions[index]);
      // Loop through options to get the index of our current setting.
      if (playbackUpdateInterval === playbackUpdateOptions[index]) {
        console.debug("playbackUpdateOptions[index + 1]", playbackUpdateOptions[index + 1]);
        if (typeof playbackUpdateOptions[index + 1] === "undefined") {
          if (typeof playbackUpdateOptions[0] === "undefined") {
            console.error("No valid playbackUpdateOptions index");
            return;
          }

          // If we're at the end of options, loop back to the first option.
          [playbackUpdateInterval] = playbackUpdateOptions;
          break;
        } else {
          // Otherwise, use the next update option in the list.
          playbackUpdateInterval = playbackUpdateOptions[index + 1];
          break;
        }
      }
    }

    // If we're in the middle of autoplaying, resume at the new interval.
    loopAutoplay = resetAutoplay(loopAutoplay);

    // Update button text.
    $("#autoplay_speed").text(`${Math.floor(1000 / playbackUpdateInterval)}x`);
  });

  // Track whether to show callsigns.
  $("#callsigns").on("click", function (/* event */) {
    // If a log's loaded, toggle callsigns and update the canvas.
    if (log !== null) {
      canvas.showCallsigns = !canvas.showCallsigns;
      canvas.update();

      // Change the button's activation class if toggled.
      if (canvas.showCallsigns === true) {
        $("#callsigns").addClass("ee-button-active");
      } else {
        $("#callsigns").removeClass("ee-button-active");
      }
    }
  });
});
