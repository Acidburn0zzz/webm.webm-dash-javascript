// Copyright (c) 2012 The WebM project authors. All Rights Reserved.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file in the root of the source
// tree. An additional intellectual property rights grant can be found
// in the file PATENTS.  All contributing project authors may
// be found in the AUTHORS file in the root of the source tree.

/**
 * @fileoverview HTTP adaptive video player similar in concept to the video tag.
 *
 * Playback is only for WebM files. The parsing of the level 1 elements is
 * done in javascript and the media data is sent to the video tag through the
 * Media Source API. The streams must consist of separate audio and video.
 *
 * NOTE: This file uses a deprecated version (<= v0.5) of the Media Source API!
         Please see dash_player.js for a current version of the player.
 *
 */

'use strict';

/**
 * Class representing an adaptive WebM file used by the adaptive player. This
 * class includes an instance of a Representation object from the DashParser
 * and a WebM file object to download and parse the data. This class will
 * utilize values from the Representation object to optimize downloading the
 * WebM headers.
 * @constructor
 */
function AdaptiveWebMFile() {
  this.state = AdaptiveWebMFile.HEADERS_NEEDED;
}

/**
 * Headers needed player state.
 * @const
 * @type {number}
 */
AdaptiveWebMFile.HEADERS_NEEDED = 0;

/**
 * Parsing headers player state.
 * @const
 * @type {number}
 */
AdaptiveWebMFile.PARSING_HEADERS = 1;

/**
 * Headers loaded player state.
 * @const
 * @type {number}
 */
AdaptiveWebMFile.HEADERS_LOADED = 2;

/**
 * General error player state.
 * @const
 * @type {number}
 */
AdaptiveWebMFile.ERROR = 6;


/**
 * Object to be set if the downloads should emulate a network download speed.
 * This must be set before the file headers are loaded.
 * @private
 * @type {BandwidthManager}
 */
AdaptiveWebMFile.prototype.bandwidthManager_ = null;

/**
 * An instance of a Representation object from the DashParser.
 * @type {Representation}
 */
AdaptiveWebMFile.prototype.representation = null;

/**
 * A WebM file object.
 * @type {WebMFileParser}
 */
AdaptiveWebMFile.prototype.parser = null;

/**
 * AdaptiveWebMFile state.
 * @type {number}
 */
AdaptiveWebMFile.prototype.state = AdaptiveWebMFile.HEADERS_NEEDED;

/**
 * Logging function to be set by the application.
 * @param {string} str The input string to be logged.
 */
AdaptiveWebMFile.prototype.log = function(str) {};

/**
 * Checks if the file is ready to seek.
 * @return {boolean} Returns true if the file is ready to seek.
 */
AdaptiveWebMFile.prototype.canSeek = function() {
  return this.parser && this.parser.canSeek();
};

/**
 * Loads the header level 1 elements and the Cues element in sequence with
 * offsets from the Representation object. |callback| will return the
 * status upon the successful parsing of both the level 1 header elements and
 * Cues element or an error. The format for callback(object) is
 * obj.status {number} The returned status and
 * [obj.reason] {string} Extra information on the status.
 * @param {function} callback Callback function.
 */
AdaptiveWebMFile.prototype.loadHeader = function(callback) {
  if (!this.representation.url_) {
    var errorStr = 'Rep[' + this.representation.id + '] url is null.';
    callback(new ErrorStatus(errorStr));
    return;
  }

  // TODO(fgalligan): Handle Dash manifests without header ranges.
  var header = this.representation.headerRange();
  if (!header) {
    var errorStr = 'Rep[' + this.representation.id + '] header is not set.';
    callback(new ErrorStatus(errorStr));
    return;
  }

  this.state = AdaptiveWebMFile.PARSING_HEADERS;

  if (!this.parser) {
    this.parser = new WebMFileParser(this.representation.url_);
    if (!this.parser) {
      this.state = AdaptiveWebMFile.ERROR;
      var errorStr = 'Rep[' + this.representation.id +
                     '] Could not create the WebM file parser.';
      callback(new ErrorStatus(errorStr));
      return;
    }

    this.parser.file.setBandwidthEstimator(new Bandwidth());
    // Check global bandwidth manager.
    if (this.bandwidthManager_)
      this.parser.file.setDownloadManager(this.bandwidthManager_);
  }

  this.parser.log = this.log;

  var offset = header[0];
  var size = header[1] - offset;

  var t = this;
  this.parser.parseFirstHeaders(offset, size, function(success) {
    if (success) {
      var index = t.representation.indexRange();
      if (!index) {
        t.state = AdaptiveWebMFile.ERROR;
        var errorStr = 'Rep[' + t.representation.id +
                       '] Error parseFirstHeaders() index is not set.';
        callback(new ErrorStatus(errorStr));
        return;
      }
      offset = index[0];
      size = index[1] - offset;

      // TODO(fgalligan): Think about adding support to the manifest tool to
      // check that all segments in an AdaptationSet have the same offset.
      // Then the player could save the segment offset for use by other vp8
      // files and could skip downloading the header.
      t.parser.fetchCues(offset, size, -1,
          function(success) {t.onLoadHeader(success, callback);});
    } else {
      t.state = AdaptiveWebMFile.ERROR;
      var errorStr =
          'Rep[' + t.representation.id + '] Error parseFirstHeaders().';
      callback(new ErrorStatus(errorStr));
    }
  });
};

/**
 * Callback function for loading the WebM header and Cues elements. The format
 * for callback(object) is obj.status {number} The returned status and
 * [obj.reason] {string} Extra information on the status.
 * @param {boolean} success True if loading the data was successful.
 * @param {function} callback Callback function.
 */
AdaptiveWebMFile.prototype.onLoadHeader = function(success, callback) {
  if (success) {
    this.state = AdaptiveWebMFile.HEADERS_LOADED;
  } else {
    this.state = AdaptiveWebMFile.ERROR;
  }

  // Media Source API will generate an error if the cluster time is less than
  // the time already appended for the same stream.
  var res = this.parser.squishCues();
  if (res.status != WebMParser.STATUS_OK) {
    callback(new ErrorStatus(res.reason));
    return;
  }

  callback(new OKStatus());
};

/**
 * Loads the Cues element with offsets from the Representation object.
 * |callback| will return the status upon the successful parsing of the
 * Cues element or an error. The format for callback(object) is
 * obj.status {number} The returned status and
 * [obj.reason] {string} Extra information on the status.
 * @param {function} callback Callback function.
 */
AdaptiveWebMFile.prototype.loadIndex = function(callback) {
  if (!this.representation.url_) {
    var errorStr = 'Rep[' + this.representation.id + '] url is null.';
    callback(new ErrorStatus(errorStr));
    return;
  }

  //TODO(fgalligan): Handle Dash manifests without index ranges.
  var index = this.representation.indexRange();
  if (!index) {
    var errorStr = 'Rep[' + this.representation.id + '] index is not set.';
    callback(new ErrorStatus(errorStr));
    return;
  }

  this.state = AdaptiveWebMFile.PARSING_HEADERS;

  if (!this.parser) {
    this.parser = new WebMFileParser(this.representation.url_);
    if (!this.parser) {
      this.state = AdaptiveWebMFile.ERROR;
      var errorStr = 'Rep[' + this.representation.id +
                     '] Could not create the WebM file parser.';
      callback(new ErrorStatus(errorStr));
      return;
    }
    this.parser.file.setBandwidthEstimator(new Bandwidth());
    // Check global bandwidth manager.
    if (this.bandwidthManager_)
      this.parser.file.setDownloadManager(this.bandwidthManager_);
  }

  this.parser.log = this.log;

  var duration = this.representation.getDuration();
  if (duration == 0) {
    callback(new ErrorStatus('Error duration == 0'));
    return;
  }
  this.parser.setDuration(duration);

  var offset = index[0];
  var size = index[1] - offset;
  var t = this;
  this.parser.fetchCues(offset, size, -1, function(success) {
    t.onLoadHeader(success, callback);
  });
};

/**
 * Asynchronous function to load the header level 1 elements and the Cues
 * element in parallel with offsets from the Representation object. |callback|
 * will return the status upon the successful parsing of both the level 1 header
 * elements and Cues element or an error. The format for callback(object) is
 * obj.status {number} The returned status and
 * [obj.reason] {string} Extra information on the status.
 * @param {function} callback Callback function.
 */
AdaptiveWebMFile.prototype.loadExtraDataParallel = function(callback) {
  if (!this.representation.url_) {
    var errorStr = 'Rep[' + this.representation.id + '] url is not set.';
    this.log(errorStr);
    callback(new ErrorStatus(errorStr));
    return;
  }

  //TODO(fgalligan): Handle Dash manifests without header ranges.
  var header = this.representation.headerRange();
  if (!header) {
    var errorStr = 'Rep[' + this.representation.id + '] header is not set.';
    callback(new ErrorStatus(errorStr));
    return;
  }

  //TODO(fgalligan): Handle Dash manifests without index ranges.
  var index = this.representation.indexRange();
  if (!index) {
    var errorStr = 'Rep[' + this.representation.id + '] index is not set.';
    callback(new ErrorStatus(errorStr));
    return;
  }

  this.state = AdaptiveWebMFile.PARSING_HEADERS;

  if (!this.parser) {
    this.parser = new WebMFileParser(this.representation.url_);
    if (!this.parser) {
      this.state = AdaptiveWebMFile.ERROR;
      var errorStr =
          'Rep[' + this.representation.id + '] could not create parser.';
      this.log(errorStr);
      callback(new ErrorStatus(errorStr));
      return;
    }
    this.parser.file.setBandwidthEstimator(new Bandwidth());
    // Check global bandwidth manager.
    if (this.bandwidthManager_)
      this.parser.file.setDownloadManager(this.bandwidthManager_);
  }

  this.parser.log = this.log;

  // Load the header elements and Cues element in parallel.
  var t = this;
  var headersParsed = false;
  var cuesParsed = false;
  var offset = header[0];
  var size = header[1] - offset;

  this.parser.parseFirstHeadersUnbuffered(offset, size, function(success) {
    if (success) {
      if (cuesParsed) {
        t.state = AdaptiveWebMFile.HEADERS_LOADED;
        // Media Source API will generate an error if the cluster time is
        // less than the time already appended for the same stream.
        // Switching in the middle of cluster is waste of bandwidth.
        var res = t.parser.squishCues();
        if (res.status != WebMParser.STATUS_OK) {
          t.state = AdaptiveWebMFile.ERROR;
          var errorStr =
              'Rep[' + t.representation.id + '] could not squish cues.';
          t.log(errorStr);
          callback(new ErrorStatus(errorStr));
        }
        callback(new OKStatus());
      }
      headersParsed = true;
    } else {
      t.state = AdaptiveWebMFile.ERROR;
      var errorStr =
          'Rep[' + t.representation.id + '] could not parse headers.';
      t.log(errorStr);
      callback(new ErrorStatus(errorStr));
    }
  });

  offset = index[0];
  size = index[1] - offset;
  this.parser.fetchCues(offset, size, -1, function(success) {
    if (success) {
      if (headersParsed) {
        t.state = AdaptiveWebMFile.HEADERS_LOADED;
        var res = t.parser.squishCues();
        if (res.status != WebMParser.STATUS_OK) {
          callback(res);
          return;
        }
        callback(new OKStatus());
      }
      cuesParsed = true;
    } else {
      t.state = AdaptiveWebMFile.ERROR;
      var errorStr = 'Rep[' + t.representation.id + '] could not parse Cues.';
      t.log(errorStr);
      callback(new ErrorStatus(errorStr));
    }
  });
};

