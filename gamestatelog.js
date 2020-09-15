/* eslint-env jquery */
/* eslint semi: "error", indent: ["error", 2] */
/* eslint no-magic-numbers: ["error", { "ignoreArrayIndexes": true }] */
/* eslint no-magic-numbers: ["error", { "ignore": [0, 1] }] */
/* eslint padded-blocks: ["error", "never"] */
/* eslint function-call-argument-newline: ["error", "never"] */
/* eslint max-len: ["warn", { "code": 120 }] */
/* eslint no-extra-parens: ["error", "functions"] */
/* eslint-disable max-classes-per-file, no-console, max-statements, no-underscore-dangle, sort-vars */
/* eslint-disable max-lines, max-lines-per-function, complexity, no-warning-comments, max-params */
/* eslint-disable capitalized-comments, id-length */

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
        console.debug("Read json line error: ", err);
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
    // Initialize accumulated delta from wheel events.
    this._mousewheelAccumulated = 0.0;
    // Get canvases for background (grid, terrain) and foreground (ships, stations) objects.
    this._backgroundCanvas = $("#canvas-bg");
    this._canvas = $("#canvas-fg");
    this._infobox = $("#infobox");

    /*
     * Create hit canvas for clickable objects. We won't draw this for the user.
     * https://lavrton.com/hit-region-detection-for-html5-canvas-and-how-to-listen-to-click-events-on-canvas-shapes-815034d7e9f8/
     */
    this._hitCanvas = document.createElement("canvas");

    // 100px = 20000U, or 1 sector
    const zoomScalePixels = 100.0,
      zoomScaleUnits = sectorSize;

    // Handle canvas mouse events.
    this._canvas.mousedown((event) => this._mouseDown(event));
    this._canvas.mousemove((event) => this._mouseMove(event));
    this._canvas.mouseup((event) => this._mouseUp(event));
    this._canvas.bind("wheel", (event) => {
      event.stopPropagation();
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
    // Initialize zoom scale at 20U = 100 pixels.
    this._zoomScale = zoomScalePixels / zoomScaleUnits;
    this.showCallsigns = false;

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

  _mouseUp (event) {
    // Detect a non-drag click by confirming the mouse didn't move since mousedown.
    if (this._lastMouse.x === this._firstMouse.x && this._lastMouse.y === this._firstMouse.y) {
      // Get mouse position relative to the canvas and check its hit canvas pixel.
      const mousePosition = {
          "x": event.clientX - this._canvas[0].offsetLeft,
          "y": event.clientY - this._canvas[0].offsetTop
        },
        ctxHit = this._hitCanvas.getContext("2d"),
        pixel = ctxHit.getImageData(mousePosition.x, mousePosition.y, 1, 1).data,
        // Convert the color to an object ID.
        id = Canvas.rgbToId(pixel[0], pixel[1], pixel[2]),
        time = $("#time_selector").val(),
        entry = log.getEntriesAtTime(time);

      // Bail if the ID isn't real, because we probably haven't clicked anything.
      if (id < 1) {
        this._infobox.hide();
        return;
      }

      /*
       * Convert relative mouse position on click to absolute world position.
       *
       * this._worldPoint = {
       *   "x": this._view.x + ((event.clientX - (this._canvas[0].width / 2)) / this._zoomScale),
       *   "y": this._view.y + ((event.clientY - (this._canvas[0].height / 2)) / this._zoomScale)
       * };
       */

      /*
       * Select the object if one matches from the hit canvas.
       *
       * console.debug("Hitbox color clicked:", pixel);
       * console.debug("Object ID:", (pixel[0] * 256 * 256) + (pixel[1] * 256) + (pixel[2]));
       * console.debug("Time: ", time);
       * console.debug("Entry: ", entry);
       * console.debug("Object by array index: ", entry[id]);
       */
      console.debug("Object clicked: ", entry[id]);
      this._infobox.show();
      const arr = jQuery.map(entry[id], function (value, key) {
        if (key !== "config") {
          return `${key}: ${value}`;
        }
      });
      this._infobox.html(arr.join("<br>"));
      //this._infobox.html("<p>" + entry[id].type + "<br>" + entry[id].type + "</p>");
    } else {
      // Otherwise, we're dragging, so update lastMouse.
      this._lastMouse.x = event.clientX;
      this._lastMouse.y = event.clientY;
    }
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
    const delta = -event.originalEvent.deltaY,
      minimumDelta = -100.0,
      maximumDelta = 100.0,
      updateThreshold = 100.0,
      zoomScaleDivisor = 1000.0,
      // Cap delta to avoid impossible zoom scales.
      boundedDelta = Math.max(minimumDelta, Math.min(maximumDelta, delta));

    /*
     * Mousewheel performance is bad with devices that generate a ton of events.
     * Update only when we accumulate enough delta.
     */
    this._mousewheelAccumulated += Math.abs(boundedDelta);

    // Update the canvas if the accumulated delta's enough.
    if (this._mousewheelAccumulated > updateThreshold) {
      // Scale delta input value to zoom scale value.
      this._zoomScale *= 1.0 + (boundedDelta / zoomScaleDivisor);

      // Update zoom selector bar value with the new zoom scale.
      $("#zoom_selector").val(this._zoomScale * zoomScaleDivisor);

      // Update the canvas.
      this.update();

      // Reset the accumulated mousewheel value.
      this._mousewheelAccumulated = 0.0;
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
      ctxHit = this._hitCanvas.getContext("2d"),
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
          positionX = ((entry.position[0] - this._view.x) * this._zoomScale) + (width / 2.0),
          positionY = ((entry.position[1] - this._view.y) * this._zoomScale) + (height / 2.0),
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
          // Initialize an Image object for rendering sprites.
          objectImage = new Image();
        // Initialize RNG variable for nebula images.
        let nebulaRNG = 0.0,
          // Initialize ID color code. Codes with any red value but 00 in the green component won't be calculated.
          idToHex = "#FF00FF";

        if (entry.type === "Nebula") {
          nebulaRNG = alea(`${entry.id}`);
          objectImage.src = `images/Nebula${Math.floor((nebulaRNG() * 3) + 1)}.png`;
          Canvas.drawImage(ctxBg, positionX, positionY, this._zoomScale, halfTransparent, size5U / 2, objectImage, rotation, true);
        } else if (entry.type === "BlackHole") {
          objectImage.src = "images/blackHole3d.png";
          Canvas.drawImage(ctxBg, positionX, positionY, this._zoomScale, opaque, size5U / 2, objectImage, rotation, true);
        } else if (entry.type === "WormHole") {
          Canvas.drawCircle(ctxBg, positionX, positionY, this._zoomScale, "#800080", mostlyTransparent, size5U);
        } else if (entry.type === "Mine") {
          // Draw mine radius.
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#808080", mostlyTransparent, size05U);

          // Draw mine location.
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#FFFFFF", opaque, sizeMin);
        } else if (entry.type === "PlayerSpaceship") {
          // Draw the ship on the foreground canvas, and its hit shape on the hit canvas.
          this.drawShip(ctx, positionX, positionY, entry);
          this.drawShip(ctxHit, positionX, positionY, entry, Canvas.idToHex(entry.id));
        } else if (entry.type === "CpuShip") {
          // Draw the ship on the foreground canvas, and its hit shape on the hit canvas.
          this.drawShip(ctx, positionX, positionY, entry);
          this.drawShip(ctxHit, positionX, positionY, entry, Canvas.idToHex(entry.id));
        } else if (entry.type === "WarpJammer") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#C89664", opaque, sizeJammer);
        } else if (entry.type === "SupplyDrop") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#00FFFF", opaque, sizeCollectible);
        } else if (entry.type === "SpaceStation") {
          // Draw the station on the foreground canvas, and its hit shape on the hit canvas.
          this.drawStation(ctx, positionX, positionY, entry);
          this.drawStation(ctxHit, positionX, positionY, entry, Canvas.idToHex(entry.id));
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
          console.debug("Unknown object type: ", entry.type);
          Canvas.drawSquare(ctx, positionX, positionY, this._zoomScale, "#FF00FF", opaque, sizeMin);
        }
      }
    }

    // Draw the info line showing the scenario time, scale, X/Y coordinates, and sector designation.
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "20px 'Bebas Neue Regular', Impact, Arial, sans-serif";
    ctx.fillText(stateText, 20, 40);

    // Debug hitCanvas by drawing it.
    // ctx.drawImage(this._hitCanvas, 0, 0);
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
    ctx.font = "24px 'Bebas Neue Regular', Impact, Arial, sans-serif";

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
  static drawSquare (ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier) {
    // Set an effective minimum size for the shape.
    const squareSize = Canvas.calculateMinimumSize(sizeModifier * 33.3, zoomScale, sizeModifier);

    // Define the shape's appearance.
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;

    // Draw the shape.
    ctx.fillRect(positionX - (squareSize / 2), positionY - (squareSize / 2), squareSize, squareSize);

    // Reset global alpha.
    ctx.globalAlpha = 1.0;
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
    ctx.moveTo(positionX + hexSize * Math.cos(0), positionY + hexSize * Math.sin(0));
    for (let side = 0; side < 7; side += 1) {
      ctx.lineTo(positionX + hexSize * Math.cos(side * 2 * Math.PI / 6), positionY + hexSize * Math.sin(side * 2 * Math.PI / 6));
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
    ctx.font = `${fontSize}px 'Bebas Neue Regular', Impact, Arial, sans-serif`;
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

    if (entry.station_type === "Huge Station") {
      sizeModifier = 27;
    } else if (entry.station_type === "Large Station") {
      sizeModifier = 21;
    } else if (entry.station_type === "Medium Station") {
      sizeModifier = 17;
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

    // Draw shield arcs if the object has them.
    // For each segment in entry.shields.
    //  Divide a circle into equal sized arcs.
    //  Draw each arc at an alpha value relative to its current percentile strength.
    //  Max is in the entry.config.shields array.

    // Draw hull strength bar.
    // For entry.hull.
    //  Draw the width at a value relative to its current percentile strength.
    //  Max is in entry.config.hull.

    // Draw beam arcs if the object has them and we're nt drawing on the hit canvas.
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
    if (shape === "square") {
      Canvas.drawSquare(ctx, 0, 0, zoomScale, fillColor, fillAlpha, sizeModifier);
    } else if (shape === "circle") {
      Canvas.drawCircle(ctx, 0, 0, zoomScale, fillColor, fillAlpha, sizeModifier);
    } else if (shape === "delta") {
      Canvas.drawDelta(ctx, 0, 0, zoomScale, fillColor, fillAlpha, sizeModifier);
    } else if (shape === "triangle") {
      Canvas.drawTriangle(ctx, 0, 0, zoomScale, fillColor, fillAlpha, sizeModifier);
    } else {
      console.log(`Shape ${shape} not supported`);
    }

    // Restore the saved context state.
    ctx.restore();
  }
}

/*
 * --------------------------------------------------------------------------------------------------------------------
 * Classes.
 * --------------------------------------------------------------------------------------------------------------------
 */

// Load log data, hide the dropzone div, and setup the time selector.
function loadLog (data) {
  log = new LogData(data);

  if (log.entries.length > 0) {
    $("#dropzone").hide();
    console.debug(log.getMaxTime());
    $("#time_selector").attr("max", log.getMaxTime());
    canvas.update();
  }
}

// Programmatically advance the time selector.
function autoPlay (isAutoplaying) {
  let timeValue = parseInt($("#time_selector").val());
  timeValue += 1;
  $("#time_selector").val(timeValue);
  canvas.update();

  // If we reach the end, stop autoplaying.
  if (parseInt($("#time_selector").val()) >= parseInt($("#time_selector").attr("max"))) {
    return !isAutoplaying;
  }

  // Otherwise, keep going.
  return isAutoplaying;
}

// Format scenario time into MM:SS.
function formatTime (time) {
  if (time % 60 < 10) {
    return Math.floor(time / 60) + ":0" + (time % 60);
  }
  return Math.floor(time / 60) + ":" + (time % 60);
}

// Main function.
$().ready(function() {
  /*
   * Listen from drag and drop events to load log files.
   * TODO: Add file picker option for browser/OS combos that
   * complicate drag-and-drop.
   */
  document.addEventListener("dragover", function(event) {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  document.addEventListener("drop", function(event) {
    event.stopPropagation();
    event.preventDefault();

    const files = event.dataTransfer.files;

    // eslint-disable-next-line no-cond-assign
    for (var fileIndex = 0, file; file = files[fileIndex]; fileIndex++) {
      var reader = new FileReader();

      reader.onload = function(event2) {
        loadLog(event2.target.result);
      };

      reader.readAsText(file);
    }
  });

  // Manage interactive file selector
  var filepicker = document.getElementById("filepicker");

  filepicker.addEventListener("change", function(event) {
    event.stopPropagation();
    event.preventDefault();

    var file = filepicker.files[0];
    var reader = new FileReader();

    if (file) {
      reader.onload = function(e2) {
        var contents = e2.target.result;
        loadLog(contents);
      };

      reader.readAsText(file);
    }
  });

  // Initialize canvas.
  canvas = new Canvas();

  // Update the canvas when the time selector is modified.
  $("#time_selector").on("input change", function (/*event*/) {
    canvas.update();
  });

  // Zoom bar.
  $("#zoom_selector").on("input change", function (/*event*/) {
    canvas._zoomScale = $("#zoom_selector").val() / 1000;
    canvas.update();
  });

  // Track the play/pause button.
  var isAutoplaying = false;

  $("#autoplay").on("click", function (/*event*/) {
    if (log !== null) {
      isAutoplaying = !isAutoplaying;

      if (isAutoplaying === true) {
        if (parseInt($("#time_selector").val()) >= parseInt($("#time_selector").attr("max"))) {
          $("#time_selector").val(0);
        }

        $("#autoplay").addClass("ee-button-active");
      } else {
        $("#autoplay").removeClass("ee-button-active");
      }
    }
  });

  // On an interval when autoplay is enabled, increment the time controller.
  // eslint-disable-next-line no-unused-vars
  var loopAutoplay = setInterval(function () {
    if (isAutoplaying === true) {
      isAutoplaying = autoPlay(isAutoplaying);
    } else {
      $("#autoplay").removeClass("ee-button-active");
    }
  }, 100);

  // Track whether to show callsigns.
  $("#callsigns").on("click", function(/*event*/) {
    if (log !== null) {
      canvas.showCallsigns = !canvas.showCallsigns;
      canvas.update();
      if (canvas.showCallsigns === true) {
        $("#callsigns").addClass("ee-button-active");
      } else {
        $("#callsigns").removeClass("ee-button-active");
      }
    }
  });
});
