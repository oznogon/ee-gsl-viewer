/* eslint-env jquery */
/* eslint semi: "error", indent: ["error", 2] */
/* eslint no-magic-numbers: ["error", { "ignoreArrayIndexes": true }] */
/* eslint no-magic-numbers: ["error", { "ignore": [1] }] */
/* eslint padded-blocks: ["error", "never"] */
/* eslint function-call-argument-newline: ["error", "never"] */
/* eslint max-len: ["warn", { "code": 120 }] */
/* eslint-disable max-classes-per-file, no-console, max-statements */

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

class Canvas
{
  constructor()
  {
    // Get canvas by HTML ID.
    this._canvas = $("#canvas");

    // Handle canvas mouse events.
    this._canvas.mousedown(function(e) {
      canvas._mouseDown(e);
    });

    this._canvas.mousemove(function(e) {
      canvas._mouseMove(e);
    });

    this._canvas.mouseup(function(e) {
      canvas._mouseUp(e);
    });

    this._canvas.bind('mousewheel', function(e) {
      e.stopPropagation();
      e.preventDefault();
      canvas._mouseWheel(e.originalEvent.wheelDelta);
    });

    // Update canvas on window resize.
    $(window).resize(function() {
      canvas.update();
    });

    // Initialize view origin, zoom, and options.
    this._view_x = 0;
    this._view_y = 0;
    // 20U = 100 pixels at default zoom.
    this._zoom_scale = 100.0 / 20000.0;
    this.showCallsigns = false;

    // Update the initialized canvas.
    this.update();
  }

  // Pass cursor coordinates back to the event on click/drag.
  _mouseDown(e)
  {
    this._last_mouse_x = e.clientX;
    this._last_mouse_y = e.clientY;
  }

  _mouseUp(e)
  {
    this._last_mouse_x = e.clientX;
    this._last_mouse_y = e.clientY;
  }

  // Move view on mouse drag.
  _mouseMove(e)
  {
    if (!e.buttons) {
      return;
    }

    // Translate mouse coordinates to world scale.
    this._view_x += (this._last_mouse_x - e.clientX) / this._zoom_scale;
    this._view_y += (this._last_mouse_y - e.clientY) / this._zoom_scale;

    // Update mouse position back to event.
    this._last_mouse_x = e.clientX;
    this._last_mouse_y = e.clientY;

    // Update the canvas.
    this.update();
  }

  // Zoom view when using the mouse wheel.
  _mouseWheel(delta)
  {
    // Cap delta to avoid impossible zoom scales.
    delta = Math.max(delta, -999.99);

    // Scale delta input value to zoom scale value.
    this._zoom_scale *= 1.0 + delta / 1000.0;

    // Update zoom selector bar value with the new zoom scale.
    $("#zoom_selector").val(canvas._zoom_scale * 1000);

    // Update the canvas.
    this.update();
  }