/**
 * Sets the bandwidth manager.
 * @param {BandwidthManager} manager Global bandwidth manager.
 */
AdaptiveWebMFile.prototype.setBandwidthManager = function(manager) {
  this.bandwidthManager_ = manager;
};

/**
 * A WebM stream used by the adaptive player. The player should only have one
 * AdaptiveWebMStream per stream type. e.g. One for video and one for audio. The
 * AdaptiveWebMStream has a list AdaptiveWebMFiles that are used to switch
 * between seamlessly.
 * @constructor
 */
function AdaptiveWebMStream() {
  this.reset();
}

/**
 * Flag telling if this stream can switch seamlessly.
 * @private
 * @type {boolean}
 */
AdaptiveWebMStream.prototype.checkSwitching_ = false;

/**
 * List of cue chunk description objects.
 * @type {object}
 */
AdaptiveWebMStream.prototype.cueDescQueue = null;

/**
 * List of data buffers.
 * @type {object}
 */
AdaptiveWebMStream.prototype.clusterQueue = null;

/**
 * Max number of elements in the |clusterQueue| and |cueDescQueue| lists.
 * @type {number}
 */
AdaptiveWebMStream.prototype.clusterQueueThreshold = 30;

/**
 * Number of bytes downloaded for the current Cue chunk.
 * @private
 * @type {number}
 */
AdaptiveWebMStream.prototype.cueBytesDownloaded_ = 0;

/**
 * Flag telling if this stream currently fetching data.
 * @private
 * @type {boolean}
 */
AdaptiveWebMStream.prototype.fetchingClusters_ = false;

/**
 * Flag telling if this stream has no more cluster data to fetch.
 * @private
 * @type {boolean}
 */
AdaptiveWebMStream.prototype.endOfClusters_ = false;

/**
 * Start time of the cue chunk for the data last sent to the video tag.
 * @private
 * @type {number}
 */
AdaptiveWebMStream.prototype.lastTimeSent_ = 0;

/**
 * Current WebM file associated with the stream.
 * @type {AdaptiveWebMFile}
 */
AdaptiveWebMStream.prototype.source = null;

/**
 * Resets all properties to the default state.
 */
AdaptiveWebMStream.prototype.reset = function() {
  this.resetStreamData();
  this.source = null;
};

/**
 * Resets all properties to the default state, except for the source.
 */
AdaptiveWebMStream.prototype.resetStreamData = function() {
  this.checkSwitching_ = false;
  this.cueDescQueue = [];
  this.clusterQueue = [];
  this.clusterQueueThreshold = 30;
  this.cueBytesDownloaded_ = 0;
  this.fetchingClusters_ = false;
  this.endOfClusters_ = false;
  this.lastTimeSent_ = 0;
};

/**
 * Returns the first cluster in the queue.
 * @return {Uint8Array} The first cluster in the queue or null if there are
 *     no clusters.
 */
AdaptiveWebMStream.prototype.front = function() {
  var data = null;

  if (this.clusterQueue.length > 0) {
    this.lastTimeSent_ = this.cueDescQueue[0].endTime;
    data = this.clusterQueue.shift();
    this.cueDescQueue.shift();
  }

  return data;
};

/**
 * Returns the first cluster in the queue if the start time is <= |time|.
 * @param {number} time Time in seconds to check against.
 * @return {Uint8Array} The first cluster in the queue or null if there are
 *     no clusters or they are later than |time|.
 */
AdaptiveWebMStream.prototype.checkFront = function(time) {
  var data = null;

  if (this.clusterQueue.length > 0) {
    var cue = this.cueDescQueue[0];
    if (cue.time <= time) {
      data = this.clusterQueue.shift();
      this.cueDescQueue.shift();
      this.lastTimeSent_ = cue.endTime;
    }
  }

  return data;
};

/**
 * Checks if the cluster queue is empty.
 * @return {boolean} Returns true if the cluster queue is empty.
 */
AdaptiveWebMStream.prototype.empty = function() {
  return this.clusterQueue.length == 0;
};

/**
 * Check if a new cluster may be added.
 * @return {boolean} Returns true if a new cluster may be added to the stream.
 */
AdaptiveWebMStream.prototype.addNewCluster = function() {
  return (!this.endOfClusters_ && !this.fetchingClusters_ &&
          this.clusterQueue.length < this.clusterQueueThreshold);
};

/**
 * An HTML5 adaptive player for WebM which uses the Media Source API. The
 *     manifest format follows the WebM Dash guidelines.
 * @param {string} url Link to the manifest file.
 * @param {Element} videoElement The <video> element.
 * @param {BandwidthManager} opt_manager Optional bandwidth manager.
 * @param {function} opt_log Optional logging function.
 * @constructor
 */
function DashPlayer(url, videoElement, opt_manager, opt_log) {
  this.url_ = url;
  this.videoElement = videoElement;
  this.bandwidthManager_ = opt_manager;
  if (opt_log)
    this.log = opt_log;
  this.adaptiveStreams_ = {};
  this.webMFilesMap_ = {};
  this.eventCallbacks_ = {};

  this.mediaSourceVersion_ = 0.3;
  if (this.videoElement.webkitSourceAddId)
    this.mediaSourceVersion_ = 0.5;

  this.log('Created DashPlayer. this.mediaSourceVersion_:' +
           this.mediaSourceVersion_);

  var t = this;
  this.videoElement.addEventListener('webkitsourceopen', function() {
    t.doOpen(function() {
      //t.loadFirstHeaders_();
      t.loadFirstHeadersParallel_();
    });
  });
  this.videoElement.addEventListener('webkitsourceended', function() {
    t.doEnded();
  });
  this.videoElement.addEventListener('webkitsourceclose', function() {
    t.doClose();
  });
  this.videoElement.addEventListener('webkitneedkey', function(e) {
    t.doNeedKey(e);
  });
  this.videoElement.addEventListener('webkitkeymessage', function(e) {
    t.doKeyMessage(e);
  });
  this.videoElement.addEventListener('webkitkeyadded', function() {
    t.doKeyAdded();
  });
  this.videoElement.addEventListener('seeking', function() {
    t.doSeeking();
  });

  this.videoElement.src = videoElement.webkitMediaSourceURL;
}

/**
 * Stopped player state.
 * @const
 * @type {number}
 */
DashPlayer.STOPPED = 0;

/**
 * Parsing headers player state.
 * @const
 * @type {number}
 */
DashPlayer.PARSING_HEADERS = 1;

/**
 * Loading player state.
 * @const
 * @type {number}
 */
DashPlayer.LOADING = 2;

/**
 * Seeking player state.
 * @const
 * @type {number}
 */
DashPlayer.SEEKING = 3;

/**
 * General error player state.
 * @const
 * @type {number}
 */
DashPlayer.ERROR = 6;

/**
 * Static function to return version string.
 * @return {string} version.
 */
DashPlayer.version = function() {
  return '0.2.3.0';
};

/**
 * Static function to return version strings from DashPlayer, DashParser, and
 * WebMParser.
 * @return {string} version strings.
 */
DashPlayer.versionStringsHTML = function() {
  var str = 'DashPlayer:' + DashPlayer.version() + '<br/>' +
            ' DashParser:' + DashParser.version() + '<br/>' +
            ' WebMParser:' + WebMParser.version();
  return str;
};

/**
 * Static function convert DashPlayer state to string.
 * @param {number} state DashPlayer state.
 * @return {string} String representation of DashPlayer state.
 */
DashPlayer.stateToString = function(state) {
  var retStr = 'UNKNOWN';
  switch (state) {
    case DashPlayer.STOPPED:
      retStr = 'STOPPED';
      break;
    case DashPlayer.PARSING_HEADERS:
      retStr = 'PARSING_HEADERS';
      break;
    case DashPlayer.LOADING:
      retStr = 'LOADING';
      break;
    case DashPlayer.SEEKING:
      retStr = 'SEEKING';
      break;
    case DashPlayer.ERROR:
      retStr = 'ERROR';
      break;
  }

  return retStr;
};

/**
 * Checks if the AdaptationSet is valid for this player.
 * @param {AdaptationSet} as AdaptationSet to validate.
 * @return {Object} Status object.
 */
DashPlayer.validateAdaptationSet = function(as) {
  if (!as)
    return new ErrorStatus('AdaptationSet is null');
 // TODO(fgalligan): Add support for manifests that do not have AdaptationSet
 // ids.
  if (!as.id)
    return new ErrorStatus('AdaptationSet has no id');
  if (as.representationList.length > 1 && !as.getSubsegmentAlignment())
    return new ErrorStatus('SubsegmentAlignment is false');
  if (as.getSubsegmentStartsWithSAP() != 1)
    return new ErrorStatus('SubsegmentStartsWithSAP != 1');

  // TODO(fgalligan): Add support for AdaptationSets with bitstreamSwitching
  // set to false.
  if (as.representationList.length > 1 && !as.getBitstreamSwitching())
    return new ErrorStatus('bitstreamSwitching is false');

  return new OKStatus();
};

