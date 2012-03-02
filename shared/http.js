// Copyright (c) 2012 The WebM project authors. All Rights Reserved.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file in the root of the source
// tree. An additional intellectual property rights grant can be found
// in the file PATENTS.  All contributing project authors may
// be found in the AUTHORS file in the root of the source tree.

'use strict';

/**
 * Class to download data form a HTTP 1.1 server using XMLHttpRequests.
 * @param {string} url Link to the resource.
 * @param {function} opt_log Option logging function.
 * @constructor
 */
function HttpFile(url, opt_log) {
  this.url_ = url;
  this.fileLength_ = -1;
  this.fileOffset_ = 0;
  this.index_ = 0;
  this.buffer_ = null;
  this.CONTENT_RANGE_REGEX = /^bytes \d+-\d+\/(\d+)$/;
  this.log_ = opt_log || function(str) {};

  this.bandwidth = null;
  this.downloadManager_ = null;
}

/**
 * HTTP Partial Content status code.
 * @const
 * @type {number}
 */
HttpFile.PARTIAL_CONTENT = 206;

/**
 * Download function for a XMLHttpRequest.
 * @param {XMLHttpRequest} r XMLHttpRequest object.
 * @param {number} startTime Time the request was sent.
 * @param {function} cb Callback function.
 * @private
 */
HttpFile.prototype.requestOnLoad_ = function(r, startTime, cb) {
  if (r.status == HttpFile.PARTIAL_CONTENT) {
    var endTime = new Date().getTime();
    var uint8Array = new Uint8Array(r.response);
    if (this.bandwidth)
      this.bandwidth.addElement(startTime, endTime, uint8Array.length);

    var contentRange = r.getResponseHeader('Content-Range');
    var m = this.CONTENT_RANGE_REGEX.exec(contentRange);
    var fileLength = m && m.length >= 2 ? parseInt(m[1], 10) : -1;
    cb(uint8Array, fileLength);
    return;
  }

  cb(null);
};

/**
 * Asynchronous function that starts the download of data. This function does
 * not take into account the current read offset.
 * @param {string} url Link to resource.
 * @param {number} start Start byte offset.
 * @param {number} end End byte offset.
 * @param {function} cb Callback function.
 * @private
 */
HttpFile.prototype.getBytes_ = function(url, start, end, cb) {
  //this.log_("getBytes_(" + url + ", " + start + ", " + end + ")");

  // Currently |downloadManager_| will only be set to variable of the class
  // BandwidthManager. |downloadManager_| if set will try and constrain the
  // bandwidth. For real testing another system should be used.
  if (this.downloadManager_) {
    var t = this;
    this.downloadManager_.downloadBytesRange(url, start, end, cb,
      function(r, startTime, cb) {
        t.requestOnLoad_(r, startTime, cb);
      });
  } else {
    try {
      var r = new XMLHttpRequest();
      var t = this;
      var startTime = 0;
      r.onreadystatechange = function() {
        if (r.readyState == 4) {
          if (r.status != HttpFile.PARTIAL_CONTENT) {
            t.log_('this.status : ' + r.status);
          }
        }
      };

      r.open('GET', url);
      r.setRequestHeader('Range', 'bytes=' + start + '-' + (end - 1));
      r.responseType = 'arraybuffer';
      var t = this;
      r.onload = function() { t.requestOnLoad_(r, startTime, cb); };
      startTime = new Date().getTime();
      r.send();
    } catch (e) {
      this.log_('error : ' + e);
      cb(null);
    }
  }
};

/**
 * Asynchronous function to get |size| in bytes from the resource starting
 * from the read offset and store it in |buffer_|. This function will only
 * download data if it is not stored in |buffer_|.
 * @param {number} size Number of bytes to get.
 * @param {function} doneCallback Return function.
 * @private
 */
HttpFile.prototype.fetchBytes_ = function(size, doneCallback) {
  var available = this.getBytesAvailable();
  if (size < available) {
    doneCallback(true);
    return;
  }

  var start = this.getCurrentOffset();
  var end = start + size;

  if (this.fileLength_ != -1 && end > this.fileLength_)
    end = this.fileLength_;

  var t = this;
  this.getBytes_(this.url_, start, end, function(buf, fileLength) {
    if (!buf) {
      doneCallback(false);
      return;
    }

    var current_offset = t.getCurrentOffset();
    t.fileOffset_ = start;
    t.index_ = current_offset - start;
    t.buffer_ = buf;
    t.fileLength_ = fileLength;

    window.setTimeout(doneCallback, 0, true);
  });
};

