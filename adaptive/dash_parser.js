// Copyright (c) 2012 The WebM project authors. All Rights Reserved.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file in the root of the source
// tree. An additional intellectual property rights grant can be found
// in the file PATENTS.  All contributing project authors may
// be found in the AUTHORS file in the root of the source tree.

'use strict';

/**
 * Download and parse Dash manifest file.
 * @param {string} url The url for the manifest file.
 * @constructor
 */
function DashParser(url) {
  this.url_ = url;
}

/**
 * Local file request has succeeded status code.
 * @const
 * @type {number}
 */
DashParser.FILE_OK_STATUS_CODE = 0;

/**
 * HTTP request has succeeded status code.
 * @const
 * @type {number}
 */
DashParser.HTTP_OK_STATUS_CODE = 200;

/**
 * Static function to return version string.
 * @return {string} version.
 */
DashParser.version = function() {
  return '0.1.0.1';
};

/**
 * Static function to parse XML duration.
 * @param {string} xsDuration XML duration.
 * @return {Object} The status object. {Object}.value returns the duration in
 *     seconds.
 */
DashParser.parseXsDuration = function(xsDuration) {
  // TODO(fgalligan): Handle years, months, and days.
  if (xsDuration.substr(0, 2).toUpperCase() != 'PT')
    return new ErrorStatus('PT not in xsDuration:' + xsDuration);

  var hours = xsDuration.match(/\d+(?=H)/i);
  var minutes = xsDuration.match(/\d+(?=M)/i);
  var seconds = xsDuration.match(/\d+\.?\d*(?=S)/i);

  var duration = 0;
  if (hours)
    duration += parseFloat(hours[0]) * 3600;
  if (minutes)
    duration += parseFloat(minutes[0]) * 60;
  if (seconds)
    duration += parseFloat(seconds[0]);

  return {status: ErrorStatus.STATUS_OK, value: duration};
};

/**
 * Url pointing to the manifest file.
 * @private
 * @type {string}
 */
DashParser.prototype.url_ = null;

/**
 * XML document representation of the manifest.
 * @private
 * @type {string}
 */
DashParser.prototype.xmlDoc_ = null;

/**
 * Logging function to be set by the application.
 * @param {string} str The input string to be logged.
 */
DashParser.prototype.log = function(str) {};

/**
 * Loads the manifest file and initializes the MPD class. The format for
 * callback(object) is obj.status {number} The returned status and
 * [obj.reason] {string} Extra information on the status.
 * @param {function} callback Callback function.
 */
DashParser.prototype.load = function(callback) {
  var xhReq = null;
  var t = this;
  this.callback = callback;

  if (this.url_ == null) {
    callback(new ErrorStatus('DashParser url is null.'));
    return;
  }

  if (window.XMLHttpRequest) {
    xhReq = new XMLHttpRequest();
  } else {
    xhReq = new ActiveXObject('Microsoft.XMLHTTP');
  }

  xhReq.onreadystatechange = function() {
    if (xhReq.readyState != 4) {
      return;
    }

    if (xhReq.status != DashParser.HTTP_OK_STATUS_CODE &&
        xhReq.status != DashParser.FILE_OK_STATUS_CODE) {
      t.callback(new ErrorStatus('Bad xhReq.status:' + xhReq.status));
    } else {
      t.xmlDoc_ = xhReq.responseXML;
      t.mpd = new MPD();
      var res = t.mpd.parseXmlDoc(t.xmlDoc_);
      if (res.status != ErrorStatus.STATUS_OK) {
        var errorStr = 'DashParser Parsing XML document failed. :' + res.reason;
        this.log(errorStr);
        t.callback(new ErrorStatus(errorStr));
      }

      t.callback(new OKStatus());
    }
  };

  xhReq.open('GET', this.url_, true);
  xhReq.send(null);
};

/**
 * Class representing a SegmentBase element from a Dash file.
 * @constructor
 */
function SegmentBase() {
}

/**
 * Factory function to create a SegmentBase class.
 * @param {XmlNodeList} node SegmentBase element list.
 * @return {SegmentBase} SegmentBase object.
 */