/**
 * Checks if the Representation is valid for this player.
 * @param {Representation} representation Representation to validate.
 * @return {Object} Status object.
 */
DashPlayer.validateRepresentation = function(representation) {
  if (!representation)
    return new ErrorStatus('Representation is null');
  if (!representation.getFullURL())
    return new ErrorStatus('Representation URL is null');
  if (!representation.headerRange())
    return new ErrorStatus('Representation headerRange is null');
  if (!representation.indexRange())
    return new ErrorStatus('Representation indexRange is null');
  if (representation.getMimetype().search(/webm/i) == -1)
    return new ErrorStatus('Mimetype is not WebM.');
  if (representation.getCodecs().search(/vp8/i) == -1 &&
      representation.getCodecs().search(/vorbis/i) == -1)
    return new ErrorStatus('Codecs does not contain VP8 or Vobis.');
  return new OKStatus();
};


/**
 * Object to be set if the downloads should emulate a network download speed.
 * @private
 * @type {BandwidthManager}
 */
DashPlayer.prototype.bandwidthManager_ = null;

/**
 * Current state of the player.
 * @type {number}
 */
DashPlayer.prototype.state = DashPlayer.STOPPED;

/**
 * Video tag the player is using.
 * @type {Element}
 */
DashPlayer.prototype.videoElement = null;

/**
 * The mpd describing the manifest.
 * @type {MPD}
 */
DashPlayer.prototype.mpd = null;

/**
 * The current time in seconds the player should seek too.
 * @type {number}
 */
DashPlayer.prototype.seekTime = 0;

/**
 * Incrementing counter of seek requests.
 * @type {number}
 */
DashPlayer.prototype.seekSequenceNum = 0;

/**
 * Adaptive streams used by the player. The player will only have one
 * AdaptiveWebMStream per stream type. E.g. One for video and one for audio.
 * @private
 * @type {Object.<AdaptiveWebMStream>}
 */
DashPlayer.prototype.adaptiveStreams_ = null;

/**
 * Time in seconds that one stream is allowed to get ahead in append data.
 * @type {number}
 */
DashPlayer.prototype.audioVideoBufferThreshold = 30;

/**
 * Object containing named callbacks. Below is the list of the current named
 * events and their parameters.
 * [chunk_download] parameters({Object})
 *     Object.type {string} Stream type. (e.g. 'audio | 'video')
 *     Object.id {string} Representation id.
 *     Object.time {number} Chunk start time in seconds.
 *     Object.endTime {number} Chunk end time in seconds.
 * @private
 * @type {Object}
 */
DashPlayer.prototype.eventCallbacks_ = null;

/**
 * Current Period from the presentation.
 * @type {Period}
 */
DashPlayer.prototype.period = null;

/**
 * List of all the WebM files from the presentation inserted by their
 * AdaptationSet and representation ids from the manifest. The key is of the
 * form '<AdaptationSet>-<representation id>'.
 * @private
 * @type {Representation}
 */
DashPlayer.prototype.webMFilesMap_ = null;

/**
 * The source ID string for Media Source API.
 * @private
 * @type {string}
 */
DashPlayer.prototype.mediaSourceIDString_ = 'source1';

/**
 * Media Source API version.
 * @private
 * @type {number}
 */
DashPlayer.prototype.mediaSourceVersion_ = 0.3;

/**
 * Logging function to be set by the application.
 * @param {string} str The input string to be logged.
 */
DashPlayer.prototype.log = function(str) {};

/**
 * Sets a callback to a named event for the player. Only one callback is allowed
 * per named event. Below is the list of the current named events.
 * [chunk_download]
 *
 * @param {string} name Name of the event to set the callback for.
 * @param {function} callback Function to call for named event.
 */
DashPlayer.prototype.setEventListener = function(name, callback) {
  this.eventCallbacks_[name] = callback;
};

/**
 * Removes a callback to a named event. Only one callback is allowed
 * per named event. If the named event has been set it will be set to null.
 * @param {string} name Name of the event to remove the callback for.
 */
DashPlayer.prototype.removeEventListener = function(name) {
  if (this.eventCallbacks_[name])
    this.eventCallbacks_[name] = null;
};


/**
 * Handle Media Source webkitsourceopen event. Parses the Dash manifest if it
 * has not been parsed yet. Sets up the media streams.
 * @param {function} setupStreamsFunction Function used to setup the adaptive
 *     media streams.
 * @return {Object} Status object.
 */
DashPlayer.prototype.doOpen = function(setupStreamsFunction) {
  this.log('doOpen() : ');
  if (this.state != DashPlayer.STOPPED) {
    var errorStr = 'ERROR doOpen() STOPPED != state:' +
                   DashPlayer.stateToString(this.state);
    this.log(errorStr);
    return new ErrorStatus(errorStr);
  }

  if (this.dashParser == null) {
    var res = this.parseManifest(function() {
      setupStreamsFunction();
    });
    if (res.status != ErrorStatus.STATUS_OK)
      return res;
  } else {
    setupStreamsFunction();
  }

  return new OKStatus();
};

/**
 * Handle Media Source webkitsourceended event.
 */
DashPlayer.prototype.doEnded = function() {
  this.log('doEnded() : ');
};

/**
 * Handle Media Source webkitsourceclose event.
 */
DashPlayer.prototype.doClose = function() {
  this.log('doClose() : ');

  if (this.state == DashPlayer.STOPPED) {
    return;
  }

  this.changeState(DashPlayer.STOPPED);
};

/**
 * Handle video tag seeking event. Setup the player to seek to the time
 * specified in the video tag.
 */
DashPlayer.prototype.doSeeking = function() {
  this.seekSequenceNum += 1;
  this.seekTime = this.videoElement.currentTime;

  this.log('doSeeking ' + this.seekTime + ' newSeqNum:' + this.seekSequenceNum);

  if (this.state == DashPlayer.SEEKING) {
    this.log('Already seeking...');
    return;
  }

  this.changeState(DashPlayer.SEEKING);

  if (this.mediaSourceVersion_ == 0.5)
    this.videoElement.webkitSourceAbort(this.mediaSourceIDString_);

  var vid = this.adaptiveStreams_['video'];
  if (vid.fetchingClusters_) {
    // We have to wait until we finish fetching clusters
    // before we can do the seek
    this.log('doSeeking() Waiting for videoFetchingClusters to finish.');
    return;
  }

  var aud = this.adaptiveStreams_['audio'];
  if (aud && aud.fetchingClusters_) {
    this.log('doSeeking() Waiting for audioFetchingClusters to finish.');
    return;
  }

  this.startSeek();
};

/**
 * Add the specified key to the Media Element.
 * @param {Uint8Array} key The key.
 * @param {Uint8Array} initData initData corresponding to the key.
 * @param {string} sessionId sessionId corresponding to the key.
 */
DashPlayer.prototype.addKey = function(key, initData, sessionId) {
  this.log('Adding key for the following sessionId: ' + sessionId);
  this.videoElement.webkitAddKey('webkit-org.w3.clearkey',
                                 key, initData, sessionId);
};

/**
 * Handles responses to license request XHR.
 * @this {XMLHttpRequest}
 */
function handleLicenseResponse() {
  if (this.status == 200 && this.response != null) {
    var key = new Uint8Array(this.response);
    this.playerPrototype.addKey(key, this.message, this.sessionId);
    return;
  }
  alert('Error obtaining key!');
}

/**
 * Sends a request for a license to the server.
 * @param {Uint8Array} message unique key identifier extracted from the
 *     initData parameter of generateKeyRequest().
 * @param {string} sessionId sessionId corresponding to the requested key.
 * @param {DashPlayer.prototype} playerPrototype requesting the key.
 */
function requestLicense(message, sessionId, playerPrototype) {
  var licenseUrl = 'key.bin';

  var xhr = new XMLHttpRequest();
  xhr.message = message;  // Store to pass as initData parameter in addKey().
  xhr.sessionId = sessionId;  // Store so can associate with key in response.
  xhr.playerPrototype = playerPrototype;  // Store for reference in callback.
  xhr.responseType = 'arraybuffer';  // Can easily convert to a Uint8Array.
  xhr.onload = handleLicenseResponse;
  // Because the demo runs on a simple web sever, we must use GET.
  // A more realistic solution is:
  // var licenseUrl = 'license.example.com';
  // var licenseRequest = message;
  // xhr.open('POST', licenseUrl, true);
  // xhr.send(licenseRequest);
  xhr.open('GET', licenseUrl);
  xhr.send();
}

/**
 * Handle Media Element needkey event.
 * @param {MediaKeyEvent} e Need key event.
 */
DashPlayer.prototype.doNeedKey = function(e) {
  this.log('doNeedKey() : ');
  this.log('Need key for the following ID: ' + e.initData);
  this.videoElement.webkitGenerateKeyRequest('webkit-org.w3.clearkey',
                                             e.initData);
};

/**
 * Handle Media Element keymessage event.
 * @param {MediaKeyEvent} e Need key event.
 */
DashPlayer.prototype.doKeyMessage = function(e) {
  this.log('doKeyMessage() : ');
  if (e.keySystem != 'webkit-org.w3.clearkey') {
    this.log('event.keySystem not supported :' + e.keySystem);
    this.reportParseError();
    return;
  }

  // Because the demo runs on a simple web sever, we must use GET.
  // A more realistic solution would pass e.message to a key server.
  requestLicense(e.message, e.sessionId, this);
};

/**
 * Handle Media Element keyadded event.
 */
DashPlayer.prototype.doKeyAdded = function() {
  this.log('doKeyAdded() : ');
};

/**
 * Tells the video tag there was a parsing error on the stream.
 */
DashPlayer.prototype.reportParseError = function() {
  this.changeState(DashPlayer.ERROR);
  if (this.videoElement.webkitSourceState == HTMLMediaElement.SOURCE_OPEN)
    this.videoElement.webkitSourceEndOfStream(HTMLMediaElement.EOS_DECODE_ERR);
};

/**
 * Appends WebM data to the video tag.
 * @param {Uint8Array} data WebM data.
 */