  // Updates the canvas.
  update()
  {
    // Scale the canvas to fill the browser window.
    var w = document.documentElement.clientWidth;
    var h = document.documentElement.clientHeight;
    this._canvas[0].width = w;
    this._canvas[0].height = h;

    // Workaround for weird intermittent canvas bug.
    if (isNaN(this._view_x))
    {
      console.error("x was undef: ", this._view_x);
      this._view_x = 0;
    }

    if (isNaN(this._view_y))
    {
      console.error("y was undef: ", this._view_y);
      this._view_y = 0;
    }

    // Cap the zoom scales to reasonable levels.
    if (this._zoom_scale > 1.25) {
      // 100px = 0.08U
      this._zoom_scale = 1.25;
    } else if (this._zoom_scale < 0.001) {
      // 100px = 100U
      this._zoom_scale = 0.001;
    }

    // Get the canvas context. We'll use this throughout for drawing.
    var ctx = this._canvas[0].getContext("2d");

    // Draw the canvas background.
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    // Don't bother doing anything else if we don't have a log to read.
    if (!log) {
      return;
    }

    // Set the current scenario time to the current time selector range input.
    // (Should start at 0:00)
    var time = $("#time_selector").val();

    // Draw the background grid.
    this.drawGrid(ctx, this._view_x, this._view_y, w, h, 20000.0, "#202040");

    // For each entry at the given time, determine its type and
    // draw an appropriate shape.
    var entries = log.getEntriesAtTime(time);

    for (var id in entries)
    {
      var entry = entries[id];
      var x = (entry["position"][0] - this._view_x) * this._zoom_scale + w / 2.0;
      var y = (entry["position"][1] - this._view_y) * this._zoom_scale + h / 2.0;

      if (entry.type == "Nebula")
      {
        this.drawCircle(ctx, x, y, this._zoom_scale, "#202080", 0.3, 300);
      } else if (entry.type == "BlackHole") {
        this.drawCircle(ctx, x, y, this._zoom_scale, "#802020", 0.3, 300);
      } else if (entry.type == "WormHole") {
        this.drawCircle(ctx, x, y, this._zoom_scale, "#800080", 0.3, 300);
      } else if (entry.type == "Mine") {
        // Draw mine radius.
        this.drawCircle(ctx, x, y, this._zoom_scale, "#808080", 0.3, 30);

        // Draw mine location.
        this.drawCircle(ctx, x, y, this._zoom_scale, "#FFF", 1.0, 1);
      } else if (entry.type == "PlayerSpaceship") {
        this.drawShip(ctx, x, y, entry);
      } else if (entry.type == "CpuShip") {
        this.drawShip(ctx, x, y, entry);
      } else if (entry.type == "WarpJammer") {
        this.drawCircle(ctx, x, y, this._zoom_scale, "#C89664", 1.0, 4);
      } else if (entry.type == "SupplyDrop") {
        this.drawCircle(ctx, x, y, this._zoom_scale, "#0FF", 1.0, 2);
      } else if (entry.type == "SpaceStation") {
        this.drawStation(ctx, x, y, entry);
      } else if (entry.type == "Asteroid") {
        this.drawCircle(ctx, x, y, this._zoom_scale, "#FFC864", 1.0, 1);
      } else if (entry.type == "Planet") {
        this.drawCircle(ctx, x, y, this._zoom_scale, "#00A", 1.0, Math.floor(entry["planet_radius"] / 20));
      } else if (entry.type == "ScanProbe") {
        // Draw probe scan radius.
        this.drawCircle(ctx, x, y, this._zoom_scale, "#60C080", 0.1, 300);

        // Draw probe location.
        this.drawCircle(ctx, x, y, this._zoom_scale, "#60C080", 1.0, 1);
      } else if (entry.type == "Nuke") {
        this.drawSquare(ctx, x, y, this._zoom_scale, "#F40", 1.0, 1);
      } else if (entry.type == "EMPMissile") {
        this.drawSquare(ctx, x, y, this._zoom_scale, "#0FF", 1.0, 1);
      } else if (entry.type == "HomingMissile") {
        this.drawSquare(ctx, x, y, this._zoom_scale, "#FA0", 1.0, 1);
      } else if (entry.type == "HVLI") {
        this.drawSquare(ctx, x, y, this._zoom_scale, "#AAA", 1.0, 1);
      } else if (entry.type == "BeamEffect") {
        this.drawCircle(ctx, x, y, this._zoom_scale, "#A60", 0.5, 2);
      } else if (entry.type == "ExplosionEffect") {
        this.drawCircle(ctx, x, y, this._zoom_scale, "#FF0", 0.5, 3);
      } else if (entry.type == "ElectricExplosionEffect") {
        this.drawCircle(ctx, x, y, this._zoom_scale, "#0FF", 0.5, 3);
      } else if (entry.type == "VisualAsteroid") {
        // Don't show VisualAsteroids
      } else {
        // If an object is an unknown type, log a debug message and display
        // it in fuscia.
        console.debug("Unknown object type: ", entry.type);
        this.drawSquare(ctx, x, y, this._zoom_scale, "#F0F", 1.0, 2);
      }
    }

    // Draw the info line showing the scenario time, scale,
    // X/Y coordinates, and sector designation.
    ctx.fillStyle = "#FFF";
    var stateTextTime = formatTime(time);
    var stateTextZoom = "100px = " + (0.1 / this._zoom_scale).toPrecision(3) + "U";
    var stateTextX = "X: " + this._view_x.toPrecision(6);
    var stateTextY = "Y: " + this._view_y.toPrecision(6);
    var stateTextSector = "(" + this.getSectorDesignation(this._view_x, this._view_y) + ")";
    // TODO: Fix out-of-range sector designations in-game.
    var stateText = stateTextTime + " / " + stateTextZoom + " / " + stateTextX + " / " + stateTextY + " " + stateTextSector;
    ctx.font = "20px bebas_neue_regularregular, Impact, Arial, sans-serif";
    ctx.fillText(stateText, 20, 40);
  }