SegmentBase.parseSegmentBaseXML = function(node) {
  var sb = new SegmentBase();

  var attribute = node.getAttribute('indexRange');
  if (attribute) {
    sb.indexRange = attribute.split('-');
    sb.indexRange[0] = parseInt(sb.indexRange[0]);
    if (isNaN(sb.indexRange[0]))
      return NULL;
    sb.indexRange[1] = parseInt(sb.indexRange[1]);
    if (isNaN(sb.indexRange[1]))
      return NULL;
  }

  // There should be at most one Initialisation element.
  var initNode = node.getElementsByTagName('Initialisation');
  if (initNode.length > 0) {
    var attribute = initNode[0].getAttribute('range');
    if (attribute) {
      sb.headerRange = attribute.split('-');
      sb.headerRange[0] = parseInt(sb.headerRange[0]);
      if (isNaN(sb.headerRange[0]))
        return NULL;
      sb.headerRange[1] = parseInt(sb.headerRange[1]);
      if (isNaN(sb.headerRange[1]))
        return NULL;
    }
  }

  return sb;
};

/**
 * Start and end offset for the header.
 * @type {Array.<number>}
 */
SegmentBase.prototype.headerRange = null;

/**
 * Start and end offset for the index.
 * @type {Array.<number>}
 */
SegmentBase.prototype.indexRange = null;

/**
 * Class representing a MPD element.
 * @constructor
 */
function MPD() {
  this.periodList = [];
}

/**
 * XML Document node type.
 * @const
 * @type {number}
 */
MPD.DOCUMENT_TYPE_NODE = 9;

/**
 * Duration in seconds of the MPD.
 * @private
 * @type {number}
 */
MPD.prototype.mediaPresentationDuration_ = Number.NaN;

/**
 * Minimum buffer time in seconds of the MPD.
 * @private
 * @type {number}
 */
MPD.prototype.minBufferTime_ = Number.NaN;

/**
 * MPD profiles.
 * @private
 * @type {string}
 */
MPD.prototype.profiles_ = null;

/**
 * Type of the MPD.
 * @private
 * @type {string}
 */
MPD.prototype.type_ = 'static';

/**
 * List of Period classes.
 * @type {Array.<Period>}
 */
MPD.prototype.periodList = null;

/**
 * Parse the mpd element from the XML document.
 * @param {XMLDocument} xmlDoc XML Document.
 * @return {Object} The status object.
 */
MPD.prototype.parseXmlDoc = function(xmlDoc) {
  if (xmlDoc.nodeType != MPD.DOCUMENT_TYPE_NODE)
    return new ErrorStatus('xmlDoc is not a DOCUMENT_TYPE_NODE.');

  var attribute = xmlDoc.documentElement.getAttribute('type');
  if (attribute)
    this.type_ = attribute;

  var attribute =
      xmlDoc.documentElement.getAttribute('mediaPresentationDuration');
  if (attribute) {
    var res = DashParser.parseXsDuration(attribute);
    if (res.status == ErrorStatus.STATUS_OK)
      this.mediaPresentationDuration_ = res.value;
  }

  attribute = xmlDoc.documentElement.getAttribute('minBufferTime');
  if (attribute) {
    var res = DashParser.parseXsDuration(attribute);
    if (res.status == ErrorStatus.STATUS_OK)
      this.minBufferTime_ = res.value;
  }

  this.profiles_ = xmlDoc.documentElement.getAttribute('profiles');

  var res = this.validate();
  if (res.status != ErrorStatus.STATUS_OK)
    return res;

  var xmlPeriodList = xmlDoc.getElementsByTagName('Period');
  for (var i = 0; i < xmlPeriodList.length; i++) {
    var period = new Period(this);
    var res = period.parseXmlNode(xmlPeriodList[i]);
    if (res.status != ErrorStatus.STATUS_OK)
      return res;
    this.periodList.push(period);
  }

  return new OKStatus();
};

/**
 * Validates the values in the MPD class. This should be called after the MPD
 * element has been parsed.
 * @return {Object} The status object.
 */