DashPlayer.prototype.appendData = function(data) {
  if (this.state != DashPlayer.LOADING)
    this.log('Error appendData() state != LOADING state:' + this.state +
             ' data.length:' + data.length);

  if (this.state == DashPlayer.LOADING) {
    if (this.mediaSourceVersion_ == 0.5) {
      this.videoElement.webkitSourceAppend(this.mediaSourceIDString_, data);
    } else {
      this.videoElement.webkitSourceAppend(data);
    }
  }
};

/**
 * Tells the video tag there is no more data for all streams.
 */
DashPlayer.prototype.endOfStream = function() {
  this.videoElement.webkitSourceEndOfStream(HTMLMediaElement.EOS_NO_ERROR);
};


/**
 * Creates WebM files and inserts them into the player's map. Checks if the
 * AdaptationSets and Representations are valid for this player.
 * @return {Object} Status object.
 */
DashPlayer.prototype.mapWebMFiles = function() {
  if (this.mpd.getProfiles() != 'urn:webm:dash:profile:webm-on-demand:2012')
    return new ErrorStatus('WebM On-Demand != profile:' + profile);

  var period = this.period;
  for (var i = 0; i < period.adaptationSetList.length; ++i) {
    var as = period.adaptationSetList[i];

    if (as) {
      var res = DashPlayer.validateAdaptationSet(as);
      if (res.status == ErrorStatus.STATUS_OK) {
        for (var j = 0; j < as.representationList.length; ++j) {
          var representation = as.representationList[j];
          if (representation) {
            var res = DashPlayer.validateRepresentation(representation);
            if (res.status == ErrorStatus.STATUS_OK) {
              var webm = new AdaptiveWebMFile();
              webm.log = this.log;
              webm.representation = representation;
              webm.setBandwidthManager(this.bandwidthManager_);
              var key = as.id + '-' + representation.id;
              this.webMFilesMap_[key] = webm;
            }
          }
        }
      }
    }
  }

  return new OKStatus();
};

/**
 * Callback for the Manifest load function. Sets the presentation and creates
 * the WebM files mapped to the presentation.
 * @param {Object} res Status object.
 * @return {Object} Status object.
 */
DashPlayer.prototype.parseManifestCallback = function(res) {
  if (res.status != ErrorStatus.STATUS_OK) {
    var errorStr = 'Could not parse manifest. reason:' + res.reason;
    this.log(errorStr);
    return new ErrorStatus(errorStr);
  }

  this.mpd = this.dashParser.mpd;
  if (!this.mpd) {
    var errorStr = 'MPD is null.';
    this.log(errorStr);
    return new ErrorStatus(errorStr);
  }

  // TODO(fgalligan): Think about checking if the video tag's width and height
  // have been set in the page and not including video streams that have a
  // much higher resolution.

  // Pick the first Period.
  // TODO(fgalligan): Add support for manifests that have more than one Period.
  this.period = this.mpd.periodList[0];
  if (!this.period) {
    var errorStr = 'Period is null.';
    this.log(errorStr);
    return new ErrorStatus(errorStr);
  }

  var res = this.mapWebMFiles();
  if (res.status != ErrorStatus.STATUS_OK)
    this.log('Error setting up WebM files. :' + res.reason);

  // Check if the video tag's width and height have not been set. If not set
  // the width and height to the maximum height and the width that corresponds
  // with the maximum height. This is done for presentations that change
  // resolution.
  if (this.videoElement.width == 0 && this.videoElement.height == 0) {
    var webmVideo = this.findVideoMaxHeight();
    if (webmVideo) {
      this.videoElement.width = webmVideo.representation.getWidth();
      this.videoElement.height = webmVideo.representation.getHeight();
    }
  }

  return res;
};

/**
 * Parses the manifest file. If this.url_ is null return an error.
 * @param {function} openCallback Callback function.
 * @return {Object} Status object.
 */
DashPlayer.prototype.parseManifest = function(openCallback) {
  this.log('parseManifest url' + this.url_);
  if (!this.url_)
    return new ErrorStatus('parseManifest DashPlayer url_ == null.');

  this.dashParser = new DashParser(this.url_);
  this.dashParser.log = this.log;

  var t = this;
  this.dashParser.load(function(res) {
    var localRes = t.parseManifestCallback(res);
    if (localRes.status != ErrorStatus.STATUS_OK) {
      t.onParseHeadersDone(false);
    } else {
      openCallback();
    }
  });

  return new OKStatus();
};

/**
 * Return the current AdaptationSet associated with video. Return null if the
 * AdaptationSet is not ready.
 * @return {AdaptationSet} current video AdaptationSet.
 */
DashPlayer.prototype.getVideoAdaptationSet = function() {
  var vid = this.adaptiveStreams_['video'];
  if (!vid || !vid.source || !vid.source.representation)
    return null;

  return vid.source.representation.parent;
};

/**
 * Picks the first audio and video stream to start playback with.
 * @return {Object} Status object.
 * @private
 */
DashPlayer.prototype.initializeFirstStreams_ = function() {
  this.changeState(DashPlayer.PARSING_HEADERS);
  var webmAudio = this.findFirstAudioStream();

  // Decide which video stream to play first.
  var webmVideo = this.findVideoLowsetBandwidth();
  if (!webmVideo) {
    this.onParseHeadersDone(false);
    return new ErrorStatus('Could not find video from presentation');
  }

  var vid = new AdaptiveWebMStream();
  vid.source = webmVideo;
  vid.checkSwitching_ = true;
  this.adaptiveStreams_['video'] = vid;

  if (webmAudio) {
    var aud = new AdaptiveWebMStream();
    aud.source = webmAudio;
    this.adaptiveStreams_['audio'] = aud;
  }

  if (this.mediaSourceVersion_ == 0.5) {
    var codecStr = 'video/webm; codecs="vp8"';
    if (this.adaptiveStreams_['video'] && this.adaptiveStreams_['audio']) {
      codecStr = 'video/webm; codecs="vp8, vorbis"';
    } else if (this.adaptiveStreams_['audio']) {
      codecStr = 'video/webm; codecs="vorbis"';
    }
    this.videoElement.webkitSourceAddId(this.mediaSourceIDString_, codecStr);
  }

  return new OKStatus();
};

/**
 * Loads the headers for the WebM files the player is starting playback with
 * in sequence.
 * @return {Object} Status object.
 * @private
 */
DashPlayer.prototype.loadFirstHeaders_ = function() {
  //this.log('loadFirstHeaders_()');
  var res = this.initializeFirstStreams_();
  if (res.status != ErrorStatus.STATUS_OK)
    return res;

  var vid = this.adaptiveStreams_['video'];
  var aud = this.adaptiveStreams_['audio'];
  var t = this;
  if (aud) {
    aud.source.loadHeader(function(res) {
      if (res.status != ErrorStatus.STATUS_OK) {
        t.onParseHeadersDone(false);
      } else {
        vid.source.loadHeader(function(res) {
          t.onParseHeadersDone(res.status == ErrorStatus.STATUS_OK);
        });
      }
    });
  } else {
    vid.source.loadHeader(function(res) {
      t.onParseHeadersDone(res.status == ErrorStatus.STATUS_OK);
    });
  }

  return new OKStatus();
};

/**
 * Loads the headers for the WebM files the player is starting playback with in
 * parallel to reduce start-up latency.
 * @return {Object} Status object.
 * @private
 */
DashPlayer.prototype.loadFirstHeadersParallel_ = function() {
  //this.log('loadFirstHeadersParallel_()');
  var res = this.initializeFirstStreams_();
  if (res.status != ErrorStatus.STATUS_OK)
    return res;

  var vid = this.adaptiveStreams_['video'];
  var aud = this.adaptiveStreams_['audio'];
  var t = this;
  if (aud) {
    var audioDownloaded = false;
    var videoDownloaded = false;

    aud.source.loadExtraDataParallel(function(res) {
      if (res.status != ErrorStatus.STATUS_OK) {
        t.onParseHeadersDone(false);
      } else {
        if (videoDownloaded) {
          t.onParseHeadersDone(true);
        }
        audioDownloaded = true;
      }
    });

    vid.source.loadExtraDataParallel(function(res) {
      if (res.status != ErrorStatus.STATUS_OK) {
        t.onParseHeadersDone(false);
      } else {
        if (audioDownloaded) {
          t.onParseHeadersDone(true);
        }
        videoDownloaded = true;
      }
    });
  } else {
    vid.source.loadExtraDataParallel(function(res) {
      t.onParseHeadersDone(res.status == ErrorStatus.STATUS_OK);
    });
  }

  return new OKStatus();
};

/**
 * Callback when the headers of all streams have been parsed. Synthesize and
 * sends the header data to the Media Source as the first data blob. Starts
 * loading the WebM clusters.
 * @param {boolean} success False if there was an error.
 */
DashPlayer.prototype.onParseHeadersDone = function(success) {
  this.log('onParseHeadersDone() returned ' + success);

  if (!success) {
    this.log('Failed to parse the headers');
    this.reportParseError();
    return;
  }

  var vid = this.adaptiveStreams_['video'];
  var aud = this.adaptiveStreams_['audio'];

  var info = vid.source.parser.getInfo();
  if (!info) {
    this.log('Info is null!');
    this.reportParseError();
    return;
  }

  var tracks = null;
  if (aud) {
    var res = this.createTracksElement();
    if (res.status != ErrorStatus.STATUS_OK) {
      this.log('Failed to create Tracks element. :' + res.reason);
      this.reportParseError();
      return;
    }
    tracks = res.value;
  } else {
    tracks = vid.source.parser.getTracks();
    if (!tracks) {
      this.log('Tracks is null!');
      this.reportParseError();
      return;
    }
  }

  var infoTracks = new Uint8Array(info.length + tracks.length);
  infoTracks.set(info, 0);
  infoTracks.set(tracks, info.length);

  this.changeState(DashPlayer.LOADING);
  this.appendData(infoTracks);

  this.loadFirstClusters();
};

/**
 * Starts asynchronously loading the WebM clusters for the current streams.
 * Then it will download the header and seek index of the other streams
 * asynchronously.
 */
