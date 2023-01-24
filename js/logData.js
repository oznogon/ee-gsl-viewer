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
        console.error(`Read json line error: ${err}`);
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

      // Work from beginning to end, and stop if the entry timestamp is later than the given time.
      // We collect all entries up to the given time, because static objects are only guaranteed to
      // be listed when they're added and might be modified or deleted between the scenario start
      // and the given time, so we need to compare any added or deleted objects at each step to the
      // cumulative historical state at the given point in time.
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