MPD.prototype.validate = function() {
  //TODO(fgalligan): Handle dynamic type.
  if (this.type_.toUpperCase() !== 'STATIC')
    return new ErrorStatus('MPD type is not static. :' + this.type_);

  if (isNaN(this.minBufferTime_))
    return new ErrorStatus('MPD is missing minBufferTime.');

  // Must be present in static manifests.
  if (isNaN(this.mediaPresentationDuration_))
    return new ErrorStatus(
          'static MPD missing mediaPresentationDuration.');

  return new OKStatus();
};

/**
 * Return the media duration in seconds from the mpd.
 * @return {number} The duration in seconds.
 */
MPD.prototype.getDuration = function() {
  return this.mediaPresentationDuration_;
};

/**
 * Return the minimum buffer time in seconds from the mpd.
 * @return {number} The minimum buffer time in seconds.
 */
MPD.prototype.getMinBufferType = function() {
  return this.minBufferTime_;
};

/**
 * Return the profiles for the MPD.
 * @return {string} profiles.
 */
MPD.prototype.getProfiles = function() {
  return this.profiles_;
};

/**
 * Class representing a Period element.
 * @param {MPD} parent Period's parent object.
 * @constructor
 */
function Period(parent) {
  this.parent = parent;
  this.adaptationSetList = [];
}

/**
 * bitstreamSwitching flag from Period.
 * @private
 * @type {bool}
 */
Period.prototype.bitstreamSwitching_ = false;

/**
 * Duration in seconds of the Period.
 * @private
 * @type {number}
 */
Period.prototype.duration_ = Number.NaN;

/**
 * Start time in seconds of the Period.
 * @private
 * @type {number}
 */
Period.prototype.start_ = Number.NaN;

/**
 * Period id.
 * @type {string}
 */
Period.prototype.id = null;

/**
 * Reference to the MPD class that owns the Period.
 * @type {MPD}
 */
Period.prototype.parent = null;

/**
 * List of AdaptationSet classes.
 * @type {Array.<AdaptationSet>}
 */
Period.prototype.adaptationSetList = null;

/**
 * Search the adaptation set list to find the first adaption set that contains
 * the search pattern.
 * @param {RegExp} pattern RegExp to search for.
 * @return {AdaptationSet} An AdaptationSet. Return NULL if one cannot be found.
 */
Period.prototype.findFirstAdaptationSet = function(pattern) {
  var as = null;
  var l = this.adaptationSetList.length;
  for (var i = 0; i < l; ++i) {
    // TODO(fgalligan): Add support to search through the Representation.
    if (this.adaptationSetList[i].codecs_.search(pattern) != -1) {
      as = this.adaptationSetList[i];
      break;
    }
  }

  return as;
};

/**
 * Parse the Period element from the XML document.
 * @param {XmlNodeList} node Period XML node.
 * @return {Object} The status object.
 */
Period.prototype.parseXmlNode = function(node) {
  if (!this.parent)
    return new ErrorStatus('Period has no parent.');

  this.bitstreamSwitching_ = node.getAttribute('bitstreamSwitching') === 'true';
  this.id = node.getAttribute('id');

  var attribute = node.getAttribute('duration');
  if (attribute) {
    var res = DashParser.parseXsDuration(attribute);
    if (res.status == ErrorStatus.STATUS_OK)
      this.duration_ = res.value;
  }

  attribute = node.getAttribute('start');
  if (attribute) {
    var res = DashParser.parseXsDuration(attribute);
    if (res.status == ErrorStatus.STATUS_OK)
      this.start_ = res.value;
  }

  var res = this.validate();
  if (res.status != ErrorStatus.STATUS_OK)
    return res;

  var xmlASList = node.getElementsByTagName('AdaptationSet');
  for (var i = 0; i < xmlASList.length; i++) {
    var as = new AdaptationSet(this);
    var res = as.parseXmlNode(xmlASList[i]);
    if (res.status != ErrorStatus.STATUS_OK)
      return res;
    this.adaptationSetList.push(as);
  }

  return new OKStatus();
};