DashPlayer.prototype.loadFirstClusters = function() {
  var vid = this.adaptiveStreams_['video'];
  var aud = this.adaptiveStreams_['audio'];

  var res = vid.source.parser.getFirstCueDesc();
  if (res.status != WebMParser.STATUS_OK) {
    this.log('Could not get video first cueDesc! reason:' + res.reason);
    this.reportParseError();
  }
  vid.cueDesc = res.value;

  if (aud) {
    res = aud.source.parser.getFirstCueDesc();
    if (res.status != WebMParser.STATUS_OK) {
      this.log('Could not get audio first cueDesc! reason:' + res.reason);
      this.reportParseError();
    }
    aud.cueDesc = res.value;
  }

  //this.sendClusters();
  this.fetchPartialClusters();

  var t = this;
  // Download the headers and seek indices for the rest of the media files.
  window.setTimeout(function() { t.downloadAllMediaInfo(); });
};

/**
 * Sends one cluster if queued for each of the current streams. Checks to see
 * if all of the current streams are out of data. Then gets more WebM clusters.
 */
DashPlayer.prototype.sendClusters = function() {
  var vid = this.adaptiveStreams_['video'];
  var aud = this.adaptiveStreams_['audio'];

  if (aud) {
    var data = aud.checkFront(vid.lastTimeSent_);
    if (data) {
      //this.log('sendClusters() Rep[' + aud.source.representation.id +
      //         '] data.length:' + data.length);
      this.appendData(data);
    }
  }

  data = vid.front();
  if (data) {
    //this.log('sendClusters() Rep[' + vid.source.representation.id +
    //         '] data.length:' + data.length);
    this.appendData(data);
  }

  // Check if the streams are finished.
  if (vid.endOfClusters_) {
    if (aud) {
      if (aud.endOfClusters_)
        this.endOfStream();
    } else {
      this.endOfStream();
    }
  }

  // Fetch more clusters from the network to fill the queue back up.
  this.fetchMoreClusters();
};

/**
 * Checks and downloads more WebM data for each stream.
 */
DashPlayer.prototype.fetchMoreClusters = function() {
  // Check to make sure video stream does not get to far ahead of the audio
  // stream.
  var delta = 0;
  var vid = this.adaptiveStreams_['video'];
  var aud = this.adaptiveStreams_['audio'];

  if (aud)
    delta = vid.cueDesc.time - aud.cueDesc.time;

  if (vid.addNewCluster() && delta < this.audioVideoBufferThreshold) {
    vid.fetchingClusters_ = true;
    var seqNumVid = this.seekSequenceNum;

    //this.logCue('fetchMoreClusters getClusterFromCueDesc ', vid.source.id,
    //            seqNumVid, vid.cueDesc, -1, vid.cueBytesDownloaded_, null);

    var t = this;
    vid.source.parser.getClusterFromCueDesc(vid.cueDesc, 0,
        function(nextCueDesc, buf) {
          t.onClusterDownloadedDesc(vid, nextCueDesc, seqNumVid, buf);
        });
  }

  //Check to make sure audio stream does not get to far ahead of the video
  // stream.
  if (aud) {
    delta = aud.cueDesc.time - vid.cueDesc.time;

    if (aud.addNewCluster() && delta < this.audioVideoBufferThreshold) {
      aud.fetchingClusters_ = true;
      var seqNumAud = this.seekSequenceNum;

      //this.logCue('fetchMoreClusters getClusterFromCueDesc ', aud.source.id,
      //            seqNumAud, aud.cueDesc, -1, aud.cueBytesDownloaded_, null);

      var t = this;
      aud.source.parser.getClusterFromCueDesc(aud.cueDesc, 0,
          function(nextCueDesc, buf) {
            t.onClusterDownloadedDesc(aud, nextCueDesc, seqNumAud, buf);
          });
    }
  }
};

/**
 * Callback function for parser.GetCluster. This function will add the cluster
 * to the stream cluster queue and send a notification to check if the player
 * should send a cluster to the video tag.
 * @param {AdaptiveWebMStream} webmStream The stream the data is from.
 * @param {Object} nextCueDesc The next Cue description object. If null
 *     then the current Cue is the last Cue.
 * @param {number} seqNum Seek sequence number.
 * @param {Uint8Array} buf Cluster data.
 */
DashPlayer.prototype.onClusterDownloadedDesc = function(webmStream,
                                                        nextCueDesc,
                                                        seqNum,
                                                        buf) {
  var stream = webmStream;
  var t = this;
  if (this.state == DashPlayer.SEEKING) {
    this.logCue('onCluster() state == SEEKING', stream.source.representation.id,
                seqNum, stream.cueDesc, buf.length, stream.cueBytesDownloaded_,
                nextCueDesc);
    stream.fetchingClusters_ = false;
    window.setTimeout(function() { t.startSeek();});
    return;
  }

  if (this.state == DashPlayer.STOPPED) {
    this.logCue('onCluster() state == STOPPED', stream.source.representation.id,
                seqNum, stream.cueDesc, buf.length, stream.cueBytesDownloaded_,
                nextCueDesc);
    stream.fetchingClusters_ = false;
    return;
  }

  if (this.state != DashPlayer.LOADING) {
    this.log('onCluster() : unexpected state ' + this.state);
    stream.fetchingClusters_ = false;
    return;
  }

  //Check to see if a seek happened while we were getting the cluster.
  if (seqNum != this.seekSequenceNum) {
    this.logCue('onCluster() != this.seekSequenceNum' + this.seekSequenceNum,
                stream.source.representation.id, seqNum, stream.cueDesc,
                buf.length, stream.cueBytesDownloaded_, nextCueDesc);
    stream.fetchingClusters_ = false;
    return;
  }

  if (!buf) {
    this.log('onCluster() id:' + stream.source.representation.id +
             ' Error !buf');
    stream.fetchingClusters_ = false;
    stream.endOfClusters_ = true;
    this.reportParseError();
    return;
  }

  stream.cueBytesDownloaded_ += buf.length;

  //this.logCue('onCluster() ', stream.source.representation.id, seqNum,
  //            stream.cueDesc, buf.length, stream.cueBytesDownloaded_,
  //            nextCueDesc);

  stream.clusterQueue.push(buf);
  stream.cueDescQueue.push(stream.cueDesc);

  // If |stream.cueDesc.size| is -1 then the cluster is in the last CUE
  // element. Keep reading clusters until |buf| == null.
  if (stream.cueBytesDownloaded_ == stream.cueDesc.size) {

    // The player has downloaded all of the clusters within the current CUE
    // element.
    stream.fetchingClusters_ = false;

    if (this.eventCallbacks_['chunk_download']) {
      var streamType = 'audio';
      var vid = this.adaptiveStreams_['video'];
      if (vid.source == stream.source)
        streamType = 'video';
      var data = {
        type: streamType,
        id: stream.source.representation.id,
        time: stream.cueDesc.time,
        endTime: stream.cueDesc.endTime
      };
      this.eventCallbacks_['chunk_download'](data);
    }

    stream.cueBytesDownloaded_ = 0;

    if (nextCueDesc == null) {
      stream.endOfClusters_ = true;
      this.log('onCluster() id:' + stream.source.representation.id +
               ' Last Cue. endOfClusters_ = true.');
    } else {
      stream.cueDesc = nextCueDesc;
      if (stream.checkSwitching_)
        //this.checkVideoStreamDuration();
        this.checkVideoStreamFutureTime();
    }
    window.setTimeout(function() { t.sendClusters();});
  } else {
    window.setTimeout(function() { t.sendClusters();});

    if (!stream.endOfClusters_ &&
        stream.clusterQueue.length < stream.clusterQueueThreshold) {
      var seqNum = this.seekSequenceNum;

      //this.logCue('onCluster() getClusterFromCueDesc ',
      //            stream.source.representation.id, seqNum, stream.cueDesc,
      //            -1, stream.cueBytesDownloaded_, null);

      stream.source.parser.getClusterFromCueDesc(stream.cueDesc,
                                                 stream.cueBytesDownloaded_,
                                                 function(nextCueDesc, buf) {
        t.onClusterDownloadedDesc(stream, nextCueDesc, seqNum, buf);
      });
    }
  }
};

/**
 * Tells the player to transition into seeking mode. The seek time must be set
 * in |this.seekTime|. The player will check if it is okay to transition into
 * seeking mode and afterwards will start downloading WebM data from the seek
 * time.
 */
DashPlayer.prototype.startSeek = function() {
  this.log('startSeek()');

  var vid = this.adaptiveStreams_['video'];
  if (vid.fetchingClusters_) {
    this.log('startSeek() Waiting for videoFetchingClusters to finish.');
    return;
  }

  var aud = this.adaptiveStreams_['audio'];
  if (aud && aud.fetchingClusters_) {
    this.log('startSeek() Waiting for audioFetchingClusters to finish.');
    return;
  }

  vid.resetStreamData();
  vid.checkSwitching_ = true;

  if (aud)
    aud.resetStreamData();

  var seekTime = this.seekTime;
  this.log('Seeking to ' + seekTime);

  var res = vid.source.parser.getCueDescFromTime(seekTime);
  if (res.status != WebMParser.STATUS_OK) {
    this.log('startSeek() getCueDescFromTime on video failed. seekTime:' +
             seekTime + ' :' + res.reason);
    return;
  }
  vid.cueDesc = res.value;

  if (aud) {
    var res = aud.source.parser.getCueDescFromTime(seekTime);
    if (res.status != WebMParser.STATUS_OK) {
      this.log('startSeek() getCueDescFromTime on audio failed. seekTime:' +
               seekTime + ' :' + res.reason);
      return;
    }
    aud.cueDesc = res.value;
  }
  this.changeState(DashPlayer.LOADING);

  // These two functions perform the same action. sendClusters() will download
  // complete clusters before sending the data to AppendStream.
  // fetchPartialClusters() may download partial clusters and send the data to
  // AppendStream to reduce latency.
  //this.sendClusters();
  this.fetchPartialClusters();
};

/**
 * Changes the player state.
 * @param {number} newState State to change the player too.
 */
DashPlayer.prototype.changeState = function(newState) {
  this.log('changeState() : ' + this.state + ' -> ' + newState);
  this.state = newState;
};

/**
 * Returns the amount of time in seconds buffered in the video tag from the
 * current play back time.
 * @return {number} Seconds the video tag is buffered.
 */
