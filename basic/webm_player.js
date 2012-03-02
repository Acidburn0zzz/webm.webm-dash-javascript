// Copyright (c) 2012 The WebM project authors. All Rights Reserved.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file in the root of the source
// tree. An additional intellectual property rights grant can be found
// in the file PATENTS.  All contributing project authors may
// be found in the AUTHORS file in the root of the source tree.

'use strict';

function WebMPlayer(url, videoTag, wid) {
  this.STOPPED = 0;
  this.PARSING_HEADERS = 1;
  this.LOADING = 2;
  this.SEEKING = 3;
  this.SEEKING_PENDING = 5;
  this.ERROR = 6;

  this.state = this.STOPPED;

  this.url = url;
  this.videoTag = videoTag;
  this.wid = wid;

  this.seek_time = null;
  this.sequence_num = 0;

  this.clusters_to_send = 0;
  this.cluster_offset = -1;
  this.cluster_queue = [];
  this.cluster_queue_threshold = 30;
  this.fetching_clusters = false;
  this.end_of_clusters = false;

  this.buffer_ahead_threshold = 10; // Amount of data we want buffered ahead of
                                    // the current playback position.

  this.parser = new WebMFileParser(url);

  var t = this;
  this.parser.log = function(str) { log(str); };

  this.onOpen = function(e) { t.doOpen(); };
  this.onEnded = function(e) { t.doEnded(); };
  this.onClose = function(e) { t.doClose(); };
  this.onStalled = function(e) { t.doStalled(); };
  this.onSeeking = function(e) { t.doSeeking(); };

  this.videoTag.addEventListener('webkitsourceopen', this.onOpen);
  this.videoTag.addEventListener('webkitsourceended', this.onEnded);
  this.videoTag.addEventListener('webkitsourceclose', this.onClose);
  this.videoTag.addEventListener('stalled', this.onStalled);
  this.videoTag.addEventListener('timeupdate', this.onStalled);
  this.videoTag.addEventListener('progress', this.onStalled);
  this.videoTag.addEventListener('seeking', this.onSeeking);
}

WebMPlayer.prototype.log = function(str) {};

WebMPlayer.prototype.doOpen = function() {
  this.log('doOpen() : ' + this.wid);
  if (this.state == this.STOPPED) {
    this.changeState(this.PARSING_HEADERS);

    var t = this;
    this.parser.parseHeaders(function(success) {
        t.onParseHeadersDone(success); });
    return;
  }
};

WebMPlayer.prototype.doEnded = function() {
  this.log('doEnded() : ' + this.wid);
};

WebMPlayer.prototype.doClose = function() {
  this.log('doClose() : ' + this.wid);

  if (this.state == this.STOPPED) {
    return;
  }

  this.changeState(this.STOPPED);

  this.videoTag.removeEventListener('webkitsourceopen', this.onOpen);
  this.videoTag.removeEventListener('webkitsourceended', this.onEnded);
  this.videoTag.removeEventListener('webkitsourceclose', this.onClose);
  this.videoTag.removeEventListener('stalled', this.onStalled);
  this.videoTag.removeEventListener('timeupdate', this.onStalled);
  this.videoTag.removeEventListener('progress', this.onStalled);
  this.videoTag.removeEventListener('seeking', this.onSeeking);
};

WebMPlayer.prototype.reportDecodeError = function() {
  this.changeState(this.ERROR);
  this.videoTag.webkitSourceEndOfStream(HTMLMediaElement.EOS_DECODE_ERR);
};

WebMPlayer.prototype.appendData = function(data) {
  if (this.state == this.LOADING)
    this.videoTag.webkitSourceAppend(data);
};

WebMPlayer.prototype.endOfStream = function() {
  this.videoTag.webkitSourceEndOfStream(HTMLMediaElement.EOS_NO_ERROR);
};

WebMPlayer.prototype.onParseHeadersDone = function(success) {

  if (!success) {
    this.log('Failed to parse the headers');
    this.reportDecodeError();
    return;
  }

  var info = this.parser.getInfo();
  var tracks = this.parser.getTracks();

  if (!info) {
    this.log('Info is null!');
    this.reportDecodeError();
    return;
  }

  if (!tracks) {
    this.log('Tracks is null!');
    this.reportDecodeError();
    return;
  }

  this.changeState(this.LOADING);

  var info_tracks = new Uint8Array(info.length + tracks.length);
  info_tracks.set(info, 0);
  info_tracks.set(tracks, info.length);
  this.appendData(info_tracks);

  this.cluster_offset = this.parser.getFirstClusterOffset();
  if (this.cluster_offset == -1) {
    this.reportDecodeError();
    return;
  }

  this.sendClusters(10);
};