  getSectorDesignation(x, y)
  {
    // Sectors are designated with a letter (Y axis) and number
    // (X axis). Coordinates 0, 0 represent the intersection of
    // F and 5. Each sector is a 20U (20000) square.

    // TODO: Fix out-of-range sector designations in-game.
    var sectorLetter = String.fromCharCode('F'.charCodeAt() + Math.floor(y / 20000));

    // Sector numbers are 0-99.
    var sectorNumber = 5 + Math.floor(x / 20000);
    if (sectorNumber < 0) {
      sectorNumber = 100 + sectorNumber;
    }

    return sectorLetter + sectorNumber;
  }

  drawGrid(ctx, x, y, canvasWidth, canvasHeight, gridIntervalSize, gridlineColor)
  {
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = gridlineColor;

    var gridlineHoriz;
    var gridlineVert;

    // Translate the visible canvas into world coordinates.
    var canvasEdges = {
      "left": x - ((canvasWidth / 2) / this._zoom_scale),
      "right": x + ((canvasWidth / 2) / this._zoom_scale),
      "top": y - ((canvasHeight / 2) / this._zoom_scale),
      "bottom": y + ((canvasHeight / 2) / this._zoom_scale)
    };

    // Find the first gridlines from the top left.
    var gridlineHorizTop = canvasEdges.top - canvasEdges.top % 20000;
    var gridlineVertLeft = canvasEdges.left - canvasEdges.left % 20000;
    var gridlineVertWorldList = [];
    var gridlineVertCanvasList = [];
    var gridlineHorizWorldList = [];
    var gridlineHorizCanvasList = [];

    // Draw horizontal gridlines until we run out of canvas.
    for (var gridlineHorizPosition = gridlineHorizTop; gridlineHorizPosition <= canvasEdges.bottom; gridlineHorizPosition += gridIntervalSize)
    {
      // Translate screen position to world position.
      gridlineHoriz = (gridlineHorizPosition - y) * this._zoom_scale + canvasHeight / 2.0;
      gridlineHorizWorldList.push(gridlineHorizPosition);
      gridlineHorizCanvasList.push(gridlineHoriz);

      ctx.beginPath();
      ctx.moveTo(0, gridlineHoriz);
      ctx.lineTo(canvasWidth, gridlineHoriz);
      ctx.closePath();
      ctx.stroke();
    }

    // Draw vertical gridlines until we run out of canvas.
    for(var gridlineVertPosition = gridlineVertLeft; gridlineVertPosition < canvasEdges.right; gridlineVertPosition += gridIntervalSize)
    {
      // Translate screen position to world position.
      gridlineVert = (gridlineVertPosition - x) * this._zoom_scale + canvasWidth / 2.0;
      gridlineVertWorldList.push(gridlineVertPosition);
      gridlineVertCanvasList.push(gridlineVert);

      ctx.beginPath();
      ctx.moveTo(gridlineVert, 0);
      ctx.lineTo(gridlineVert, canvasHeight);
      ctx.closePath();
      ctx.stroke();
    }

    ctx.fillStyle = gridlineColor;
    ctx.font = "24px bebas_neue_regularregular, Impact, Arial, sans-serif";

    if (gridlineHorizCanvasList.length <= 25 && gridlineVertCanvasList.length <= 25)
    {
      for (var eachGridlineHoriz = 0; eachGridlineHoriz < gridlineHorizCanvasList.length; eachGridlineHoriz++)
      {
        for (var eachGridlineVert = 0; eachGridlineVert < gridlineVertCanvasList.length; eachGridlineVert++)
        {
          ctx.fillText(
            this.getSectorDesignation(gridlineHorizWorldList[eachGridlineHoriz], gridlineVertWorldList[eachGridlineVert]),
            gridlineVertCanvasList[eachGridlineVert],
            gridlineHorizCanvasList[eachGridlineHoriz] + 16
          );
        }
      }
    }
  }