DashPlayer.prototype.getSecondsBufferedAhead = function() {
  var now = this.videoElement.currentTime;
  var ranges = this.videoElement.buffered;
  var l = ranges.length;
  for (var i = 0; i < l; ++i) {
    if ((ranges.start(i) <= now) &&
        (ranges.end(i) >= now)) {
      return (ranges.end(i) - now);
    }
  }

  return 0;
};

/**
 * Searches all of the representation objects within the first video
 * AdaptationSet that has the lowest bandwidth and returns the WebM file
 * associated with that representation object.
 * @return {AdaptiveWebMFile} A WebM file or null if there were no files.
 */
DashPlayer.prototype.findVideoLowsetBandwidth = function() {
  if (!this.period)
    return null;

  var representation = null;

  // Use vp8 string as a search parameter for a video stream.
  var as = this.period.findFirstAdaptationSet(/vp8/i);
  if (as) {
    var mediaBandwidth = Number.MAX_VALUE;
    var l = as.representationList.length;
    for (var i = 0; i < l; ++i) {
      var bandwidth = as.representationList[i].bandwidth;
      if (bandwidth < mediaBandwidth) {
        representation = as.representationList[i];
        var key = as.id + '-' + representation.id;
        if (this.webMFilesMap_[key] != null) {
          mediaBandwidth = bandwidth;
        }
      }
    }
  }

  var webMFile = null;
  if (as && representation) {
    var key = as.id + '-' + representation.id;
    webMFile = this.webMFilesMap_[key];
  }
  return webMFile;
};

/**
 * Returns the next media file from the current presentation according to
 * their bandwidth from the manifest.
 * @param {Object} webm The WebM file to start from.
 * @param {number} direction Greater than 0 will get the next file with a
 *     higher bandwidth. Less than or equal to 0 will get the next file with
 *     a lower bandwidth.
 * @return {AdaptiveWebMFile} A WebM file or null if there were no more files.
 */
DashPlayer.prototype.findVideoNextBandwidth = function(webm, direction) {
  var newWebM = null;
  if (direction > 0) {
    newWebM = this.findNextHighestBandwidth(webm);
  } else {
    newWebM = this.findNextLowestBandwidth(webm);
  }
  return newWebM;
};

/**
 * Returns the next media file from the current presentation with a lower
 * bandwidth from the manifest.
 * @param {Object} webm The WebM file to start from.
 * @return {AdaptiveWebMFile} A WebM file or null if there were no more files
 *     with a lower bandwidth.
 */
DashPlayer.prototype.findNextLowestBandwidth = function(webm) {
  if (!this.period)
    return null;

  var as = webm.representation.parent;
  var bandwidth = webm.representation.bandwidth;
  var nextWebM = null;
  var l = as.representationList.length;
  for (var i = 0; i < l; ++i) {
    var mediaCheck = as.representationList[i];

    if (mediaCheck.bandwidth < bandwidth &&
        (!nextWebM || mediaCheck.bandwidth > nextWebM.bandwidth)) {
      var key = as.id + '-' + mediaCheck.id;
      if (this.webMFilesMap_[key] != null) {
        nextWebM = mediaCheck;
      }
    }
  }

  var webMFile = null;
  if (as && nextWebM) {
    var key = as.id + '-' + nextWebM.id;
    webMFile = this.webMFilesMap_[key];
  }
  return webMFile;
};

/**
 * Returns the next media file from the current presentation with a higher
 * bandwidth from the manifest.
 * @param {Object} webm The WebM file to start from.
 * @return {AdaptiveWebMFile} A WebM file or null if there were no more files
 *     with a higher bandwidth.
 */
DashPlayer.prototype.findNextHighestBandwidth = function(webm) {
  if (!this.period)
    return null;

  var as = webm.representation.parent;
  var bandwidth = webm.representation.bandwidth;
  var nextWebM = null;
  var l = as.representationList.length;
  for (var i = 0; i < l; ++i) {
    var mediaCheck = as.representationList[i];

    if (mediaCheck.bandwidth > bandwidth &&
        (!nextWebM || mediaCheck.bandwidth < nextWebM.bandwidth)) {
      var key = as.id + '-' + mediaCheck.id;
      if (this.webMFilesMap_[key] != null) {
        nextWebM = mediaCheck;
      }
    }
  }

  var webMFile = null;
  if (as && nextWebM) {
    var key = as.id + '-' + nextWebM.id;
    webMFile = this.webMFilesMap_[key];
  }
  return webMFile;
};

/**
 * Searches all of the representation objects within the first video
 * AdaptationSet that has the largest height and returns that representation
 * object.
 * @return {AdaptiveWebMFile} A WebM file or null if there were no
 *     representation objects.
 */
DashPlayer.prototype.findVideoMaxHeight = function() {
  if (!this.period)
    return null;

  //Use vp8 string as a search parameter for a video stream.
  var as = this.period.findFirstAdaptationSet(/vp8/i);
  if (!as)
    return null;

  var maxHeight = 0;
  var index = -1;

  // find starting index
  var l = as.representationList.length;
  for (var i = 0; i < l; ++i) {
    var representation = as.representationList[i];
    var height = representation.getHeight();

    if (height > maxHeight) {
      var key = as.id + '-' + representation.id;
      if (this.webMFilesMap_[key] != null) {
        maxHeight = height;
        index = i;
      }
    }
  }

  if (index == -1)
    return null;

  var key = as.id + '-' + as.representationList[index].id;
  return this.webMFilesMap_[key];
};

/**
 * Returns the first WebM file within the first audio AdaptationSet.
 * @return {AdaptiveWebMFile} A WebM file or null if there were no WebM files.
 */
DashPlayer.prototype.findFirstAudioStream = function() {
  if (!this.period)
    return null;

  // Use vorbis string as a search parameter for an audio stream.
  var as = this.period.findFirstAdaptationSet(/vorbis/i);
  if (!as)
    return null;

  var key = as.id + '-' + as.representationList[0].id;
  return this.webMFilesMap_[key];
};

/**
 * Searches all of the WebM files within the current AdaptationSet that
 * have not downloaded their headers. If a WebM file is found that does not
 * have the header downloaded, it will make a call to download the WebM
 * file's header. The loadHeader call will also download the byte-to-offset
 * mapping.
 */
DashPlayer.prototype.downloadAllMediaInfo = function() {
  var vid = this.adaptiveStreams_['video'];
  var as = vid.source.representation.parent;

  if (as) {
    var l = as.representationList.length;
    for (var i = 0; i < l; ++i) {

      var representation = as.representationList[i];

      // Check to see if the headers have not been downloaded.
      var key = as.id + '-' + representation.id;
      var webMFile = this.webMFilesMap_[key];
      if (!webMFile || webMFile.state != AdaptiveWebMFile.HEADERS_NEEDED) {
        continue;
      }
      var t = this;
      // TODO(fgalligan): VP8 does not need any initialization data for the
      // stream to decode. But without parsing the WebM Segment element there
      // is no way to get the segment offset, which is needed for the Cues
      // element. Figure out a way to get the segment offset without parsing
      // the header. For reference the old manifest format included the
      // segment offset.
      var vp8CodecPattern = /nothing/i; // /vp8/i;
      if (as.codecs_.search(vp8CodecPattern) != -1) {
        webMFile.loadIndex(function(res) {
          t.onDownloadHeadersDone(res.status == ErrorStatus.STATUS_OK);
        });
      } else {
        webMFile.loadHeader(function(res) {
          t.onDownloadHeadersDone(res.status == ErrorStatus.STATUS_OK);
        });
      }
      break;
    }
  }
};

/**
 * Callback when stream headers have been parsed.
 * @param {boolean} success False if there was an error.
 */
DashPlayer.prototype.onDownloadHeadersDone = function(success) {
  //this.log('onDownloadHeadersDone() returned ' + success);
  var t = this;
  window.setTimeout(function() { t.downloadAllMediaInfo();});
};

/**
 * The algorithm will switch to the next file in the current AdaptationSet.
 * This is a very basic example of how to switch files.
 */
DashPlayer.prototype.rotateVideoStream = function() {
  var vid = this.adaptiveStreams_['video'];
  if (!vid.source)
    return;

  var switchWebM = this.findVideoNextBandwidth(vid.source, 1);
  if (!switchWebM)
    switchWebM = this.findVideoLowsetBandwidth();

  if (switchWebM)
    this.switchVideoStream(switchWebM);
};

/**
 * Checks whether the player should switch video streams based on current
 * bandwidth. The function checks buffer level 120 seconds into the
 * future and then will decide if it should switch up or down. The function
 * will check to see if the video buffer time will drop below 5 seconds. If it
 * does it will try and switch down to a stream that will keep the buffer
 * level above 5 seconds. If the first check has buffer level above 15 seconds
 * after 120 seconds then the function will perform the same test on
 * the next stream up and if the buffer level is over 15 seconds
 * again it will switch up only one stream.
 */
