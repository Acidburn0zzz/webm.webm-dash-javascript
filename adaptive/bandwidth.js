// Copyright (c) 2012 The WebM project authors. All Rights Reserved.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file in the root of the source
// tree. An additional intellectual property rights grant can be found
// in the file PATENTS.  All contributing project authors may
// be found in the AUTHORS file in the root of the source tree.

'use strict';

/**
 * Class is used to estimate the bandwidth from timed data chunks.
 * @constructor
 */
function Bandwidth() {
  this.list = [];
}

/**
 * List of objects containing information on downloaded chunks of data. The
 * objects contain time the data was requested. The time the data finished
 * downloading. The size of the data in bytes.
 * @type {Array.<Object>}
 */
Bandwidth.prototype.list = null;

/**
 * Logging function to be set by the application.
 * @param {string} str The input string to be logged.
 */
Bandwidth.prototype.log = function(str) {};

/**
 * Add a download object descriptor to the list.
 * @param {number} startTime Time in seconds the data was requested.
 * @param {number} endTime Time in seconds the data was received.
 * @param {number} length Length of data in bytes.
 */
Bandwidth.prototype.addElement = function(startTime, endTime, length) {
  var element = {
    start: startTime,
    end: endTime,
    length: length
  };

  this.list.push(element);
};

/**
 * Return the kbps of the last element added to the list.
 * @return {number} kbps of last element.
 */
Bandwidth.prototype.lastKbps = function() {
  if (this.list.length == 0)
    return 0;

  var element = this.list[this.list.length - 1];
  var kbps =
      ((element.length * 8) / ((element.end - element.start) / 1000)) / 1000;
  return kbps;
};

/**
 * Return the kilobits per second downloaded averaged over time. The
 * calculation starts from the current time over the past |sec| seconds.
 * @param {number} sec Time in seconds to use to calculate the kbps.
 * @return {number} Calculated kbps. If kbps is 0 than no data was downloaded
 *     over the interval.
 */
Bandwidth.prototype.lastKbpsAvgTime = function(sec) {
  var l = this.list.length;
  if (l == 0)
    return 0;

  var milliNow = new Date().getTime();
  var milliDelta = sec * 1000;
  var milliStart = milliNow - milliDelta;

  var totalMilli = 0;
  var totalBytes = 0;

  for (var i = l - 1; i >= 0; --i) {
    var e = this.list[i];

    if (e.end <= milliStart)
      break;

    var elementMilli = e.end - e.start;
    if (e.start >= milliStart) {
      totalMilli += elementMilli;
      totalBytes += e.length;
    } else {
      var milliChunk = e.end - milliStart;
      totalMilli += milliChunk;
      totalBytes += e.length * (milliChunk / elementMilli);
    }
  }

  var kbps = 0;
  if (totalBytes > 0 && totalMilli > 0)
    kbps = ((totalBytes * 8) / (totalMilli / 1000)) / 1000;

  return kbps;
};