/**
 * Getter function.
 * @return {number} Read index into |buffer_|.
 */
HttpFile.prototype.getIndex = function() {
  return this.index_;
};

/**
 * Getter function.
 * @return {Uint8Array} Downloaded data.
 */
HttpFile.prototype.getBuffer = function() {
  return this.buffer_;
};

/**
 * Returns the read offset.
 * @return {number} Current read offset.
 */
HttpFile.prototype.getCurrentOffset = function() {
  return this.fileOffset_ + this.index_;
};

/**
 * Returns the number of bytes left in |buffer_|.
 * @return {number} Bytes left.
 */
HttpFile.prototype.getBytesAvailable = function() {
  return this.buffer_ ? this.buffer_.length - this.index_ : 0;
};

/**
 * Getter function.
 * @return {number} Resource file length in bytes.
 */
HttpFile.prototype.getFileLength = function() {
  return this.fileLength_;
};

/**
 * Increases the read offset by |size| bytes.
 * @param {number} size Size in bytes.
 */
HttpFile.prototype.read = function(size) {
  this.seek(this.getCurrentOffset() + size);
};

/**
 * Sets the read offset to |offset|. Checks to see if |offset| is out of
 * buffer range and resets |buffer_|.
 * @param {number} offset New read offset.
 */
HttpFile.prototype.seek = function(offset) {
  if (this.buffer_ &&
      (offset >= this.fileOffset_) &&
      (offset < this.fileOffset_ + this.buffer_.length)) {
    this.index_ = offset - this.fileOffset_;
  } else {
    this.fileOffset_ = offset;
    this.index_ = 0;
    this.buffer_ = null;
  }
};

/**
 * Asynchronous function to get |size| in bytes from the resource starting
 * from the read offset and store it in |buffer_|. This function may store
 * less than size bytes in |buffer_| if size would have been past the end of
 * the file.
 * @param {number} size Number of bytes to get.
 * @param {function} doneCallback Return function.
 */
HttpFile.prototype.fetchBytes = function(size, doneCallback) {
  this.fetchBytes_(size, doneCallback);
};

/**
 * Asynchronous function to get |size| in bytes from the resource starting
 * from the read offset and store it in |buffer_|. |doneCallback| will return
 * an error if size would have been past the end of the file.
 * @param {number} size Number of bytes to get.
 * @param {function} doneCallback Return function.
 */
HttpFile.prototype.ensureEnoughBytes = function(size, doneCallback) {
  var t = this;
  this.fetchBytes_(size, function(success) {
      doneCallback(t.getBytesAvailable() >= size);
    });
};

/**
 * Downloads bytes from |url| without updating any internal members. The
 * calling function must check if the number of bytes requested were the
 * number of bytes downloaded as the range could have been past the end of the
 * file. The format for callback(buf) is buf {Uint8Array} Returned buffer of\
 * bytes downloaded. Null if there was an error.
 * @param {number} start The starting offset.
 * @param {number} size The number of bytes to download.
 * @param {function} callback Callback.
 */
HttpFile.prototype.fetchBytesUnbuffered = function(start, size, callback) {
  var end = start + size;

  if (this.fileLength_ != -1 && end > this.fileLength_)
    end = this.fileLength_;

  var t = this;
  this.getBytes_(this.url_, start, end, function(buf, fileLength_) {
    t.fileLength_ = fileLength_;
    callback(buf);
  });
};

/**
 * Download manager will route all XMLHttpRequests through the download manager
 * and not this class.
 * @param {object} downloadManager Currently only used for bandwidth limiting.
 */
HttpFile.prototype.setDownloadManager = function(downloadManager) {
  this.downloadManager_ = downloadManager;
};

/**
 * The bandwidth class keeps track of the downloaded data chunks.
 * @param {Bandwidth} bandwidth Bandwidth estimator class.
 */
HttpFile.prototype.setBandwidthEstimator = function(bandwidth) {
  this.bandwidth = bandwidth;
};