/**
 * Validates the values in the Period class. This should be called after the
 * Period element has been parsed.
 * @return {Object} The status object.
 */
Period.prototype.validate = function() {
  return new OKStatus();
};

/**
 * Return the bitstreamSwitching flag for the Period.
 * @return {bool} bitstreamSwitching.
 */
Period.prototype.getBitstreamSwitching = function() {
  return this.bitstreamSwitching_;
};

/**
 * Return the Period duration in seconds. If duration is 0 get the duration
 * from the parent.
 * @return {number} The duration in seconds.
 */
Period.prototype.getDuration = function() {
  if (isNaN(this.duration_))
    return this.parent.getDuration();

  return this.duration_;
};

/**
 * Class representing an AdaptationSet element.
 * @param {Period} parent AdaptationSet's parent object.
 * @constructor
 */
function AdaptationSet(parent) {
  this.parent = parent;
  this.representationList = [];
}

/**
 * Value representing bitstreamSwitching flag from AdaptationSet. If value is
 * -1 that means the value has not been set. If value is 0 that represents
 * 'false'. If value is 1 that represents 'true'.
 * @private
 * @type {number}
 */
AdaptationSet.prototype.bitstreamSwitching_ = -1;

/**
 * Codec string for all of the representations within the adaptation set.
 * @private
 * @type {string}
 */
AdaptationSet.prototype.codecs_ = null;

/**
 * AdaptationSet height.
 * @private
 * @type {number}
 */
AdaptationSet.prototype.height_ = Number.NaN;

/**
 * AdaptationSet id.
 * @type {string}
 */
AdaptationSet.prototype.id = null;

/**
 * AdaptationSet language.
 * @type {string}
 */
AdaptationSet.prototype.lang = null;

/**
 * Reference to the Period class that owns the adaptation set.
 * @type {Period}
 */
AdaptationSet.prototype.parent = null;

/**
 * Mimetype for all of the representations within the adaptation set.
 * @private
 * @type {string}
 */
AdaptationSet.prototype.mimetype_ = null;

/**
 * List of Representation classes.
 * @type {Array.<Representation>}
 */
AdaptationSet.prototype.representationList = null;

/**
 * AdaptationSet segmentAlignment flag.
 * @type {boolean}
 */
AdaptationSet.prototype.segmentAlignment = false;

/**
 * AdaptationSet subsegmentAlignment flag. Flag telling if the adaptation set's
 * sub segment transition points match for all the representations contained
 * within the adaptation set.
 * @private
 * @type {boolean}
 */
AdaptationSet.prototype.subsegmentAlignment_ = false;

/**
 * AdaptationSet subSegmentStartsWithSAP.
 * within the adaptation set.
 * @private
 * @type {boolean}
 */
AdaptationSet.prototype.subsegmentStartsWithSAP_ = 0;

/**
 * AdaptationSet width.
 * @private
 * @type {number}
 */
AdaptationSet.prototype.width_ = Number.NaN;

/**
 * Parse the AdaptationSet element from the XML document.
 * @param {XmlNodeList} node AdaptationSet nodes.
 * @return {Object} The status object.
 */
AdaptationSet.prototype.parseXmlNode = function(node) {
  if (!this.parent)
    return new ErrorStatus('AdaptationSet has no parent.');

  var attribute = node.getAttribute('bitstreamSwitching');
  if (attribute) {
    if (attribute === 'true') {
      this.bitstreamSwitching_ = 1;
    } else {
      this.bitstreamSwitching_ = 0;
    }
  }
  this.codecs_ = node.getAttribute('codecs');
  this.height_ = parseInt(node.getAttribute('height'));
  this.id = node.getAttribute('id');
  this.lang = node.getAttribute('lang');
  this.mimetype_ = node.getAttribute('mimeType');
  this.segmentAlignment = node.getAttribute('segmentAlignment') === 'true';
  this.subsegmentAlignment_ =
      node.getAttribute('subsegmentAlignment') === 'true';
  this.subsegmentStartsWithSAP_ =
      parseInt(node.getAttribute('subsegmentStartsWithSAP'));
  this.width_ = parseInt(node.getAttribute('width'));

  var res = this.validate();
  if (res.status != ErrorStatus.STATUS_OK)
    return res;

  var xmlRepList = node.getElementsByTagName('Representation');
  for (var i = 0; i < xmlRepList.length; i++) {
    var r = new Representation(this);
    var res = r.parseXmlNode(xmlRepList[i]);
    if (res.status != ErrorStatus.STATUS_OK)
      return res;
    this.representationList.push(r);
  }

  return new OKStatus();
};

