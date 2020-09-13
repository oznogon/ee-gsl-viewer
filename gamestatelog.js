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

// Globals.
let log,
  canvas;
// Each sector is a 20U (20000) square.
const sectorSize = 20000.0;

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
    // 100px = 20000U, or 1 sector
    const zoomScalePixels = 100.0,
      zoomScaleUnits = sectorSize;

    // Get canvas by HTML ID.
    this._canvas = $("#canvas");

    // Handle canvas mouse events.
    this._canvas.mousedown((event) => this._mouseDown(event));
    this._canvas.mousemove((event) => this._mouseMove(event));
    this._canvas.mouseup((event) => this._mouseUp(event));
    this._canvas.bind("wheel", (event) => {
      event.stopPropagation();
      event.preventDefault();
      this._mouseWheel(-event.originalEvent.deltaY);
    });

    // Update canvas on window resize.
    $(window).resize(() => this.update());

    // Initialize view origin, zoom, and options.
    this._viewX = 0;
    this._viewY = 0;
    // 20U = 100 pixels at default zoom.
    this._zoomScale = zoomScalePixels / zoomScaleUnits;
    this.showCallsigns = false;

    // Update the initialized canvas.
    this.update();
  }

  // Pass cursor coordinates back to the event on click/drag.
  _mouseDown (event) {
    this._lastMouseX = event.clientX;
    this._lastMouseY = event.clientY;
  }

  _mouseUp (event) {
    this._lastMouseX = event.clientX;
    this._lastMouseY = event.clientY;
  }

  // Move view on mouse drag.
  _mouseMove (event) {
    if (!event.buttons) {
      return;
    }

    // Translate mouse coordinates to world scale.
    this._viewX += (this._lastMouseX - event.clientX) / this._zoomScale;
    this._viewY += (this._lastMouseY - event.clientY) / this._zoomScale;

    // Update mouse position back to event.
    this._lastMouseX = event.clientX;
    this._lastMouseY = event.clientY;

    // Update the canvas.
    this.update();
  }

  // Zoom view when using the mouse wheel.
  _mouseWheel (delta) {
    const minimumDelta = -999.99,
      zoomScaleDivisor = 1000.0,
      // Cap delta to avoid impossible zoom scales.
      boundedDelta = Math.max(delta, minimumDelta);

    // Scale delta input value to zoom scale value.
    this._zoomScale *= 1.0 + (boundedDelta / zoomScaleDivisor);

    // Update zoom selector bar value with the new zoom scale.
    $("#zoom_selector").val(this._zoomScale * zoomScaleDivisor);

    // Update the canvas.
    this.update();
  }

  // Updates the canvas.
  update () {
    // Don't bother doing anything else if we don't have a log to read.
    if (!log) {
      return;
    }

    /*
     * Set the current scenario time to the time selector's current value.
     * (Should start at 0:00)
     */
    const time = $("#time_selector").val(),
      // Scale the canvas to fill the browser window.
      width = document.documentElement.clientWidth,
      height = document.documentElement.clientHeight,
      // Define zoom limits.
      maxZoom = 1.25,
      minZoom = 0.001,
      // Get the canvas context. We'll use this throughout for drawing.
      ctx = this._canvas[0].getContext("2d"),
      // For each entry at the given time, determine its type and draw an appropriate shape.
      entries = log.getEntriesAtTime(time),
      // Current position and zoom text bar values.
      stateTextTime = formatTime(time),
      stateTextZoom = `100px = ${(0.1 / this._zoomScale).toPrecision(3)}U`,
      stateTextX = `X: ${this._viewX.toPrecision(6)}`,
      stateTextY = `Y: ${this._viewY.toPrecision(6)}`,
      stateTextSector = `(${Canvas.getSectorDesignation(this._viewX, this._viewY)})`,
      // TODO: Fix out-of-range sector designations in-game.
      stateText = `${stateTextTime} / ${stateTextZoom} / ${stateTextX} / ${stateTextY} ${stateTextSector}`;

    this._canvas[0].width = width;
    this._canvas[0].height = height;

    // Workaround for weird intermittent canvas bug.
    if (isNaN(this._viewX)) {
      console.error("x was undef: ", this._viewX);
      this._viewX = 0;
    }

    if (isNaN(this._viewY)) {
      console.error("y was undef: ", this._viewY);
      this._viewY = 0;
    }

    /*
     * Cap the zoom scales to reasonable levels.
     * maxZoom: 100px = 0.08U
     * minZoom: 100px = 100U
     */
    this._zoomScale = Math.min(maxZoom, Math.max(minZoom, this._zoomScale));

    // Draw the canvas background.
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    // Draw the background grid.
    this.drawGrid(ctx, this._viewX, this._viewY, width, height, sectorSize, "#202040");

    for (const id in entries) {
      if (Object.prototype.hasOwnProperty.call(entries, id)) {
        const entry = entries[id],
          positionX = ((entry.position[0] - this._viewX) * this._zoomScale) + (width / 2.0),
          positionY = ((entry.position[1] - this._viewY) * this._zoomScale) + (height / 2.0),
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
          sizeMin = 1;

        if (entry.type === "Nebula") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#202080", mostlyTransparent, size5U);
        } else if (entry.type === "BlackHole") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#802020", mostlyTransparent, size5U);
        } else if (entry.type === "WormHole") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#800080", mostlyTransparent, size5U);
        } else if (entry.type === "Mine") {
          // Draw mine radius.
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#808080", mostlyTransparent, size05U);

          // Draw mine location.
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#FFF", opaque, sizeMin);
        } else if (entry.type === "PlayerSpaceship") {
          this.drawShip(ctx, positionX, positionY, entry);
        } else if (entry.type === "CpuShip") {
          this.drawShip(ctx, positionX, positionY, entry);
        } else if (entry.type === "WarpJammer") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#C89664", opaque, sizeJammer);
        } else if (entry.type === "SupplyDrop") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#0FF", opaque, sizeCollectible);
        } else if (entry.type === "SpaceStation") {
          this.drawStation(ctx, positionX, positionY, entry);
        } else if (entry.type === "Asteroid") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#FFC864", opaque, sizeMin);
        } else if (entry.type === "VisualAsteroid") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#FFC864", mostlyTransparent, sizeMin);
        } else if (entry.type === "Artifact") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#FFF", opaque, sizeCollectible);
        } else if (entry.type === "Planet") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#00A", opaque, Math.floor(entry.planet_radius / 20));
        } else if (entry.type === "ScanProbe") {
          // Draw probe scan radius.
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#60C080", nearlyTransparent, size5U);

          // Draw probe location.
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#60C080", opaque, sizeMin);
        } else if (entry.type === "Nuke") {
          Canvas.drawSquare(ctx, positionX, positionY, this._zoomScale, "#F40", opaque, sizeMin);
        } else if (entry.type === "EMPMissile") {
          Canvas.drawSquare(ctx, positionX, positionY, this._zoomScale, "#0FF", opaque, sizeMin);
        } else if (entry.type === "HomingMissile") {
          Canvas.drawSquare(ctx, positionX, positionY, this._zoomScale, "#FA0", opaque, sizeMin);
        } else if (entry.type === "HVLI") {
          Canvas.drawSquare(ctx, positionX, positionY, this._zoomScale, "#AAA", opaque, sizeMin);
        } else if (entry.type === "BeamEffect") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#A60", halfTransparent, sizeBeamHit);
        } else if (entry.type === "ExplosionEffect") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#FF0", halfTransparent, sizeExplosion);
        } else if (entry.type === "ElectricExplosionEffect") {
          Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, "#0FF", halfTransparent, sizeExplosion);
        } else {
          // If an object is an unknown type, log a debug message and display it in fuscia.
          console.debug("Unknown object type: ", entry.type);
          Canvas.drawSquare(ctx, positionX, positionY, this._zoomScale, "#F0F", opaque, sizeMin);
        }
      }
    }

    // Draw the info line showing the scenario time, scale, X/Y coordinates, and sector designation.
    ctx.fillStyle = "#FFF";
    ctx.font = "20px 'Bebas Neue Regular', Impact, Arial, sans-serif";
    ctx.fillText(stateText, 20, 40);
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
          ctx.fillText(Canvas.getSectorDesignation(gridlineVertWorldList[eachGridlineVert], gridlineHorizWorldList[eachGridlineHoriz]), gridlineVertCanvasList[eachGridlineVert] + 8, gridlineHorizCanvasList[eachGridlineHoriz] + 24);
        }
      }
    }
  }

  static getFactionColor (faction, lowColor, highColor) {
    // Rudimentary faction ID; would be nice to use the GM colors from factioninfo.lua. Returns a fillStyle string.
    if (faction === "Human Navy") {
      return `#${lowColor}${highColor}${lowColor}`;
    } else if (faction === "Independent") {
      return `#${lowColor}${lowColor}${highColor}`;
    } else if (faction === "Arlenians") {
      return `#${highColor}${lowColor}0`;
    } else if (faction === "Exuari") {
      return `#${highColor}0${lowColor}`;
    } else if (faction === "Ghosts") {
      return `#${highColor}${highColor}${highColor}`;
    } else if (faction === "Ktlitans") {
      // Very close to Human Navy
      return `#${lowColor}${highColor}0`;
    }

    // Everybody else is evil
    console.debug(`Unknown faction: ${faction}`);
    return `#${highColor}${lowColor}${lowColor}`;
  }

  // Return an effective minimum size for the square, unless its size modifier is huge.
  static calculateMinimumSize (sizeMultiplier, zoomScale, sizeModifier) {
    const hugeSizeModifier = 50;

    if (sizeModifier < hugeSizeModifier) {
      return Math.max(sizeMultiplier * zoomScale, sizeModifier);
    }

    return sizeMultiplier * zoomScale;
  }

  // Draw a square that scales with the zoom level.
  static drawSquare (ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier) {
    // Prevent small objects from disappearing when zoomed out.
    const sizeMultiplier = sizeModifier * (100 / 3);
    let squareSize = 1;

    // Set an effective minimum size for the square, unless its size mod is huge.
    squareSize = Canvas.calculateMinimumSize(sizeMultiplier, zoomScale, sizeModifier);

    // Define the shape's appearance.
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;
    // Draw the shape.
    ctx.fillRect(positionX - (squareSize / 2), positionY - (squareSize / 2), squareSize, squareSize);
    // Reset global alpha.
    ctx.globalAlpha = 1.0;
  }

  // Draw a circle that scales with the zoom level.
  static drawCircle (ctx, positionX, positionY, zoomScale, fillColor, fillAlpha, sizeModifier) {
    // Prevent small objects from disappearing when zoomed out.
    const sizeMultiplier = sizeModifier * (100 / 3);
    let circleSize = 1;

    // Set an effective minimum size for the square, unless its size mod is huge.
    circleSize = Canvas.calculateMinimumSize(sizeMultiplier, zoomScale, sizeModifier / 2);

    // Define the shape's appearance.
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;
    // Draw the shape.
    ctx.beginPath();
    ctx.arc(positionX, positionY, circleSize / 2, 0, 2 * Math.PI, false);
    ctx.fill();
    // Reset global alpha.
    ctx.globalAlpha = 1.0;
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
  drawStation (ctx, positionX, positionY, entry) {
    // Get its faction color.
    const factionColor = Canvas.getFactionColor(entry.faction, "5", "F");

    // Draw a circle and scale it by zoom and station type.
    let sizeModifier = 18;

    if (entry.station_type === "Huge Station") {
      sizeModifier = 48;
    } else if (entry.station_type === "Large Station") {
      sizeModifier = 36;
    } else if (entry.station_type === "Medium Station") {
      sizeModifier = 28;
    }

    Canvas.drawCircle(ctx, positionX, positionY, this._zoomScale, factionColor, 1.0, sizeModifier);

    // Draw the station's callsign, if callsigns are enabled.
    if (this.showCallsigns === true) {
      Canvas.drawCallsign(ctx, positionX, positionY, this._zoomScale, entry, "18", "C8", "FF", sizeModifier / Math.PI);
    }
  }

  // Draw a player or CPU ship.
  drawShip (ctx, positionX, positionY, entry) {
    // Initialize color brightness.
    let fillStyleMagnitude = "C";
    // Get the ship's faction color.
    const factionColor = Canvas.getFactionColor(entry.faction, "0", fillStyleMagnitude);

    // Use a brighter color for player ships.
    if (entry.type === "PlayerSpaceship") {
      fillStyleMagnitude = "F";
    }

    // Draw the ship rectangle and scale it on zoom.
    Canvas.drawSquare(ctx, positionX, positionY, this._zoomScale, factionColor, 1.0, 4);

    // Draw its callsign. Draw player callsigns brighter.
    if (this.showCallsigns === true) {
      Canvas.drawCallsign(ctx, positionX, positionY, this._zoomScale, entry, "18", "B8", fillStyleMagnitude, 2);
    }

    // Draw beam arcs if the object has them.
    if (typeof entry.config !== "undefined" && typeof entry.config.beams !== "undefined") {
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
        ctx.strokeStyle = "#F00";
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }
    }
  }
}

// Load log data into the dropzone div and setup the time selector.
function loadLog (data) {
  log = new LogData(data);

  if (log.entries.length > 0) {
    $("#dropzone").hide();
    console.debug(log.getMaxTime());
    canvas.update();
    $("#time_selector").attr("max", log.getMaxTime());
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
  document.addEventListener('dragover', function(event) {
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

      reader.onload = function(e2) {
        loadLog(e2.target.result);
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
  $("#time_selector").on("input change", function (/*e*/) {
    canvas.update();
  });

  // Zoom bar.
  $("#zoom_selector").on("input change", function (/*e*/) {
    canvas._zoomScale = $("#zoom_selector").val() / 1000;
    canvas.update();
  });

  // Track the play/pause button.
  var isAutoplaying = false;

  $("#autoplay").on("click", function (/*e*/) {
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
  $("#callsigns").on("click", function(/*e*/) {
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
