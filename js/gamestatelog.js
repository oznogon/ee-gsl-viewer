// Global values
// =============

let log;

// Global functions
// ================

// Load log data, hide the dropzone div, and setup the time selector.
function loadLog (data, canvas) {
  log = new LogData(data);

  if (log.entries.length > 0) {
    $("#dropzone").hide();
    $("#time_selector").attr("max", log.getMaxTime());
    canvas.update();
  }
}

// Main onReady function.
$().ready(function () {

  // Data
  // ====

  // Initialize the interactive file selector.
  const [filepicker] = $("#filepicker"),
    // Define options for playbackUpdateInterval.
    playbackUpdateOptions = [
      1000,
      500,
      250,
      100,
      50,
      25
    ],
    // Initialize the canvas.
    canvas = new Canvas();

  // Initialize the playback interval reference.
  let loopAutoplay = 0,
    // Initialize playback update interval in ms per frame.
    playbackUpdateInterval = playbackUpdateOptions[3],
    // Initialize the zoom timeout.
    zoomTimeout = 0,
    // Do not initiate playback on ready by default.
    isAutoplaying = false;

  // Loading screen events
  // =====================

  // Listen from drag and drop events to load log files.
  let counter = 0;

  document.addEventListener("dragenter", function (event) {
    event.stopPropagation();
    event.preventDefault();
    counter++;
    document.getElementById("droptarget").classList.add('ee-box-highlight');
  });

  document.addEventListener("dragleave", function (event) {
    event.stopPropagation();
    event.preventDefault();
    counter--;
    if (counter === 0) {
        document.getElementById("droptarget").classList.remove('ee-box-highlight');
    }
  });

  document.addEventListener("dragover", function (event) {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  document.addEventListener("drop", function (event) {
    event.stopPropagation();
    event.preventDefault();

    const {files} = event.dataTransfer;

    for (let fileIndex = 0, file; file = files[fileIndex]; fileIndex += 1) {
      const reader = new FileReader();

      reader.onload = function (event2) {
        loadLog(event2.target.result, canvas);
      };

      reader.readAsText(file);
    }
  });

  // If the interactive file selector is passed a file, load it.
  filepicker.addEventListener("change", function (event) {
    event.stopPropagation();
    event.preventDefault();

    const [file] = filepicker.files,
      reader = new FileReader();

    if (file) {
      reader.onload = function (event2) {
        loadLog(event2.target.result, canvas);
      };

      reader.readAsText(file);
    }
  });

  // Implement the zoom controls.
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

  // Main-scope functions
  // ====================

  function advanceTimeline (direction = 1) {
    let timeValue = parseInt($("#time_selector").val(), 10);

    // Advance the timeline by 1 second.
    timeValue += direction;
    $("#time_selector").val(timeValue);

    // Update the canvas.
    canvas.update();

    // Update the infobox if there's a selected object. Otherwise, hide it.
    if (typeof canvas._selectedObject !== "undefined" && canvas._selectedObject.type !== "No selection") {
      canvas.updateSelectionInfobox(parseInt($("#time_selector").val(), 10));
    } else {
      canvas._infobox.hide();
    }
  }

  // Programmatically advance the time selector.
  function autoPlay () {
    // Advance the timeline by 1 second and update the canvas.
    advanceTimeline();

    // If we reach the end, stop autoplaying.
    if (parseInt($("#time_selector").val(), 10) >= parseInt($("#time_selector").attr("max"), 10)) {
      return !isAutoplaying;
    }

    // Otherwise, keep going.
    return isAutoplaying;
  }

  // Update the canvas state for timeline changes.
  function timeSelectorUpdated () {
    // Update the canvas.
    canvas.update();

    // Update the infobox if there's a selected object. Otherwise, hide it.
    if (typeof canvas._selectedObject !== "undefined" && canvas._selectedObject.type !== "No selection") {
      canvas.updateSelectionInfobox($("#time_selector").val());
    } else {
      canvas._infobox.hide();
    }
  }

  // Reset the autoplay loop.
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

  // Toggle the autoplay loop state.
  function toggleAutoplay () {
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
  }

  // Iterate through playback speed options.
  function cycleAutoplaySpeed () {
    for (let index = playbackUpdateOptions.length - 1; index >= 0; index -= 1) {
      // Loop through options to get the index of our current setting.
      if (playbackUpdateInterval === playbackUpdateOptions[index]) {
        if (typeof playbackUpdateOptions[index + 1] === "undefined") {
          if (typeof playbackUpdateOptions[0] === "undefined") {
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
  }

  // Toggle callsign displays.
  function toggleCallsigns () {
    if (log !== null) {
      // Toggle callsigns and update the canvas.
      canvas.showCallsigns = !canvas.showCallsigns;
      canvas.update();

      // Change the button's activation class if toggled.
      if (canvas.showCallsigns === true) {
        $("#callsigns").addClass("ee-button-active");
      } else {
        $("#callsigns").removeClass("ee-button-active");
      }
    }
  }

  // Toggle locking the view on a selected object.
  function toggleViewLock () {
    if (log !== null) {
      // If the view is locked on a valid selected object, toggle the button.
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
  }

  // Interactive events
  // ==================

  // Reinitialize the playback interval.
  loopAutoplay = resetAutoplay(loopAutoplay);

  // Update the canvas for features' UI control interactions.
  $("#time_selector").on("input change", function (/* event */) {
    timeSelectorUpdated();
  });

  $("#lock_view").on("click", function (/* event */) {
    toggleViewLock();
  });

  $("#autoplay").on("click", function (/* event */) {
    toggleAutoplay();
  });

  // Cycle through autoplay speed options.
  $("#autoplay_speed").on("click", function (/* event */) {
    cycleAutoplaySpeed();
  });

  // Toggle callsign display.
  $("#callsigns").on("click", function (/* event */) {
    toggleCallsigns();
  });

  // Keyboard shortcuts
  // ==================

  // Zoom controls
  // Double the zoom rate if holding shift.
  Mousetrap.bind("=", () => canvas.zoomCamera(1));
  Mousetrap.bind("+", () => canvas.zoomCamera(2));
  Mousetrap.bind("-", () => canvas.zoomCamera(-1));
  Mousetrap.bind("_", () => canvas.zoomCamera(-2));

  // Camera pan controls
  // Scale the panning movement to the zoom level.
  Mousetrap.bind(["w", "a", "s", "d",
    "shift+w", "shift+a", "shift+s", "shift+d"], function (event, combo) {
    // Set the camera position relative to its current world position.
    let viewX = canvas._view.x,
      viewY = canvas._view.y,
      moveStep = 10 / canvas._zoomScale;

    // Don't try to pan if the view is locked on a valid selection.
    if (canvas.isViewLocked === false || Canvas.isSelectionValid(canvas._selectedObject) === false) {
      // Move faster if shift is held down.
      switch (combo) {
      case "w":
        viewY -= moveStep;
        break;
      case "a":
        viewX -= moveStep;
        break;
      case "s":
        viewY += moveStep;
        break;
      case "d":
        viewX += moveStep;
        break;
      case "shift+w":
        viewY -= 10 * moveStep;
        break;
      case "shift+a":
        viewX -= 10 * moveStep;
        break;
      case "shift+s":
        viewY += 10 * moveStep;
        break;
      case "shift+d":
        viewX += 10 * moveStep;
        break;
      default:
        console.error("Invalid input to wasd binding");
      }

      // Move the camera to the new world position and update the canvas.
      canvas.pointCameraAt(viewX, viewY);
      canvas.update();
    }
  });

  // Playback controls
  Mousetrap.bind("k", () => toggleAutoplay());
  Mousetrap.bind("]", () => cycleAutoplaySpeed());
  Mousetrap.bind("c", () => toggleCallsigns());
  Mousetrap.bind("l", () => toggleViewLock());
  Mousetrap.bind("x", () => advanceTimeline(1));
  Mousetrap.bind("z", () => advanceTimeline(-1));
  Mousetrap.bind("shift+x", () => advanceTimeline(10));
  Mousetrap.bind("shift+z", () => advanceTimeline(-10));

  // Debug toggle (no corresponding UI element)
  // Draw only debug rectangles and log selected object JSON to the console.
  Mousetrap.bind("shift+d", () => {
    canvas._debugDrawing = !canvas._debugDrawing;
    console.debug(canvas._selectedObject);
    canvas.update();
  });
});