/**
 * Validates the values in the AdaptationSet class. This should be called after
 * the AdaptationSet element has been parsed.
 * @return {Object} The status object.
 */
AdaptationSet.prototype.validate = function() {
  return new OKStatus();
};

/**
 * Return the bitstreamSwitching flag for the AdaptationSet. If not set in the
 * AdaptationSet check the parent.
 * @return {bool} bitstreamSwitching.
 */
AdaptationSet.prototype.getBitstreamSwitching = function() {
  if (this.bitstreamSwitching_ == -1)
    return this.parent.getBitstreamSwitching();

  return this.bitstreamSwitching_ == 1;
};

/**
 * Return the codecs for the AdaptationSet.
 * @return {string} codecs.
 */
AdaptationSet.prototype.getCodecs = function() {
  return this.codecs_;
};

/**
 * Return the duration in seconds from the parent.
 * @return {number} The duration in seconds.
 */
AdaptationSet.prototype.getDuration = function() {
  return this.parent.getDuration();
};

/**
 * Return the height for the AdaptationSet.
 * @return {number} height in pixels.
 */
AdaptationSet.prototype.getHeight = function() {
  return this.height_;
};

/**
 * Return the mimetype for the AdaptationSet.
 * @return {string} mimetype.
 */
AdaptationSet.prototype.getMimetype = function() {
  return this.mimetype_;
};

/**
 * Return the subsegmentAlignment for the AdaptationSet.
 * @return {bool} subsegmentAlignment.
 */
AdaptationSet.prototype.getSubsegmentAlignment = function() {
  return this.subsegmentAlignment_;
};

/**
 * Return the subsegmentStartsWithSAP for the AdaptationSet.
 * @return {number} subsegmentStartsWithSAP.
 */
AdaptationSet.prototype.getSubsegmentStartsWithSAP = function() {
  return this.subsegmentStartsWithSAP_;
};

/**
 * Return the width for the AdaptationSet.
 * @return {number} width in pixels.
 */
AdaptationSet.prototype.getWidth = function() {
  return this.width_;
};

/**
 * Class representing a Representation element.
 * @param {AdaptationSet} parent Representation's parent object.
 * @constructor
 */
function Representation(parent) {
  this.parent = parent;
}

/**
 * Representation bandwidth.
 * @type {number}
 */
Representation.prototype.bandwidth = Number.NaN;

/**
 * Representation codecs.
 * @private
 * @type {string}
 */
Representation.prototype.codecs_ = null;

/**
 * Height in pixels of the video stream.
 * @private
 * @type {number}
 */
Representation.prototype.height_ = Number.NaN;

/**
 * Representation id.
 * @type {string}
 */
Representation.prototype.id = null;

/**
 * Representation mimetype.
 * @private
 * @type {string}
 */
Representation.prototype.mimetype_ = null;

/**
 * Reference to the AdaptationSet class that owns the Representation.
 * @type {AdaptationSet}
 */
Representation.prototype.parent = null;

/**
 * Sample rate of the audio stream.
 * @type {number}
 */
Representation.prototype.audioSamplingRate = Number.NaN;

/**
 * Class describing the SegmentBase.
 * @private
 * @type {SegmentBase}
 */
Representation.prototype.segmentBase_ = null;

/**
 * Link to the media file.
 * @private
 * @type {string}
 */
Representation.prototype.url_ = null;

/**
 * Width in pixels of the video stream.
 * @private
 * @type {number}
 */
Representation.prototype.width_ = Number.NaN;