DashPlayer.prototype.checkVideoStreamFutureTime = function() {
  var vid = this.adaptiveStreams_['video'];
  if (!this.period)
    return;

  var as = vid.source.representation.parent;

  if (as) {
    var l = as.representationList.length;
    if (l == 0)
      return;

    var bandwidth = vid.source.parser.file.bandwidth.lastKbpsAvgTime(5);
    var now = this.videoElement.currentTime;
    var vid = this.adaptiveStreams_['video'];
    // The problem with using buffered is that with two separate streams one
    // of them will most likely be ahead of the other.
    var buffered = this.getSecondsBufferedAhead();
    var debugStr = 'vTag.now:' + now.toFixed(3) +
                   ' vTag.buffer:' + buffered.toFixed(3) +
                   ' vLastTS:' + vid.lastTimeSent_.toFixed(3);
    var aud = this.adaptiveStreams_['audio'];
    if (aud) {
      debugStr += ' aLastTS:' + aud.lastTimeSent_.toFixed(3);
    }
    debugStr += ' kbps:' + bandwidth.toFixed();
    this.log(debugStr);

    var buffer = vid.lastTimeSent_ - now;
    var timeList = [120];
    var buffers = this.calculateBuffer(vid.cueDesc.time,
                                       timeList,
                                       vid.source,
                                       bandwidth,
                                       buffer);
    var buffer120sec = buffers[0].buffer;
    var debugStr = 'rep=' + vid.source.representation.id +
        ' buf=' + buffer.toFixed() + ' band=' + bandwidth.toFixed() +
        '  sec:' + buffers[0].seconds.toFixed(3) +
        '  fbuf:' + buffer120sec.toFixed(3);
    this.log(debugStr);

    var switchWebM = null;
    var switching = 0;
    if (buffer120sec < 5) {
      // The player should switch down. Check to see if it should switch down
      // more than one stream.
      var currentVideo = vid.source;

      for (var i = 0; i < l; ++i) {
        var nextWebM = this.findVideoNextBandwidth(currentVideo, -1);
        switching--;

        if (!nextWebM) {
          // Assume there were no more representation elements to try.
          // |switchWebM| will be on the lowest bitrate stream.
          break;
        }

        var buffers = this.calculateBuffer(vid.cueDesc.time,
                                           timeList,
                                           nextWebM,
                                           bandwidth,
                                           buffer);
        buffer120sec = buffers[0].buffer;
        debugStr = 'DOWN rep=' + nextWebM.representation.id +
            ' buf=' + buffer.toFixed() + ' band=' + bandwidth.toFixed() +
            '  sec:' + buffers[0].seconds.toFixed(3) +
            '  fbuf:' + buffer120sec.toFixed(3);
        this.log(debugStr);

       switchWebM = nextWebM;

        if (buffer120sec < 5) {
          // Move down another stream and try again.
          currentVideo = nextWebM;
        } else {
          break;
        }
      }
    } else if (buffer120sec > 15) {
      // Switch up.
      var nextWebM = this.findVideoNextBandwidth(vid.source, 1);

      if (nextWebM) {
        var buffers = this.calculateBuffer(vid.cueDesc.time,
                                           timeList,
                                           nextWebM,
                                           bandwidth,
                                           buffer);
        buffer120sec = buffers[0].buffer;
        debugStr = 'UP  rep=' + nextWebM.representation.id +
            ' buf=' + buffer.toFixed() + ' band=' + bandwidth.toFixed() +
            '  sec:' + buffers[0].seconds.toFixed(3) +
            '  fbuf:' + buffer120sec.toFixed(3);
        this.log(debugStr);

        if (buffer120sec > 15) {
          // Move up another stream.
          switchWebM = nextWebM;
        }
      }
    }

    if (switchWebM) {
      var res = this.switchVideoStream(switchWebM);
      if (res.status != ErrorStatus.STATUS_OK) {
        this.log('Could not switch stream. :' + res.reason);
      }
    }
  }
};

/**
 * Checks whether the player should switch video streams based on current
 * bandwidth. The function checks if the current video stream will have a
 * buffer under-run at the current bandwidth. If it thinks it will have an
 * under-run it will check the lower streams until it finds a stream that it
 * thinks will play through the entire presentation without an under-run. If it
 * doesn't find a stream it will pick the lowest bitrate stream. If the first
 * check does not think it will have a buffer under-run it will check to see if
 * the next stream higher will have an under-run. If not it will switch up one
 * higher stream.
 */
DashPlayer.prototype.checkVideoStreamDuration = function() {
  if (!this.period)
    return;

  var vid = this.adaptiveStreams_['video'];
  var as = vid.source.representation.parent;

  if (as) {
    var l = as.representationList.length;
    if (l == 0)
      return;

    var bandwidth = vid.source.parser.file.bandwidth.lastKbpsAvgTime(5);
    var now = this.videoElement.currentTime;
    var vid = this.adaptiveStreams_['video'];

    /*
    // The problem with using buffered is that with two separate streams one
    // of them will most likely be ahead of the other.
    var buffered = this.getSecondsBufferedAhead();
    var debugStr = 'vTag.now:' + now.toFixed(3) +
                   ' vTag.buffer:' + buffered.toFixed(3) +
                   ' vLastTS:' + vid.lastTimeSent_.toFixed(3);
    var aud = this.adaptiveStreams_['audio'];
    if (aud) {
      debugStr += ' aLastTS:' + aud.lastTimeSent_.toFixed(3);
    }
    debugStr += ' kbps:' + bandwidth.toFixed();
    this.log(debugStr);
    */

    var buffer = vid.lastTimeSent_ - now;
    var node = vid.source.parser.bufferSizeAfterTimeDownloaded(
        vid.cueDesc.time,
        this.mpd.duration,
        bandwidth,
        0,
        buffer);
    if (node.status != WebMParser.STATUS_OK) {
      this.log('Error calculating download time for representation id:' +
               vid.source.representation.id + ' :' + node.reason);
      return;
    }

    /*
    this.log('node id:' + vid.source.representation.id +
             ' underrun:' + node.underrun +
             ' downloadTime:' + node.downloadTime.toFixed(3) +
             ' buffer:' + node.buffer.toFixed(3));
    */
    if (node.status == WebMParser.STATUS_OK) {
      var switchWebM = null;

      if (node.underrun == true) {
        // Move down streams until the player finds a stream that it can play
        // or it gets to the lowest stream.
        var nextWebM = this.findVideoNextBandwidth(vid.source, -1);

        while (nextWebM) {
          switchWebM = nextWebM;

          node = switchWebM.parser.bufferSizeAfterTimeDownloaded(
              vid.cueDesc.time,
              1000000,
              bandwidth,
              0,
              buffer);
          /*
          if (node.status == WebMParser.STATUS_OK)
            this.log('node DOWN id:' + switchWebM.representation.id +
                     ' underrun:' + node.underrun +
                     ' downloadTime:' + node.downloadTime.toFixed(3) +
                     ' buffer:' + node.buffer.toFixed(3));
          */
          if (node.status == WebMParser.STATUS_OK && node.underrun != true) {
            break;
          }

          nextWebM = this.findVideoNextBandwidth(switchWebM, -1);
        }
      } else {
        // Check to see if the player can move up one stream.
        var nextWebM = this.findVideoNextBandwidth(vid.source, 1);
        if (nextWebM && nextWebM.parser) {
          node = nextWebM.parser.bufferSizeAfterTimeDownloaded(
              vid.cueDesc.time, 1000000, bandwidth, 0, buffer);
          /*
          if (node.status == WebMParser.STATUS_OK)
            this.log('node UP id:' + nextWebM.representation.id +
              ' underrun:' + node.underrun +
              ' downloadTime:' + node.downloadTime.toFixed(3) +
              ' buffer:' + node.buffer.toFixed(3));
          */
          if (node.status == WebMParser.STATUS_OK && node.underrun != true) {
            switchWebM = nextWebM;
          }
        }
      }

      if (switchWebM) {
        var res = this.switchVideoStream(switchWebM);
        if (res.status != ErrorStatus.STATUS_OK) {
          this.log('Could not switch stream. :' + res.reason);
        }
      }
    }
  }
};

/**
 * Calculates buffer levels for the array of times passed in.
 * @param {number} startTime The starting time of the stream.
 * @param {Array.<number>} timeList List of times to be processed.
 * @param {Object} webMFile The file to perform the calculations on.
 * @param {number} bandwidth The download rate in kilobits per second.
 * @param {number} buffer The current amount of time in the buffer in seconds.
 * @return {Array.<Object>} The list of return objects from bufferSizeAfterTime.
 */
DashPlayer.prototype.calculateBuffer = function(startTime,
                                                    timeList,
                                                    webMFile,
                                                    bandwidth,
                                                    buffer) {
  var rv = new Array();
  for (var i = 0; i < timeList.length; ++i) {
    var node = webMFile.parser.bufferSizeAfterTime(startTime,
                                                   timeList[i],
                                                   bandwidth,
                                                   buffer);
    rv.push(node);
  }

  return rv;
};

/**
 * Switches the current video playback stream within the AdaptationSet.
 * @param {Object} switchWebM The WebM file object to set as the video stream.
 * @return {Object} The status object.
 */
DashPlayer.prototype.switchVideoStream = function(switchWebM) {
  if (!this.period)
    return new ErrorStatus('switchVideoStream period is null.');
  if (!switchWebM)
    return new ErrorStatus('switchWebM is null.');

  var vid = this.adaptiveStreams_['video'];
  if (vid.source != switchWebM) {
    if (!switchWebM.canSeek())
      return new ErrorStatus('switchWebM id:' + switchWebM.representation.id +
                             ' cannot seek.');

    this.log('Switching... curr_id:' + vid.source.representation.id +
             ' new_id:' + switchWebM.representation.id);

    var vid = this.adaptiveStreams_['video'];
    var res = switchWebM.parser.getCueDescFromTime(vid.cueDesc.time);
    if (res.status != WebMParser.STATUS_OK) {
      this.log('switchVideoStream() getCueDescFromTime failed. seekTime:' +
               seekTime + ' :' + res.reason);
      return res;
    }
    var cue = res.value;

    if (cue) {
      // Check to see if the next cluster for the switch stream is not
      // less then next cluster of the current stream. This is to guard
      // against AdaptationSets that are not aligned.
      if (cue.time >= vid.cueDesc.time) {
        vid.source = switchWebM;
        vid.cueDesc = cue;
      }
    }
  }

  return new OKStatus();
};

/**
 * Creates a WebM Tracks element from an audio and a video Track element. This
 * is needed for the Media Source API because it assumes the the data is muxed
 * in one WebM segment.
 * @return {Uint8Array} The Tracks element.
 * @return {Object} The status object. {Object}.value returns the Tracks
 *     element.
 */
DashPlayer.prototype.createTracksElement = function() {
  // Only create a tracks element if there is separate audio and video.
  var vid = this.adaptiveStreams_['video'];
  var aud = this.adaptiveStreams_['audio'];
  if (!vid.source || !aud)
    return new ErrorStatus('Video or audio file is null.');
  if (aud.source.parser.getTrackObjectLength() != 1)
    return new ErrorStatus('Could not get audio track length.');
  if (vid.source.parser.getTrackObjectLength() != 1)
    return new ErrorStatus('Could not get video track length.');

  var audioTrackObject = aud.source.parser.getTrackObject(0);
  var videoTrackObject = vid.source.parser.getTrackObject(0);

  var tracksElementHeader = new Uint8Array([0x16, 0x54, 0xAE, 0x6B,
                                            0x01, 0x00, 0x00, 0x00,
                                            0x00, 0x00, 0x00, 0x00]);
  var headerSize = tracksElementHeader.length;
  var dataSize = audioTrackObject.buf.length + videoTrackObject.buf.length;
  var tracksElement = new Uint8Array(headerSize + dataSize);
  tracksElement.set(tracksElementHeader, 0);
  tracksElement.set(videoTrackObject.buf, headerSize);
  tracksElement.set(audioTrackObject.buf,
                    headerSize + videoTrackObject.buf.length);
  var tmp = dataSize;
  for (var i = 0; i < 7; ++i) {
    tracksElement[11 - i] = tmp & 0xff;
    tmp >>= 8;
  }

  return {status: ErrorStatus.STATUS_OK, value: tracksElement};
};