WebMPlayer.prototype.sendClusters = function(ct) {
  this.clusters_to_send += ct;

  while (this.cluster_queue.length > 0 && this.clusters_to_send > 0) {
    // Send a cluster from the queue to the video tag.
    this.appendData(this.cluster_queue.shift());

    --this.clusters_to_send;
  }

  // Fetch more clusters from the network to fill the queue back up.
  this.fetchMoreClusters();
};

WebMPlayer.prototype.fetchMoreClusters = function() {
  if (!this.end_of_clusters && !this.fetching_clusters &&
      this.cluster_queue.length < this.cluster_queue_threshold) {

    var t = this;
    var seq_num = this.sequence_num;
    this.fetching_clusters = true;
    this.parser.getCluster(this.cluster_offset,
                           function(next_cluster_offset, buf) {
      t.fetching_clusters = false;

      if (t.state == t.SEEKING) {
        window.setTimeout(function() { t.startSeek();});
        return;
      }

      if (t.state == t.STOPPED) {
        return;
      }

      if (t.state != t.LOADING) {
        t.log('fetchMoreClusters() : unexpected state ' + t.state);
        return;
      }

      // Only add the buffer if it is part of the current sequence.
      if (seq_num == t.sequence_num) {
        t.cluster_offset = next_cluster_offset;

        if (!buf) {
          t.end_of_clusters = true;
          t.endOfStream();
          return;
        }

        t.cluster_queue.push(buf);
      }
      window.setTimeout(function() { t.sendClusters(0);});

    });
  }
};

WebMPlayer.prototype.doStalled = function() {
  if (this.state != this.LOADING) {
    this.log('Stalled while not loading.');
    return;
  }

  if (this.getSecondsBufferedAhead() < this.buffer_ahead_threshold)
    this.sendClusters(1);
};

WebMPlayer.prototype.doSeeking = function() {
  this.sequence_num += 1;
  this.seek_time = this.videoTag.currentTime;

  this.log('doSeeking ' + this.seek_time);

  if (this.state == this.SEEKING) {
    this.log('Already seeking...');
    return;
  }

  this.changeState(this.SEEKING);

  if (this.fetching_clusters) {
    // We have to wait until we finish fetching clusters
    // before we can do the seek
    this.log('Waiting for fetching_clusters to finish.');
    return;
  }

  this.startSeek();
};

WebMPlayer.prototype.startSeek = function() {
  this.log('startSeek()');

  this.end_of_clusters = false;
  this.cluster_queue = [];

  var seek_time = this.seek_time;
  this.log('Seeking to ' + seek_time);

  var seq_num = this.sequence_num;
  var t = this;
  this.parser.getClusterOffset(seek_time, function(start_time, offset) {
    t.onGetClusterOffsetDone(seq_num, seek_time, start_time, offset);
  });
};

WebMPlayer.prototype.onGetClusterOffsetDone = function(seq_num, seek_time,
                                                       start_time, offset) {
  this.log('onGetClusterOffsetDone(' + seek_time + ', ' + start_time + ', ' +
           offset + ')');

  // Check to see if another seek happened while we were getting the offset.
  if (seq_num != this.sequence_num) {
    this.startSeek();
    return;
  }

  this.cluster_offset = offset;

  this.changeState(this.LOADING);
  this.sendClusters(10);
};

WebMPlayer.prototype.changeState = function(new_state) {
  this.log('changeState() : ' + this.state + ' -> ' + new_state);
  this.state = new_state;
};

// Public API
WebMPlayer.prototype.getSecondsBufferedAhead = function() {
  var now = this.videoTag.currentTime;
  var ranges = this.videoTag.buffered;
  for (var i = 0; i < ranges.length; ++i) {
    if ((ranges.start(i) <= now) &&
        (ranges.end(i) >= now)) {
      return (ranges.end(i) - now);
    }
  }

  return 0;
};

WebMPlayer.prototype.getClusterQueueLength = function() {
  return this.cluster_queue.length;
};

WebMPlayer.prototype.getClusterQueueThreshold = function() {
  return this.cluster_queue_threshold;
};