/**
 * Parse the Representation element from the XML document.
 * @param {XmlNodeList} node Representation node.
 * @return {Object} The status object.
 */
Representation.prototype.parseXmlNode = function(node) {
  if (!this.parent)
    return new ErrorStatus('Representation has no parent.');

  this.id = node.getAttribute('id');
  this.mimetype_ = node.getAttribute('mimetype');
  this.codecs_ = node.getAttribute('codecs');
  this.bandwidth = parseInt(node.getAttribute('bandwidth'));
  this.height_ = parseInt(node.getAttribute('height'));
  this.audioSamplingRate = parseInt(node.getAttribute('audioSamplingRate'));
  this.width_ = parseInt(node.getAttribute('width'));

  // TODO(fgalligan): Add support for more than one BaseUrl.
  var baseUrlList = node.getElementsByTagName('BaseURL');
  if (baseUrlList.length > 0) {
    this.url_ = baseUrlList[0].childNodes[0].nodeValue;
  }

  // There should be at most one SegmentBase element.
  var segmentBaseList = node.getElementsByTagName('SegmentBase');
  if (segmentBaseList.length > 0) {
    this.segmentBase_ = SegmentBase.parseSegmentBaseXML(segmentBaseList[0]);
  }

  var res = this.validate();
  if (res.status != ErrorStatus.STATUS_OK)
    return res;

  return new OKStatus();
};

/**
 * Validates the values in the Representation class. This should be called after
 * the Representation element has been parsed.
 * @return {Object} The status object.
 */
Representation.prototype.validate = function() {
  if (!this.id)
    return new ErrorStatus('Representation has no id.');
  if (isNaN(this.bandwidth))
    return new ErrorStatus('Representation has no bandwidth.');
  if (this.bandwidth < 1)
    return new ErrorStatus('Representation bandwidth is bad. :' +
                           this.bandwidth);
  if (this.getCodecs() == null)
    return new ErrorStatus('codecs is null.');
  if (this.getMimetype() == null)
    return new ErrorStatus('mimetype is null.');

  return new OKStatus();
};

/**
 * Return the codecs for the Representation. If not set in the Representation
 * check the parent.
 * @return {string} codecs.
 */
Representation.prototype.getCodecs = function() {
  if (this.codecs_)
    return this.codecs_;

  return this.parent.getCodecs();
};

/**
 * Return the duration in seconds from the parent.
 * @return {number} The duration in seconds.
 */
Representation.prototype.getDuration = function() {
  return this.parent.getDuration();
};

/**
 * Return the height for the Representation. If not set in the Representation
 * check the parent.
 * @return {number} height in pixels.
 */
Representation.prototype.getHeight = function() {
  if (isNaN(this.height_))
    return this.parent.getHeight();

  return this.height_;
};

/**
 * Return the mimetype for the Representation. If not set in the Representation
 * check the parent.
 * @return {string} mimetype.
 */
Representation.prototype.getMimetype = function() {
  if (this.mimetype_)
    return this.mimetype_;

  return this.parent.getMimetype();
};

/**
 * Return the full URL for the Representation.
 * @return {string} URL.
 */
Representation.prototype.getFullURL = function() {
  return this.url_;
};

/**
 * Return the width for the Representation. If not set in the Representation
 * check the parent.
 * @return {number} width in pixels.
 */
Representation.prototype.getWidth = function() {
  if (isNaN(this.width_))
    return this.parent.getWidth();

  return this.width_;
};

/**
 * Return the header range for the Representation.
 * @return {Array} a two element array with element 0 the start offset and
 *     element 1 the end offset. Returns null if the header is not set.
 */
Representation.prototype.headerRange = function() {
  if (!this.segmentBase_ || !this.segmentBase_.headerRange)
    return null;

  return this.segmentBase_.headerRange;
};

/**
 * Return the index range for the Representation.
 * @return {Array} a two element array with element 0 the start offset and
 *     element 1 the end offset. Returns null if the index is not set.
 */
Representation.prototype.indexRange = function() {
  if (!this.segmentBase_ || !this.segmentBase_.indexRange)
    return null;

  return this.segmentBase_.indexRange;
};