  getFactionColor(faction, lowColor, highColor)
  {
    // Rudimentary faction ID; would be nice to use the GM
    // colors from factioninfo.lua. Returns a fillStyle string.
    if (faction == "Human Navy") {
      return "#" + lowColor + highColor + lowColor;
    } else if (faction == "Independent") {
      return "#" + lowColor + lowColor + highColor;
    } else if (faction == "Arlenians") {
      return "#" + highColor + lowColor + "0";
    } else if (faction == "Exuari") {
      return "#" + highColor + "0" + lowColor;
    } else if (faction == "Ghosts") {
      return "#" + highColor + highColor + highColor;
    } else if (faction == "Ktlitans") {
      // Very close to Human Navy
      return "#" + lowColor + highColor + "0";
    } else {
      // Everybody else is evil
      return "#" + highColor + lowColor + lowColor;
    }
  }

  drawSquare(ctx, x, y, zoomScale, fillColor, fillAlpha, sizeModifier)
  {
    // Draw a square that scales with the zoom level.
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;

    // Prevent small objects from disappearing when zoomed out.
    var sizeMultiplier = sizeModifier * (100 / 3);
    var squareSize;

    if (sizeModifier < 50) {
      squareSize = Math.max(sizeMultiplier * zoomScale, sizeModifier);
    } else {
      squareSize = sizeMultiplier * zoomScale;
    }

    ctx.fillRect(x - squareSize / 2, y - squareSize / 2, squareSize, squareSize);
    ctx.globalAlpha = 1.0;
  }

  drawCircle(ctx, x, y, zoomScale, fillColor, fillAlpha, sizeModifier)
  {
    // Draw a circle that scales with the zoom level.
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;

    // Prevent small objects from disappearing when zoomed out.
    var sizeMultiplier = sizeModifier * (100 / 3);
    var circleSize;

    if (sizeModifier < 50) {
      circleSize = Math.max(sizeMultiplier * zoomScale, sizeModifier / 2);
    } else {
      circleSize = sizeMultiplier * zoomScale;
    }

    ctx.beginPath();
    ctx.arc(x, y, circleSize / 2, 0, 2 * Math.PI, false);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  drawCallsign(ctx, x, y, zoomScale, entry, fontSize, lowColor, highColor, textDrift)
  {
    // Draw the object's callsign.
    ctx.fillStyle = this.getFactionColor(entry.faction, lowColor, highColor);
    ctx.font = fontSize + "px bebas_neue_regularregular, Impact, Arial, sans-serif";
    var textDriftAmount = Math.max((textDrift * 66.666) * zoomScale, textDrift);
    ctx.fillText(entry.callsign, x + textDriftAmount, y + textDriftAmount);
  }

  drawStation(ctx, x, y, entry)
  {
    // Get its faction color.
    var factionColor = this.getFactionColor(entry.faction, "5", "F");

    // Draw a circle and scale it by zoom and station type.
    var sizeModifier;

    if (entry.station_type == "Huge Station")
    {
      sizeModifier = 48;
    } else if (entry.station_type == "Large Station") {
      sizeModifier = 36;
    } else if (entry.station_type == "Medium Station") {
      sizeModifier = 28;
    } else {
      sizeModifier = 18;
    }

    this.drawCircle(ctx, x, y, this._zoom_scale, factionColor, 1.0, sizeModifier);

    // Draw its callsign.
    if (this.showCallsigns === true)
      this.drawCallsign(ctx, x, y, this._zoom_scale, entry, "18", "C8", "FF", sizeModifier / Math.PI);
  }

  drawShip(ctx, x, y, entry)
  {
    // Use a brighter color for player ships.
    var fillStyleMagnitude = "C";
    if (entry.type == "PlayerSpaceship") {
      fillStyleMagnitude = "F";
    }

    // Get its faction color.
    var factionColor = this.getFactionColor(entry.faction, "0", fillStyleMagnitude);

    // Draw the ship rectangle and scale it on zoom.
    this.drawSquare(ctx, x, y, this._zoom_scale, factionColor, 1.0, 4);

    // Draw its callsign. Draw player callsigns brighter.
    if (this.showCallsigns === true) {
      this.drawCallsign(ctx, x, y, this._zoom_scale, entry, "18", "B8", fillStyleMagnitude, 2);
    }

    // Draw beam arcs if the object has them.
    if (typeof entry.config !== "undefined" && typeof entry.config.beams != "undefined")
    {
      for (var beamIndex = 0; beamIndex < entry.config.beams.length; beamIndex++)
      {
        var beam = entry.config.beams[beamIndex];
        var a = entry.rotation + beam.direction;
        var r = beam.range * this._zoom_scale;
        var a1 = (a - beam.arc / 2.0) / 180.0 * Math.PI;
        var a2 = (a + beam.arc / 2.0) / 180.0 * Math.PI;
        var x1 = x + Math.cos(a1) * r;
        var y1 = y + Math.sin(a1) * r;
        var x2 = x + Math.cos(a2) * r;
        var y2 = y + Math.sin(a2) * r;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x1, y1);
        ctx.arc(x, y, r, a1, a2, false);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x, y);

        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#F00";
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }
    }
  }
}

