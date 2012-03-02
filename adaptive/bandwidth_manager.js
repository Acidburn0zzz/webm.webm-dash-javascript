// Copyright (c) 2012 The WebM project authors. All Rights Reserved.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file in the root of the source
// tree. An additional intellectual property rights grant can be found
// in the file PATENTS.  All contributing project authors may
// be found in the AUTHORS file in the root of the source tree.

'use strict';

/**
 * Class to emulate network download speed. The class currently will not take
 * into account XMLHttpRequests routed through BandwidthManager in parallel.
 * This class is only to be used for quick testing of constrained download
 * speed. The class will not truly emulate a constrained download connection,
 * but give a rough estimate according to set timers.
 * @param {function} opt_log Option logging function.
 * @constructor
 */
function BandwidthManager(opt_log) {
  //this.downloadBytesPerSecond = 12500; // 100 kbps
  //this.downloadBytesPerSecond = 25000; // 200 kbps
  //this.downloadBytesPerSecond = 37500; // 300 kbps
  //this.downloadBytesPerSecond = 62500; // 500 kbps
  //this.downloadBytesPerSecond = 75000; // 600 kbps
  this.downloadBytesPerSecond = 125000; // 1 Mbps
  //this.downloadBytesPerSecond = 500000; // 4 Mbps
  //this.downloadBytesPerSecond = 625000; // 6 Mbps
  if (opt_log)
    this.log = opt_log;
}

/**
 * HTTP Partial Content status code.
 * @const
 * @type {number}
 */
BandwidthManager.PARTIAL_CONTENT = 206;

/**
 * Logging function to be set by the application.
 * @param {string} str The input string to be logged.
 */
BandwidthManager.prototype.log = function(str) {};

/**
 * Returns the target maximum bandwidth per XMLHttpRequest.
 * @return {number} kilobits per second.
 */
BandwidthManager.prototype.getDownloadKilobitsPerSecond = function() {
  return this.downloadBytesPerSecond * 8 / 1000;
};

/**
 * Sets the target maximum bandwidth per XMLHttpRequest.
 * @param {number} kbps Target maximum bandwidth in kilobits per second.
 */
BandwidthManager.prototype.setDownloadKilobitsPerSecond = function(kbps) {
  this.downloadBytesPerSecond = kbps * 1000 / 8;
};

/**
 * Downloads the requested byte range using XMLHttpRequest. The data will be
 * returned in an ArrayBuffer. The format for downloadCallback(object) is
 * object.r {XMLHttpRequest} Returned good XMLHttpRequest object,
 * object.startTime {number} Time before the XMLHttpRequest was sent,
 * and object.dataCallback {function} dataCallback passed in.
 * @param {string} url Resource link.
 * @param {number} start Starting offset for the Http range header.
 * @param {number} end Ending offset for the Http range header.
 * @param {function} dataCallback Callback to pass the data to the application.
 * @param {function} downloadCallback Callback function.
 */
BandwidthManager.prototype.downloadBytesRange = function(url,
                                                         start,
                                                         end,
                                                         dataCallback,
                                                         downloadCallback) {
  try {
    var r = new XMLHttpRequest();
    var t = this;
    var startTime = 0;
    r.onreadystatechange = function() {
      if (r.readyState == 4) {
        if (r.status != BandwidthManager.PARTIAL_CONTENT) {
          t.log('this.status : ' + r.status);
        }
      }
    };

    r.open('GET', url);
    r.setRequestHeader('Range', 'bytes=' + start + '-' + (end - 1));
    r.responseType = 'arraybuffer';
    r.onload = function() {
      t.onDownloadRange(r, startTime, dataCallback, downloadCallback);
    };
    startTime = new Date().getTime();
    r.send();
  } catch (e) {
    this.log('error : ' + e);
  }
};

/**
 * Callback function for XMLHttpRequest.
 * @param {XMLHttpRequest} r XMLHttpRequest object.
 * @param {number} startTime Time before the XMLHttpRequest was sent.
 * @param {function} dataCallback Callback to pass the data to the application.
 * @param {function} downloadCallback Callback function.
 */
BandwidthManager.prototype.onDownloadRange = function(r,
                                                      startTime,
                                                      dataCallback,
                                                      downloadCallback) {
  if (r.status == BandwidthManager.PARTIAL_CONTENT) {
    var endTime = new Date().getTime();
    var estimateDownloadMilli =
        (r.response.byteLength / this.downloadBytesPerSecond) * 1000;
    var estimateEndTime = startTime + estimateDownloadMilli;

    // Wait the extra time before sending the data.
    if (endTime < estimateEndTime) {
      var waitTime = estimateEndTime - endTime;
      window.setTimeout(function() {
        downloadCallback(r, startTime, dataCallback);
      }, waitTime);
    } else {
      downloadCallback(r, startTime, dataCallback);
    }
  } else {
    downloadCallback(r, startTime, dataCallback);
  }
};