/**
 * Helper logging function for cueDesc objects.
 * @param {string} str Text to prepend to the log message.
 * @param {string} id The representation object's id.
 * @param {number} seqNum The seeking context.
 * @param {Object} currentCueDesc The current cueDesc object.
 * @param {number} bufSize The size of the buffer downloaded.
 * @param {number} readOffset The stream's read offset in bytes.
 * @param {Object} nextCueDesc The next cueDesc object.
 */
DashPlayer.prototype.logCue = function(str,
                                       id,
                                       seqNum,
                                       currentCueDesc,
                                       bufSize,
                                       readOffset,
                                       nextCueDesc) {
  var output = str + ' m:' + id + ' seqNum:' + seqNum;

  if (currentCueDesc) {
    output += ' off:' + currentCueDesc.offset +
    ' time:' + currentCueDesc.time.toFixed(3) +
    ' endTime:' + currentCueDesc.endTime.toFixed(3) +
    ' size:' + currentCueDesc.size;
  }

  output += ' bufSize:' + bufSize + ' bufRead:' + readOffset;

  if (nextCueDesc) {
    output += ' nextOff:' + nextCueDesc.offset +
    ' nextTime:' + nextCueDesc.time.toFixed(3) +
    ' nextEndTime:' + nextCueDesc.endTime.toFixed(3) +
    ' nextSize:' + nextCueDesc.size;
  }

  this.log(output);
};

/**
 * Downloads WebM data for all streams. Checks to make sure player can accept
 * more data and that one stream is not too far ahead in time of the other
 * streams. Player must be able to handle more than one call back with data.
 */
DashPlayer.prototype.fetchPartialClusters = function() {
  // Check to make sure video stream does not get to far ahead of the audio
  // stream.
  var delta = 0;
  var vid = this.adaptiveStreams_['video'];
  var aud = this.adaptiveStreams_['audio'];

  if (aud)
    delta = vid.cueDesc.time - aud.cueDesc.time;

  //this.log('fetchPartialClusters video addNewCluster():' +
  //         vid.addNewCluster() + ' delta:' + delta);

  if (vid.addNewCluster() && delta < this.audioVideoBufferThreshold) {
    vid.fetchingClusters_ = true;
    var seqNumVid = this.seekSequenceNum;

    //this.logCue('fetchPartialClusters get cluster ',
    //            vid.source.representation.id, seqNumVid, vid.cueDesc, -1,
    //            vid.cueBytesDownloaded_, null);

    var t = this;
    vid.source.parser.fetchCueData(vid.cueDesc, function(nextCueDesc, buf) {
      t.onPartialCueDescDownload(vid, nextCueDesc, seqNumVid, buf);
    });
  }

  // Check to make sure audio stream does not get to far ahead of the video
  // stream.
  if (aud) {
    delta = aud.cueDesc.time - vid.cueDesc.time;

    //this.log('fetchPartialClusters audio addNewCluster():' +
    //  aud.addNewCluster() + ' delta:' + delta);

    if (aud.addNewCluster() && delta < this.audioVideoBufferThreshold) {
      aud.fetchingClusters_ = true;
      var seqNumAud = this.seekSequenceNum;

      //this.logCue('fetchPartialClusters get cluster ',
      //            aud.source.representation.id, seqNumAud, aud.cueDesc, -1,
      //            aud.cueBytesDownloaded_, null);

      var t = this;
      aud.source.parser.fetchCueData(aud.cueDesc, function(nextCueDesc, buf) {
        t.onPartialCueDescDownload(aud, nextCueDesc, seqNumAud, buf);
      });
    }
  }
};

/**
 * Callback function for parser.fetchCueData. This function will add the
 * data from the current cue chunk to the stream clusterQueue and send a
 * notification to check if the player should send the data to the video tag.
 * If |nextCueDesc| is the same as the current cue chunk then |buf| is part
 * of the current Cue. This function will keep being called until all of the
 * data in the Cue chunk has been downloaded or there was an error. Once all
 * of the data in the cluster has been downloaded fetchPartialClusters will be
 * called to download the next cluster. If the next cluster is null that
 * signals the end of the stream.
 * @param {Object} webmStream Stream that has downloaded data.
 * @param {Object} nextCueDesc The next Cue description object. If null
 *     then the current Cue is the last Cue.
 * @param {number} seqNum Seek sequence number.
 * @param {Uint8Array} buf Cluster data.
 * @return {boolean} If true tells the calling function to request more data
 *     for the current Cue chunk.
 */
DashPlayer.prototype.onPartialCueDescDownload = function(webmStream,
                                                         nextCueDesc,
                                                         seqNum,
                                                         buf) {
  var stream = webmStream;
  var cueFinished = (nextCueDesc) ?
                      stream.cueDesc.offset != nextCueDesc.offset :
                      true;
  var t = this;
  if (this.state == DashPlayer.SEEKING) {
    this.logCue('onPartialCluster() state == SEEKING',
                stream.source.representation.id, seqNum, stream.cueDesc,
                buf.length, stream.cueBytesDownloaded_, nextCueDesc);
    if (cueFinished) {
      stream.fetchingClusters_ = false;
      window.setTimeout(function() { t.startSeek();});
    }
    return stream.fetchingClusters_;
  }

  if (this.state == DashPlayer.STOPPED) {
    this.logCue('onPartialCluster() state == STOPPED',
                stream.source.representation.id, seqNum, stream.cueDesc,
                buf.length, stream.cueBytesDownloaded_, nextCueDesc);
    stream.fetchingClusters_ = false;
    return stream.fetchingClusters_;
  }

  if (this.state != DashPlayer.LOADING) {
    this.log('onPartialCluster() : unexpected state ' + this.state);
    stream.fetchingClusters_ = false;
    return stream.fetchingClusters_;
  }

  //Check to see if a seek happened while we were getting the cluster.
  if (seqNum != this.seekSequenceNum) {
    this.logCue('onPartialCluster() != this.seekSequenceNum:' +
                this.seekSequenceNum, stream.source.representation.id, seqNum,
                stream.cueDesc, buf.length, stream.cueBytesDownloaded_,
                nextCueDesc);
    // Wait for the current cluster to finish completely.
    if (cueFinished)
      stream.fetchingClusters_ = false;
    return stream.fetchingClusters_;
  }

  if (!buf) {
    this.log('onPartialCluster() id:' + stream.source.representation.id +
             ' Error !buf');
    stream.fetchingClusters_ = false;
    stream.endOfClusters_ = true;
    this.reportParseError();
    return stream.fetchingClusters_;
  }

  stream.cueBytesDownloaded_ += buf.length;

  //this.logCue('onPartialCluster() ', stream.source.representation.id, seqNum,
  //            stream.cueDesc, buf.length, stream.cueBytesDownloaded_,
  //            nextCueDesc);

  stream.clusterQueue.push(buf);
  stream.cueDescQueue.push(stream.cueDesc);

  if (cueFinished) {
    // The player has downloaded all of the clusters within the current CUE
    // element.
    stream.fetchingClusters_ = false;

    if (this.eventCallbacks_['chunk_download']) {
      var streamType = 'audio';
      var vid = this.adaptiveStreams_['video'];
      if (vid.source == stream.source)
        streamType = 'video';
      var data = {
        type: streamType,
        id: stream.source.representation.id,
        time: stream.cueDesc.time,
        endTime: stream.cueDesc.endTime
      };
      this.eventCallbacks_['chunk_download'](data);
    }

    stream.cueBytesDownloaded_ = 0;

    if (nextCueDesc == null) {
      // Last cluster.
      this.log('onPartialCluster() id:' + stream.source.representation.id +
               ' End of clusters. endTime:' + stream.cueDesc.endTime);
      stream.endOfClusters_ = true;
    } else {
      stream.cueDesc = nextCueDesc;
      if (stream.checkSwitching_)
        //this.checkVideoStreamDuration();
        this.checkVideoStreamFutureTime();

      this.fetchPartialClusters();
    }
  }

  window.setTimeout(function() { t.sendPartialClusters();});

  return stream.fetchingClusters_;
};

/**
 * Sends partial cluster if queued for each of the current streams. Checks to
 * see if all of the current streams are out of data and end of stream.
 */
DashPlayer.prototype.sendPartialClusters = function() {
  var vid = this.adaptiveStreams_['video'];
  var aud = this.adaptiveStreams_['audio'];
  var data = null;

  if (aud) {
    if (vid.endOfClusters_ && vid.empty()) {
      // Check if the audio has one or more clusters with a start time later
      // than the last video cluster and the video clusters have all been sent.
      // This check is to make sure to send monotonically increasing clusters.
      data = aud.front();
    } else {
      data = aud.checkFront(vid.lastTimeSent_);
    }
    if (data) {
      //this.log('Send Audio length:' + data.length +
      //         ' time:' + aud.lastTimeSent_ +
      //         ' queue size:' + aud.clusterQueue.length);
      this.appendData(data);
    }
  }

  data = vid.front();
  if (data) {
    //this.log('Send Video length:' + data.length +
    //         ' time:' + vid.lastTimeSent_ +
    //         ' queue size:' + vid.clusterQueue.length);
    this.appendData(data);
  }

  // Check if the streams are finished.
  if (vid.endOfClusters_ && vid.empty()) {
    if (aud) {
      // Empty all of the audio data.
      if (!aud.empty()) {
        var t = this;
        window.setTimeout(function() { t.sendPartialClusters();});
      }
      else if (aud.endOfClusters_) {
        this.endOfStream();
      }
    } else {
      this.endOfStream();
    }
  }
};