// Load log data into the dropzone div and setup the time selector.
function loadLog(data)
{
  log = new LogData(data);

  if (log.entries.length > 0)
  {
    $("#dropzone").hide();
    console.debug(log.getMaxTime());
    canvas.update();
    $("#time_selector").attr("max", log.getMaxTime());
  }
}

// Format scenario time into MM:SS.
function formatTime(time)
{
  if (time % 60 < 10) {
    return Math.floor(time / 60) + ":0" + (time % 60);
  }
  return Math.floor(time / 60) + ":" + (time % 60);
}

// Programmatically advance the time selector.
function autoPlay(isAutoplaying)
{
  var timeValue = parseInt($("#time_selector").val());
  timeValue += 1;
  $("#time_selector").val(timeValue);
  canvas.update();

  // If we reach the end, stop autoplaying.
  if (parseInt($("#time_selector").val()) >= parseInt($("#time_selector").attr("max")))
  {
    return !isAutoplaying;
  }

  // Otherwise, keep going.
  return isAutoplaying;
}

var log;
var canvas;

// Main function.
$().ready(function()
{
  // Listen from drag and drop events to load log files.
  // TODO: Add file picker option for browser/OS combos that
  // complicate drag-and-drop.
  document.addEventListener('dragover', function(e) {
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', function(e) {
    e.stopPropagation();
    e.preventDefault();

    var files = e.dataTransfer.files;

    // eslint-disable-next-line no-cond-assign
    for (var fileIndex = 0, file; file = files[fileIndex]; fileIndex++)
    {
      var reader = new FileReader();
      reader.onload = function(e2) {
        loadLog(e2.target.result);
      };
      reader.readAsText(file);
    }
  });

  // Manage interactive file selector
  var filepicker = document.getElementById("filepicker");

  filepicker.addEventListener('change', function(e) {
    e.stopPropagation();
    e.preventDefault();

    var file = filepicker.files[0];
    var reader = new FileReader();

    if (file)
    {
      reader.onload = function(e2) {
        var contents = e2.target.result;
        loadLog(contents);
      };

      reader.readAsText(file);
    }
  });
  canvas = new Canvas();

  // Update the canvas when the time selector is modified.
  $("#time_selector").on("input change", function(/*e*/) {
    canvas.update();
  });

  // Zoom bar.
  $("#zoom_selector").on("input change", function(/*e*/) {
    var zoom_value = $("#zoom_selector").val();
    canvas._zoom_scale = zoom_value / 1000;
    canvas.update();
  });

  // Track the play/pause button.
  var isAutoplaying = false;

  $("#autoplay").on("click", function(/*e*/) {
    if (log != null)
    {
      isAutoplaying = !isAutoplaying;

      if (isAutoplaying === true)
      {
        if (parseInt($("#time_selector").val()) >= parseInt($("#time_selector").attr("max")))
          $("#time_selector").val(0);
        $("#autoplay").addClass("ee-button-active");
      } else {
        $("#autoplay").removeClass("ee-button-active");
      }
    }
  });

  // On an interval when autoplay is enabled, increment the time controller.
  // eslint-disable-next-line no-unused-vars
  var loopAutoplay = setInterval(function() {
    if (isAutoplaying === true)
    {
      isAutoplaying = autoPlay(isAutoplaying);
    } else {
      $("#autoplay").removeClass("ee-button-active");
    }
  }, 100);

  // Track whether to show callsigns.
  $("#callsigns").on("click", function(/*e*/) {
    if (log != null)
    {
      canvas.showCallsigns = !canvas.showCallsigns;
      canvas.update();
      if (canvas.showCallsigns === true)
        $("#callsigns").addClass("ee-button-active");
      else
        $("#callsigns").removeClass("ee-button-active");
    }
  });
});
