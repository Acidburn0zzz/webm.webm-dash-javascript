// Copyright (c) 2012 The WebM project authors. All Rights Reserved.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file in the root of the source
// tree. An additional intellectual property rights grant can be found
// in the file PATENTS.  All contributing project authors may
// be found in the AUTHORS file in the root of the source tree.

'use strict';

/**
 * Class to parse binary EBML data.
 * @constructor
 */
function EbmlParser() {
}

/**
 * Return code signaling everything is fine.
 * @const
 * @type {number}
 */
EbmlParser.STATUS_OK = 0;

/**
 * Invalid data return code.
 * @const
 * @type {number}
 */
EbmlParser.STATUS_INVALID_DATA = -1;

/**
 * Return code signaling more data is needed.
 * @const
 * @type {number}
 */
EbmlParser.STATUS_NEED_MORE_DATA = -2;

/**
 * Maximum size of an EBML header in bytes.
 * @const
 * @type {number}
 */
EbmlParser.MAX_ELEMENT_HEADER_SIZE = 12;

/**
 * Static function to parse an EMBL number.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @param {number} maxBytes Max bytes of number.
 * @param {boolean} maskFirstByte Flag telling if the first byte of the number
 *     is EBML encoded.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is number.
 * @private
 */
EbmlParser.parseNum_ = function(buf, start, size, maxBytes, maskFirstByte) {
  if (size <= 0)
    return {status: EbmlParser.STATUS_NEED_MORE_DATA, bytesNeeded: 1};
  var mask = 0x80;
  var ch = buf[start];
  var extraBytes = -1;
  var num = 0;
  for (var i = 0; i < maxBytes; ++i) {
    if ((ch & mask) == mask) {
      num = maskFirstByte ? ch & ~mask : ch;
      extraBytes = i;
      break;
    }
    mask >>= 1;
  }

  if (extraBytes == -1)
    return {status: EbmlParser.STATUS_INVALID_DATA,
            reason: 'Invalid extraBytes field'};

  if ((1 + extraBytes) > size)
    return {status: EbmlParser.STATUS_NEED_MORE_DATA,
            bytesNeeded: (1 + extraBytes - size)};

  // TODO(acolwell) : Add support for signalling "reserved" values (ie all 1s).
  var bytesUsed = 1;
  for (var i = 0; i < extraBytes; ++i, ++bytesUsed)
    num = (num << 8) | (0xff & buf[start + bytesUsed]);

  return {status: EbmlParser.STATUS_OK,
          bytesUsed: bytesUsed,
          value: num};
};

/**
 * Static function to parse EBML element header.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read, 'id' is the EBML id, and
 *     'elementSize' is the size of the element in bytes.
 */
EbmlParser.parseElementHeader = function(buf, start, size) {

  if (size == 0)
    return {status: EbmlParser.STATUS_OK, bytesUsed: 0};

  var res = EbmlParser.parseNum_(buf, start, size, 4, false);

  if (res.status != EbmlParser.STATUS_OK)
    return res;

  if (res.bytesUsed <= 0)
    return {status: EbmlParser.STATUS_INVALID_DATA};

  var bytesUsed = res.bytesUsed;
  var id = res.value;

  res = EbmlParser.parseNum_(buf, start + bytesUsed, size - bytesUsed, 8, true);

  if (res.status != EbmlParser.STATUS_OK)
    return res;

  if (res.bytesUsed <= 0)
    return {status: EbmlParser.STATUS_INVALID_DATA};

  bytesUsed += res.bytesUsed;

  //log(start + " ID : " + webmGetIdName(id));
  return {status: EbmlParser.STATUS_OK,
          bytesUsed: bytesUsed,
          id: id,
          elementSize: res.value};
};

/**
 * Static function to parse an unsigned integer.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is number.
 */
EbmlParser.parseUInt = function(buf, start, size) {
  if (size < 1 || size > 8)
    return {status: EbmlParser.STATUS_INVALID_DATA};

  var val = 0;
  for (var i = 0; i < size; ++i) {
    val <<= 8;
    val |= buf[start + i] & 0xff;
  }

  return {status: EbmlParser.STATUS_OK,
          bytesUsed: size,
          value: val};
};

/**
 * Static function to parse a floating point number.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is number.
 */
EbmlParser.parseFloat = function(buf, start, size) {
  if (size == 4) {
    return EbmlParser.parseFloat4(buf, start);
  } else if (size == 8) {
    return EbmlParser.parseFloat8(buf, start);
  }
  return {status: EbmlParser.STATUS_INVALID_DATA};
};

/**
 * Static function to parse a single precision floating point number.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is number.
 */
EbmlParser.parseFloat4 = function(buf, start) {
  var val = 0;
  for (var i = 0; i < 4; ++i) {
    val <<= 8;
    val |= buf[start + i] & 0xff;
  }

  var sign = val >> 31;
  var exponent = ((val >> 23) & 0xff) - 127;
  var significand = val & 0x7fffff;
  if (exponent > -127) {
    if (exponent == 128) {
      if (significand == 0) {
        // Infinity numbers
        if (sign == 0) {
          return {status: EbmlParser.STATUS_OK,
                  bytesUsed: 4,
                  value: Number.POSITIVE_INFINITY};
        } else {
          return {status: EbmlParser.STATUS_OK,
                  bytesUsed: 4,
                  value: Number.NEGATIVE_INFINITY};
        }
      }
      // NaN
      return {status: EbmlParser.STATUS_OK,
              bytesUsed: 4,
              value: NaN};
    }

    // Normal numbers
    significand |= 0x800000;
  } else {
    if (significand == 0) {
      // +0 or -0
      return {status: EbmlParser.STATUS_OK,
              bytesUsed: 4,
              value: 0};
    }

    // Subnormal numbers
    exponent = -126;
  }

  var num = Math.pow(-1, sign) * (significand * Math.pow(2, -23)) *
            Math.pow(2, exponent);

  return {status: EbmlParser.STATUS_OK,
          bytesUsed: 4,
          value: num};
};

/**
 * Static function to parse a double precision floating point number.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is number.
 */
EbmlParser.parseFloat8 = function(buf, start) {
  var sign = (buf[start] >> 7) & 0x1;
  var exponent = (((buf[start] & 0x7f) << 4) |
                  ((buf[start + 1] >> 4) & 0xf)) - 1023;

  // Javascript performs bitwise and shift operations on 32 bit integers.
  var significand = 0;
  var shift = Math.pow(2, 6 * 8);
  significand += (buf[start + 1] & 0xf) * shift;
  for (var i = 2; i < 8; ++i) {
    var shift = Math.pow(2, (8 - i - 1) * 8);
    significand += (buf[start + i] & 0xff) * shift;
  }

  if (exponent > -1023) {
    if (exponent == 1024) {
      if (significand == 0) {
        // Infinity numbers
        if (sign == 0) {
          return {status: EbmlParser.STATUS_OK,
                  bytesUsed: 8,
                  value: Number.POSITIVE_INFINITY};
        } else {
          return {status: EbmlParser.STATUS_OK,
                  bytesUsed: 8,
                  value: Number.NEGATIVE_INFINITY};
        }
      }
      // NaN
      return {status: EbmlParser.STATUS_OK,
              bytesUsed: 8,
              value: NaN};
    }

    // Normal numbers
    significand += 0x10000000000000;
  } else {
    if (significand == 0) {
      // +0 or -0
      return {status: EbmlParser.STATUS_OK,
              bytesUsed: 8,
              value: 0};
    }

    // Subnormal numbers
    exponent = -1022;
  }

  var num = Math.pow(-1, sign) * (significand * Math.pow(2, -52)) *
      Math.pow(2, exponent);

  return {status: EbmlParser.STATUS_OK,
          bytesUsed: 8,
          value: num};
};

/**
 * Static function to parse string.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is the string.
 */
EbmlParser.parseString = function(buf, start, size) {
  if (size < 1)
    return {status: EbmlParser.STATUS_INVALID_DATA};

  var val = '';
  for (var i = 0; i < size; ++i) {
    val += String.fromCharCode(buf[start + i]);
  }

  return {status: EbmlParser.STATUS_OK,
          bytesUsed: size,
          value: val};
};

/**
 * Class to parse WebM elements.
 * @constructor
 */
function WebMParser() {
  this.segmentOffset_ = -1;
  this.seekHead_ = null;
  this.infoElement_ = null;
  this.tracksElement_ = null;
  this.trackObjects_ = [];
  this.timecodeScale_ = 1000000;
  this.duration_ = -1;

  this.cues_ = null;
}

/**
 * Return code signaling everything is fine.
 * @const
 * @type {number}
 */
WebMParser.STATUS_OK = 0;

/**
 * Invalid data return code.
 * @const
 * @type {number}
 */
WebMParser.STATUS_INVALID_DATA = -1;

/**
 * Return code signaling more data is needed.
 * @const
 * @type {number}
 */
WebMParser.STATUS_NEED_MORE_DATA = -2;

/**
 * Static function to return version string.
 * @return {string} version.
 */
WebMParser.version = function() {
  return '0.1.0.0';
};

/**
 * Logging function to be set by the application.
 * @param {string} str The input string to be logged.
 */
WebMParser.prototype.log = function(str) {};

/**
 * Static function to create a function to prperty mapping.
 * @param {string} parseFunctionName Function name.
 * @param {string} propertyToSet Property name.
 * @return {Object} Mapping.
 * @private
 */
WebMParser.createIdInfo_ = function(parseFunctionName, propertyToSet) {
  var func = null;
  if (parseFunctionName == null) {
    return {func: null, prop: propertyToSet};
  } else if (parseFunctionName == 'parseUInt') {
    func = function(t, buf, start, size, elementStart) {
      return EbmlParser.parseUInt(buf, start, size);
    };
  } else if (parseFunctionName == 'parseFloat') {
    func = function(t, buf, start, size, elementStart) {
      return EbmlParser.parseFloat(buf, start, size);
    };
  } else if (parseFunctionName == 'parseString') {
    func = function(t, buf, start, size, elementStart) {
      return EbmlParser.parseString(buf, start, size);
    };
  } else if (parseFunctionName == 'parseSimpleBlock_') {
    func = function(t, buf, start, size, elementStart) {
      return t.parseSimpleBlock_(buf, start, size, elementStart);
    };
  } else {
    func = function(t, buf, start, size, elementStart) {
      return t[parseFunctionName](buf, start, size);
    };
  }

  return {func: func, prop: propertyToSet};
};

/**
 * Static parse function for an element we want to skip.
 * @private
 */
WebMParser.SKIP_ = WebMParser.createIdInfo_(null, null);

/**
 * Static parse function for an element that contains an unsigned integer.
 * @param {string} propertyName Indicates the property to assign the parsed
 *     value to.
 * @return {Object} Mapping.
 * @private
 */
WebMParser.parseUInt_ = function(propertyName) {
  return WebMParser.createIdInfo_('parseUInt', propertyName);
};

/**
 * Static parse function for an element that contains a float.
 * @param {string} propertyName Indicates the property to assign the parsed
 *     value to.
 * @return {Object} Mapping.
 * @private
 */
WebMParser.parseFloat_ = function(propertyName) {
  return WebMParser.createIdInfo_('parseFloat', propertyName);
};

/**
 * Static parse function for an element that contains a string.
 * @param {string} propertyName Indicates the property to assign the parsed
 *     value to.
 * @return {Object} Mapping.
 * @private
 */
WebMParser.parseString_ = function(propertyName) {
  return WebMParser.createIdInfo_('parseString', propertyName);
};

/**
 * Global element IDs that can appear in any element.
 * @private
 */
WebMParser.GLOBAL_IDS_ = {
  'EC': WebMParser.SKIP_,  // Void
  'BF': WebMParser.SKIP_   // CRC32
};

/**
 * EBML Header IDs.
 * @private
 */
WebMParser.EBML_HEADER_IDS_ = {
  '4286': WebMParser.parseUInt_('version'),            // EBMLVersion
  '42F7': WebMParser.parseUInt_('readVersion'),        // EBMLReadVersion
  '42F2': WebMParser.parseUInt_('maxIdLength'),        // EBMLMaxIDLength
  '42F3': WebMParser.parseUInt_('maxSizeLength'),      // EBMLMaxSizeLength
  '4282': WebMParser.parseString_('docType'),          // EBMLDocType
  '4287': WebMParser.parseUInt_('docTypeVersion'),     // EBMLDocTypeVersion
  '4285': WebMParser.parseUInt_('docTypeReadVersion')  // EBMLDocTypeReadVersion
};

/**
 * Segment IDs.
 * @private
 */
WebMParser.SEGMENT_IDS_ = {
  '114D9B74': WebMParser.createIdInfo_('parseSeekHead_', // SeekHead
                                       'seekHead'),
  '1549A966': WebMParser.createIdInfo_('parseInfo_',     // Info
                                       'info'),
  '1654AE6B': WebMParser.createIdInfo_('parseTracks_',   // Tracks
                                       'tracks'),
  '1F43B675': null,                                      // Cluster
  '1C53BB6B': WebMParser.SKIP_                           // Cues
};

/**
 * SeekHead IDs.
 * @private
 */
WebMParser.SEEKHEAD_IDS_ = {
  '4DBB': WebMParser.createIdInfo_('parseSeekEntry_', null) // SeekHead
};

/**
 * SeekEntry IDs.
 * @private
 */
WebMParser.SEEK_ENTRY_IDS_ = {
  '53AB': WebMParser.parseUInt_('id'),       // SeekID
  '53AC': WebMParser.parseUInt_('position')  // SeekPosition
};

/**
 * SegmentInfo IDs.
 * @private
 */
WebMParser.INFO_IDS_ = {
  '73A4': WebMParser.SKIP_,  // SegmentUID
  '2AD7B1': WebMParser.parseUInt_('timecodeScale'), // TimecodeScale
  '4489': WebMParser.parseFloat_('duration'), // Duration
  '7BA9': WebMParser.SKIP_,   // Title
  '5741': WebMParser.SKIP_,   // WritingApp
  '4D80': WebMParser.SKIP_,   // MuxingApp
  '4461': WebMParser.SKIP_   // DateUTC
};

/**
 * Tracks IDs.
 * @private
 */
WebMParser.TRACKS_IDS_ = {
  'AE': WebMParser.createIdInfo_('parseTrackEntry_', 'track')  // TrackEntry
};

/**
 * Track IDs.
 * @private
 */
WebMParser.TRACK_IDS_ = {
  'D7': WebMParser.parseUInt_('TrackNumber'), // TrackNumber
  '73C5': WebMParser.parseUInt_('TrackUID'), // TrackUID
  '83': WebMParser.parseUInt_('TrackType'), // TrackType
  'B9': WebMParser.SKIP_,      // FlagEnabled
  '88': WebMParser.SKIP_,      // FlagDefault
  '55AA': WebMParser.SKIP_,    // FlagForced
  '9C': WebMParser.SKIP_,      // FlagLacing
  '6DE7': WebMParser.SKIP_,    // MinCache
  '6DE8': WebMParser.SKIP_,    // MaxCache
  '23E383': WebMParser.SKIP_,  // DefaultDuration
  '23314F': WebMParser.SKIP_,  // TrackTimecodeScale
  '55EE': WebMParser.SKIP_,    // MaxBlockAdditionID
  '536E': WebMParser.SKIP_,    // Name
  '22B59C': WebMParser.SKIP_,  // Language
  '86': WebMParser.SKIP_,      // CodecID
  '63A2': WebMParser.SKIP_,    // CodecPrivate
  '258688': WebMParser.SKIP_,  // CodecName
  '7446': WebMParser.SKIP_,    // AttachmentLink
  'AA': WebMParser.SKIP_,      // CodecDecodeAll
  '6FAB': WebMParser.SKIP_,    // TrackOverlay
  '6624': WebMParser.SKIP_,    // TrackTranslate
  'E0': WebMParser.SKIP_,      // Video
  'E1': WebMParser.SKIP_,      // Audio
  'E2': WebMParser.SKIP_,      // TrackOperation
  '6D80': WebMParser.SKIP_     // ContentEncodings
};

/**
 * Cues IDs.
 * @private
 */
WebMParser.CUES_IDS_ = {
  'BB': WebMParser.createIdInfo_('parsePointEntry_', null)  // PointEntry
};

/**
 * CuePointEntry IDs.
 * @private
 */
WebMParser.POINT_ENTRY_IDS_ = {
  'B3': WebMParser.parseUInt_('cueTime'),               // CUETIME
  'B7': WebMParser.createIdInfo_('parseTrackPosition_', // CUETRACKPOSITION
                                 'trackPosition')
};

/**
 * CueTrackPositions IDs.
 * @private
 */
WebMParser.TRACK_POSITIONS_IDS_ = {
  'F7': WebMParser.parseUInt_('cueTrack'),      // CUETRACK
  'F1': WebMParser.parseUInt_('cueClusterPos'), // CUECLUSTERPOSITION
  '5378': WebMParser.SKIP_                      // CUEBLOCKNUMBER
};

/**
 * Cluster IDs.
 * @private
 */
WebMParser.CLUSTER_IDS_ = {
  'E7': WebMParser.parseUInt_('clusterTimecode'),     // CLUSTERTIMECODE
  'AB': WebMParser.SKIP_,                             // CLUSTERPREVSIZE
  'A3': WebMParser.createIdInfo_('parseSimpleBlock_', // SIMPLEBLOCK
                                 'blockInfo')
};

/**
 * Set the Segment offset that is used by the Cues. |offset| will only be set
 * if it is greater than 0.
 * @param {number} offset Segment offset in bytes.
 */
WebMParser.prototype.setSegmentOffset = function(offset) {
  if (offset > 0)
    this.segmentOffset_ = offset;
};

/**
 * Check if |obj| is an Array.
 * @param {Object} obj Object to check.
 * @return {boolean} Returns true if |obj| is an Array.
 * @private
 */
WebMParser.prototype.isList_ = function(obj) {
  return ((typeof obj === 'object') &&
          (obj instanceof Array));
};

/**
 * Parses a WebM master element. Entire list needs to be in |buf| and within
 * the specified size. Returns an Object with values of the parsed list
 * according to |idInfo|.
 * @param {Object} idInfo Mapping of IDs to parsing functions.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @param {Object} obj Starting Object or Array.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is the Object of
 *     parsed values.
 * @private
 */
WebMParser.prototype.parseList_ = function(idInfo, buf, start, size, obj) {
  var curStart = start;
  var curSize = size;

  while (curSize > 0) {
    var res = EbmlParser.parseElementHeader(buf, curStart, curSize);

    if (res.status != EbmlParser.STATUS_OK)
      return res;

    var elementOffset = curStart;
    var dataOffset = elementOffset + res.bytesUsed;
    var elementSize = res.elementSize;
    var nextElementOffset = dataOffset + elementSize;

    curStart += res.bytesUsed;
    curSize -= res.bytesUsed;

    var idInfoKey = res.id.toString(16).toUpperCase();
    var info = null;

    if (idInfoKey in WebMParser.GLOBAL_IDS_) {
      info = WebMParser.GLOBAL_IDS_[idInfoKey];
    } else if (idInfoKey in idInfo) {
      info = idInfo[idInfoKey];
    } else {
      return {status: WebMParser.STATUS_INVALID_DATA,
              reason: 'No idInfo for ID ' + webmGetIdName(res.id)};
    }

    // A null idInfo entry indicates that we should stop parsing
    // right before this id.
    if (info == null) {
      return {status: WebMParser.STATUS_OK,
              bytesUsed: elementOffset - start,
              value: obj};
    }

    if (elementSize > curSize) {
      return {status: WebMParser.STATUS_NEED_MORE_DATA,
              bytesNeeded: elementSize - curSize};
    }

    var parseFunction = info.func;
    var propertyName = info.prop;

    if (parseFunction) {
      res = parseFunction(this, buf, dataOffset, elementSize, elementOffset);

      if (res.status != WebMParser.STATUS_OK)
        return res;

      if (res.bytesUsed != elementSize) {
        return {status: WebMParser.STATUS_INVALID_DATA,
                reason: 'bytesUsed does not match elementSize'};
      }

      if (res.storeElementFunc) {
        res.storeElementFunc(new Uint8Array(
            buf.subarray(elementOffset, nextElementOffset)));
      }

      if ((propertyName === null) && this.isList_(obj)) {
        obj.push(res.value);
      } else if ((propertyName in obj) &&
                 this.isList_(obj[propertyName])) {
        obj[propertyName].push(res.value);
      } else {
        obj[propertyName] = res.value;
      }
    } else {
      //log('Skipping ID ' + webmGetIdName(res.id));
    }

    curStart = nextElementOffset;
    curSize -= elementSize;
  }

  return {status: WebMParser.STATUS_OK,
          bytesUsed: size - curSize,
          value: obj};
};

/**
 * Parses a WebM element. Returns an Uint8Array with the element's data.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @param {number} id WEbM element id.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is an Uint8Array of
 *     the element's data.
 */
WebMParser.prototype.parseElement = function(buf, start, size, id) {
  var res = EbmlParser.parseElementHeader(buf, start, size);
  if (res.status != EbmlParser.STATUS_OK)
    return res;

  if (res.id != id) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Unexpected id : ' + webmGetIdName(res.id)};
  }

  var elementSize = res.bytesUsed + res.elementSize;
  if (elementSize > size) {
    return {status: WebMParser.STATUS_NEED_MORE_DATA,
            bytesNeeded: elementSize - size};
  }

  var end = start + elementSize;
  var element = new Uint8Array(buf.subarray(start, end));

  return {status: WebMParser.STATUS_OK,
          bytesUsed: elementSize,
          value: element};
};

/**
 * Parses an EBML file header. Returns an Object of the EBML header data.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is an Object with
 *     the EBML header data.
 * @private
 */
WebMParser.prototype.parseEBMLHeader_ = function(buf, start, size) {
  var bytesUsed = 0;
  var res = EbmlParser.parseElementHeader(buf, start, size);

  if (res.status != EbmlParser.STATUS_OK)
    return res;

  if (res.id != 0x1A45DFA3) { // HEADER
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Unexpected id : ' + webmGetIdName(res.id)};
  }

  start += res.bytesUsed;
  size -= res.bytesUsed;
  bytesUsed += res.bytesUsed;

  res = this.parseList_(WebMParser.EBML_HEADER_IDS_, buf, start,
                        res.elementSize, {});

  if (res.status != WebMParser.STATUS_OK)
    return res;

  var header = res.value;
  if ((header.version < 1) ||
      (header.readVersion < 1) ||
      (header.maxIdLength < 1) ||
      (header.maxIdLength > 4) ||
      (header.maxSizeLength < 1) ||
      (header.maxSizeLength > 8) ||
      (header.docType != 'webm') ||
      (header.docTypeVersion != 2) ||
      (header.docTypeReadVersion != 2)) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Invalid header values.'};
  }

  bytesUsed += res.bytesUsed;

  return {status: WebMParser.STATUS_OK,
          bytesUsed: bytesUsed,
          value: header};
};

/**
 * Parses and returns a WebM SimpleBlock.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @param {number} elementStart Starting offset of the SimpleBlock.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is an Object with
 *     information on the SimpleBlock and the data from the SimpleBlock.
 * @private
 */
WebMParser.prototype.parseSimpleBlock_ = function(buf, start, size,
                                                  elementStart) {
  if (size < 4)
    return {status: WebMParser.STATUS_INVALID_DATA};

  if ((buf[start] & 0x80) != 0x80) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'TrackNumber > 127 not supported'};
  }

  var value = {};
  value.trackNum = buf[start] & 0x7f;
  value.timecode = buf[start + 1] << 8 | buf[start + 2];
  value.flags = buf[start + 3] & 0xff;
  value.lacing = (value.flags >> 1) & 0x3;
  value.blockOffset = elementStart;
  value.dataOffset = start + 4;
  value.dataSize = size - (value.dataOffset - start);

  return {status: WebMParser.STATUS_OK,
          bytesUsed: size,
          value: value};
};

/**
 * Parses and returns a WebM SeekHead element.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is an Object
 *     representing a WebM SeekHead.
 * @private
 */
WebMParser.prototype.parseSeekHead_ = function(buf, start, size) {
  var res = this.parseList_(WebMParser.SEEKHEAD_IDS_, buf, start, size, []);

  if (res.status != WebMParser.STATUS_OK)
    return res;

  var entries = res.value;
  var seekHead = {};
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var name = webmGetIdName(entry.id);
    seekHead[name] = this.segmentOffset_ + entry.position;
  }

  res.value = seekHead;

  return res;
};

/**
 * Parses and returns a WebM SeekEntry element.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is an Object
 *     representing a WebM SeekEntry.
 * @private
 */
WebMParser.prototype.parseSeekEntry_ = function(buf, start, size) {
  return this.parseList_(WebMParser.SEEK_ENTRY_IDS_, buf, start, size, {});
};

/**
 * Parses and returns a WebM SegmentInfo element.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read, 'value' is an Object
 *     representing a WebM SegmentInfo, 'storeElementFunc' gets set so the
 *     WebM SegmentInfo element data gets stored in |infoElement_|.
 * @private
 */
WebMParser.prototype.parseInfo_ = function(buf, start, size) {
  var info = {timecodeScale: 1000000, duration: -1};
  var res = this.parseList_(WebMParser.INFO_IDS_, buf, start, size, info);

  if (res.status == WebMParser.STATUS_OK) {
    var t = this;
    res.storeElementFunc = function(buf) {t.infoElement_ = buf;};
  }

  return res;
};

/**
 * Parses and returns a WebM Tracks element.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read, 'value' is an Object
 *     representing a WebM Tracks, 'storeElementFunc' gets set so the
 *     WebM Tracks element data gets stored in |tracksElement_|.
 * @private
 */
WebMParser.prototype.parseTracks_ = function(buf, start, size) {
  var res = this.parseList_(WebMParser.TRACKS_IDS_, buf, start, size, []);

  if (res.status == WebMParser.STATUS_OK) {
    var t = this;
    res.storeElementFunc = function(buf) {t.tracksElement_ = buf;};
  }
  return res;
};

/**
 * Parses and returns a WebM Track element.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read, 'value' is an Object
 *     representing a WebM Track, 'storeElementFunc' gets set so the
 *     WebM Track element data gets stored in |trackObjects_|.
 * @private
 */
WebMParser.prototype.parseTrackEntry_ = function(buf, start, size) {
  var track = {
    TrackNumber: 0,
    TrackUID: 0,
    TrackType: 0
  };
  var res = this.parseList_(WebMParser.TRACK_IDS_, buf, start, size, track);

  if (res.status == WebMParser.STATUS_OK) {
    var t = this;
    res.storeElementFunc = function(buf) {
      var node = {
        track: res.value,
        buf: buf
      };
      t.trackObjects_.push(node);
    };
  }
  return res;
};

/**
 * Parses and returns a WebM CuePoint element. |segmentOffset_| must be set
 * before calling this function.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is an Object
 *     representing a WebM SeekHead. 'value.cueTime' gets set to seconds from
 *     nanoseconds and 'res.value.trackPosition.cueClusterPos' is adjusted to
 *     the Segment offset.
 * @private
 */
WebMParser.prototype.parsePointEntry_ = function(buf, start, size) {
  var res = this.parseList_(WebMParser.POINT_ENTRY_IDS_, buf, start, size, {});

  if (res.status != WebMParser.STATUS_OK) {
    return res;
  }

  var time_scale = this.timecodeScale_ / 1000000000.0;
  res.value.cueTime = res.value.cueTime * time_scale;
  res.value.trackPosition.cueClusterPos += this.segmentOffset_;
  return res;
};

/**
 * Parses and returns a WebM CueTrackPositions element.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read and 'value' is an Object
 *     representing a WebM CueTrackPositions.
 * @private
 */
WebMParser.prototype.parseTrackPosition_ = function(buf, start, size) {
  return this.parseList_(WebMParser.TRACK_POSITIONS_IDS_, buf, start, size, {});
};

/**
 * Parses and a WebM Cues element. The list of CuePoints is stored in |cues_|.
 * The function will add a seek entry for a Cues element if one was not
 * previously added.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @param {number} offset Start offset of the Cues element.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read.
 * @private
 */
WebMParser.prototype.parseCues_ = function(buf, start, size, offset) {
  var readSize = size;
  var readOffset = start;
  var res = EbmlParser.parseElementHeader(buf, readOffset, readSize);
  if (res.status != EbmlParser.STATUS_OK) {
    return res;
  }

  readOffset += res.bytesUsed;
  readSize -= res.bytesUsed;

  res = this.parseList_(WebMParser.CUES_IDS_, buf, readOffset, readSize, []);
  if (res.status != WebMParser.STATUS_OK) {
    return res;
  }

  this.cues_ = res.value;

  if (this.seekHead_ == null)
    this.seekHead_ = {};

  if (!('CUES' in this.seekHead_)) {
    this.seekHead_['CUES'] = offset;
  }

  return {status: WebMParser.STATUS_OK, bytesUsed: readOffset - start};
};

/**
 * This function parses all of the Segment header elements. |seekHead_|,
 * |timecodeScale_|, and SeekHead Cluster entry are set in this function.
 * |segmentOffset_| will be set if it has not been set already.
 * @param {Uint8Array} buf Source buffer.
 * @param {number} start Starting offset.
 * @param {number} size Size left in current element.
 * @param {number} bufOffset Start offset for |buf|.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'bytesUsed' is the number of bytes read.
 */
WebMParser.prototype.parseSegmentHeaders = function(buf, start, size,
                                                    bufOffset) {
  var readOffset = start;

  this.log('parseSegmentHeaders start=' + start + ' size=' + size +
           ' bufOffset=' + bufOffset);
  var res = EbmlParser.parseElementHeader(buf, readOffset, size);
  if (res.status != EbmlParser.STATUS_OK) {
    return res;
  }

  if (res.id != 0x18538067) { // SEGMENT
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Unexpected element ID. Expected a Segment ID'};
  }

  readOffset += res.bytesUsed;
  if (this.segmentOffset_ == -1)
    this.segmentOffset_ = readOffset;

  res = this.parseList_(WebMParser.SEGMENT_IDS_, buf, readOffset,
                        size - res.bytesUsed, {});

  if (res.status != WebMParser.STATUS_OK) {
    return res;
  }

  readOffset += res.bytesUsed;

  this.seekHead_ = res.value.seekHead;
  this.seekHead_['CLUSTER'] = readOffset + bufOffset;

  this.timecodeScale_ = res.value.info.timecodeScale;
  var timeScale = this.timecodeScale_ / 1000000000.0;
  if (res.value.info.duration > 0 && this.duration_ == -1)
    this.duration_ = res.value.info.duration * timeScale;

  return {status: WebMParser.STATUS_OK, bytesUsed: readOffset - start};
};

/**
 * Returns the SeekHead Object.
 * @return {object} SeekHead Object.
 */
WebMParser.prototype.getSeekHead = function() {
  return this.seekHead_;
};

/**
 * Returns a buffer containing the SegmentInfo element. The buffer includes
 * the element header.
 * @return {Uint8Array} SegmentInfo buffer.
 */
WebMParser.prototype.getInfo = function() {
  return this.infoElement_;
};

/**
 * Returns a buffer containing the Tracks element. The buffer includes the
 * element header.
 * @return {Uint8Array} Tracks buffer.
 */
WebMParser.prototype.getTracks = function() {
  return this.tracksElement_;
};

/**
 * Return an object which contains the track number, uid, type, and buffer
 * containing a track element which includes the element header.
 * @param {number} index Index into the |trackObjects_| array.
 * @return {Object} Track Object or null.
 */
WebMParser.prototype.getTrackObject = function(index) {
  if (index < 0 || index >= this.trackObjects_.length)
    return null;

  return this.trackObjects_[index];
};

/**
 * Return the number of track objects.
 * @return {number} Number of track objects.
 */
WebMParser.prototype.getTrackObjectLength = function() {
  return this.trackObjects_.length;
};

/**
 * Returns the file offset of the first Cluster form the SeekHead.
 * @return {number} File offset or -1 if there is no entry.
 */
WebMParser.prototype.getFirstClusterOffset = function() {
  if (!this.seekHead_['CLUSTER']) {
    return -1;
  }
  return this.seekHead_['CLUSTER'];
};

/**
 * Removes cue elements after the first cue element in the same cluster.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'value' is true on success.
 */
WebMParser.prototype.squishCues = function() {
  if (this.cues_ == null) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Cues is not valid.'};
  }

  for (var i = 0; i < this.cues_.length - 1; ++i) {
    var cueCurr = this.cues_[i];
    var cueNext = this.cues_[i + 1];

    if (cueCurr.trackPosition.cueClusterPos ==
        cueNext.trackPosition.cueClusterPos) {
      this.cues_.splice(i + 1, 1);

      // Check this element again.
      --i;
    }
  }

  return {status: WebMParser.STATUS_OK, value: true};
};

/**
 * Returns the Cues array.
 * @return {Array} Array of CuePoint elements.
 */
WebMParser.prototype.getCues = function() {
  return this.cues_;
};

/**
 * Set the WebM duration.
 * @param {number} duration Duration of the file in seconds.
 */
WebMParser.prototype.setDuration = function(duration) {
  this.duration_ = duration;
};

/**
 * Class to handle WebM files.
 * @param {string} url Link to WebM file.
 * @param {function} opt_log Optional logging function for this class.
 * @constructor
 */
function WebMFileParser(url, opt_log) {
  if (opt_log)
    this.log = opt_log;

  this.parser = new WebMParser();
  this.parser.log = this.log;
  this.file = new HttpFile(url, this.log);


  this.EMPTY_CLUSTER_ = new Uint8Array([0x1F, 0x43, 0xB6, 0x75,
                                        0x01, 0x00, 0x00, 0x00,
                                        0x00, 0x00, 0x00, 0x00]);
}

/**
 * The maximum size in bytes of the partial download.
 * @type {number}
 */
WebMFileParser.prototype.partialDownloadSize = 131072;

/**
 * Logging function to be set by the application.
 * @param {string} str The input string to be logged.
 */
WebMFileParser.prototype.log = function(str) {};

/**
 * Asynchronous function to get a WebM element.
 * @param {number} fileOffset Starting offset of the element.
 * @param {number} id ID of the element.
 * @param {number} emptyReadSize Try to get this many bytes if there are no
 *     bytes stored in memory.
 * @param {function} doneCallback Return function. First parameter passes
 *     back an UintArray8 buffer containing the element and element header.
 * @private
 */
WebMFileParser.prototype.fetchElement_ = function(fileOffset, id, emptyReadSize,
                                                  doneCallback) {
  this.file.seek(fileOffset);

  if (this.file.getBytesAvailable() == 0) {
    var t = this;
    this.file.fetchBytes(emptyReadSize, function(success) {
      if (!success) {
        doneCallback(null);
        return;
      }
      t.fetchElement_(fileOffset, id, emptyReadSize, doneCallback);
    });
    return;
  }

  var res = this.parser.parseElement(this.file.getBuffer(),
                                     this.file.getIndex(),
                                     this.file.getBytesAvailable(),
                                     id);
  if (res.status == WebMParser.STATUS_NEED_MORE_DATA) {
    var t = this;
    var bytesNeeded = this.file.getBytesAvailable() + res.bytesNeeded;
    // Check if the player can request a little more than we need. We read
    // just enough extra so the next element header can be parsed without
    // another request.
    var fileLength = this.file.getFileLength();
    if (fileLength != -1) {
      var end = fileOffset + bytesNeeded;
      if (fileLength >= end + EbmlParser.MAX_ELEMENT_HEADER_SIZE)
        bytesNeeded += EbmlParser.MAX_ELEMENT_HEADER_SIZE;
    }

    this.file.ensureEnoughBytes(bytesNeeded, function(success) {
        if (!success) {
          doneCallback(null);
          return;
        }
        t.fetchElement_(fileOffset, id, emptyReadSize, doneCallback);
      });
    return;
  }

  if (res.status != WebMParser.STATUS_OK) {
    doneCallback(null);
    return;
  }

  var element = res.value;
  this.file.read(element.length);
  doneCallback(element);
};

/**
 * Asynchronous function to parse the WebM Segment headers and Cues element.
 * @param {function} doneCallback Return function. First parameter passes
 *     back a boolean with a value of true if the call was successful.
 * @param {number} ensureSize Value to make sure |ensureSize| bytes are stored
 *     in memory.
 */
WebMFileParser.prototype.doParseHeaders = function(doneCallback, ensureSize) {
  var t = this;
  this.file.ensureEnoughBytes(ensureSize, function(success) {
      if (!success) {
        doneCallback(false);
        return;
      }

      var res = t.parser.parseEBMLHeader_(t.file.getBuffer(), t.file.getIndex(),
                                          t.file.getBytesAvailable());
      if (res.status != WebMParser.STATUS_OK) {
        doneCallback(false);
        return;
      }

      var originalOffset = t.file.getCurrentOffset();
      t.file.read(res.bytesUsed);

      var readOffset = t.file.getIndex();
      var bufferOffset = t.file.getCurrentOffset();
      res = t.parser.parseSegmentHeaders(
          t.file.getBuffer(),
          readOffset,
          t.file.getBytesAvailable() - (readOffset - bufferOffset),
          bufferOffset - readOffset);
      if (res.status == WebMParser.STATUS_OK) {
        t.file.read(res.bytesUsed);
      } else if (res.status == WebMParser.STATUS_NEED_MORE_DATA) {
        t.file.seek(originalOffset);
        // Fetch more bytes and try again.
        window.setTimeout(function() {
          t.doParseHeaders(doneCallback, 2 * ensureSize);
        }, 0);
        return;
      } else if (res.status != WebMParser.STATUS_OK) {
        doneCallback(false);
        return;
      }

      t.fetchIndex(function(success) {
        doneCallback(success);
      });
    });
};

/**
 * Asynchronous function to parse the WebM Segment headers and Cues element.
 * @param {function} doneCallback Return function. First parameter passes
 *     back a boolean with a value of true if the call was successful.
 */
WebMFileParser.prototype.parseHeaders = function(doneCallback) {
  this.doParseHeaders(doneCallback, 4096);
};

/**
 * Returns a buffer containing the SegmentInfo element. The buffer includes
 * the element header.
 * @return {Uint8Array} SegmentInfo buffer or null.
 */
WebMFileParser.prototype.getInfo = function() {
  if (!this.parser)
    return null;
  return this.parser.getInfo();
};

/**
 * Returns a buffer containing the Tracks element. The buffer includes the
 * element header.
 * @return {Uint8Array} Tracks buffer or null.
 */
WebMFileParser.prototype.getTracks = function() {
  if (!this.parser)
    return null;
  return this.parser.getTracks();
};

/**
 * Return an object which contains the track number, uid, type, and buffer
 * containing a track element which includes the element header.
 * @param {number} index Index into the |trackObjects_| array.
 * @return {Object} Track Object or null.
 */
WebMFileParser.prototype.getTrackObject = function(index) {
  if (!this.parser)
    return null;
  return this.parser.getTrackObject(index);
};

/**
 * Return the number of track objects.
 * @return {number} Number of track objects.
 */
WebMFileParser.prototype.getTrackObjectLength = function() {
  if (!this.parser)
    return 0;
  return this.parser.getTrackObjectLength();
};

/**
 * Returns the file offset of the first Cluster form the SeekHead.
 * @return {number} File offset or -1 if there was an error.
 */
WebMFileParser.prototype.getFirstClusterOffset = function() {
  if (!this.parser)
    return -1;
  return this.parser.getFirstClusterOffset();
};

/**
 * Checks if the WebM file is ready to seek.
 * @return {boolean} Returns true if the file headers and seek index have been
 *     parsed.
 */
WebMFileParser.prototype.canSeek = function() {
  return this.parser != null && this.parser.getCues() != null;
};

/**
 * Removes Cue elements after the first Cue element in the same Cluster.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'value' is true on success.
 */
WebMFileParser.prototype.squishCues = function() {
  if (!this.parser) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'WebMParser is not valid.'};
  }
  return this.parser.squishCues();
};

/**
 * Asynchronous function to get and parse a WebM Cues element. The list of
 * CuePoints is stored in |cues_|. There must be a seek entry for a Cues
 * element or the function will return an error.
 * @param {function} doneCallback Return function. First parameter passes
 *     back a boolean with a value of true if the call was successful.
 */
WebMFileParser.prototype.fetchIndex = function(doneCallback) {
  var seekHead = this.parser.getSeekHead();

  if (!('CUES' in seekHead)) {
    doneCallback(false);
    return;
  }

  var t = this;
  var cuesOffset = seekHead['CUES'];
  this.fetchElement_(
      cuesOffset, 0x1C53BB6B, 4096,
      function(element) {
        if (!element) {
          doneCallback(false);
          return;
        }

        var res = t.parser.parseCues_(element, 0, element.length, cuesOffset);
        if (res.status != WebMParser.STATUS_OK) {
          doneCallback(false);
          return;
        }
        doneCallback(true);
      });
};

/**
 * Asynchronous function to get a Cluster time and offset. If the Cues has not
 * been parsed the function will try and parse the Cues.
 * @param {number} seekTime Time to find closest Cluster.
 * @param {function} doneCallback Return function. First parameter passes back
 *     the Cluster time in seconds or -1 on error. Second parameter passes
 *     back the Cluster offset or -1 on error.
 */
WebMFileParser.prototype.getClusterOffset = function(seekTime, doneCallback) {
  var cues = this.parser.getCues();

  if (cues == null) {
    var t = this;
    this.fetchIndex(function(success) {
      if (!success) {
        doneCallback(-1, -1);
        return;
      }

      t.getClusterOffset(seekTime, doneCallback);
    });
    return;
  }

  var l = 0;
  var r = cues.length - 1;
  if (seekTime >= cues[r].cueTime)
    l = r;

  while (l + 1 < r) {
    var m = l + Math.round((r - l) / 2);
    var timestamp = cues[m].cueTime;
    if (timestamp <= seekTime) {
      l = m;
    } else {
      r = m;
    }
  }

  doneCallback(cues[l].cueTime, cues[l].trackPosition.cueClusterPos);
};

/**
 * Asynchronous function to get a Cluster element.
 * @param {number} clusterOffset Starting Cluster offset.
 * @param {function} doneCallback Return function. First parameter passes back
 *     the Cluster length or -1 on error. Second parameter passes
 *     back the Cluster buffer or null on error.
 */
WebMFileParser.prototype.getCluster = function(clusterOffset, doneCallback) {
  this.fetchElement_(clusterOffset, 0x1F43B675, 4 * 4096, function(element) {
    if (!element) {
      doneCallback(-1, null);
      return;
    }
    doneCallback(clusterOffset + element.length, element);
  });
};

/**
 * Parses a Cluster element.
 * @param {UintArray8} cluster Cluster element including the header.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'value' is an Object representing a WebM Cluster element.
 *     'value.clusterTime' is the time of the Cluster in seconds and
 *     'value.blockInfo' is a list of WebM Blocks.
 */
WebMFileParser.prototype.parseCluster = function(cluster) {
  var start = 0;
  var size = cluster.length;
  var res = EbmlParser.parseElementHeader(cluster, start, size);

  if (res.status != WebMParser.STATUS_OK) {
    return res;
  }

  start += res.bytesUsed;
  size -= res.bytesUsed;

  var clusterInfo = {dataOffset: start, blockInfo: []};
  res = this.parser.parseList_(WebMParser.CLUSTER_IDS_, cluster, start, size,
                               clusterInfo);

  if (res.status != WebMParser.STATUS_OK) {
    return res;
  }

  var timeScale = this.timecodeScale_ / 1000000000.0;
  res.value.clusterTime = res.value.clusterTimecode * timeScale;
  var blockInfoCount = res.value.blockInfo.length;
  for (var i = 0; i < blockInfoCount; i++) {
    var bi = res.value.blockInfo[i];
    bi.blockTime = res.value.clusterTime + bi.timecode * timeScale;
  }
  return res;
};

/**
 * Returns a new Cluster buffer truncated to |time|.
 * @param {UintArray8} cluster Source Cluster buffer.
 * @param {number} time Time in seconds to truncate too.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'cluster' is an Object representing the truncated WebM Cluster element
 *     including the header and 'endTime' is the end time of the truncate
 *      Cluster in seconds.
 */
WebMFileParser.prototype.truncateCluster = function(cluster, time) {
  var res = this.parseCluster(cluster);

  if (res.status != WebMParser.STATUS_OK) {
    return res;
  }

  var ci = res.value;
  if (ci.clusterTime > time) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Specified time is before the start of the cluster'};
  }

  var endOffset = -1;
  var endTime = -1;
  var blockCount = ci.blockInfo.length;
  for (var i = 0; i < blockCount; i++) {
    var bi = ci.blockInfo[i];
    if (bi.blockTime > time) {
      // TODO(fgalligan): Change function to work with Blocks too.
      endOffset = bi.blockOffset;
      endTime = bi.blockTime;
      break;
    }
  }

  if (endOffset == -1) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Failed to find a block after ' + time};
  }

  var headerSize = this.EMPTY_CLUSTER_.length;
  var dataSize = endOffset - ci.dataOffset;
  var newCluster = new Uint8Array(headerSize + dataSize);
  newCluster.set(this.EMPTY_CLUSTER_, 0);
  newCluster.set(cluster.subarray(ci.dataOffset, endOffset), headerSize);
  var tmp = dataSize;
  for (var i = 0; i < 7; ++i) {
    newCluster[11 - i] = tmp & 0xff;
    tmp >>= 8;
  }

  return {status: WebMParser.STATUS_OK,
          endTime: endTime,
          cluster: newCluster};
};

/**
 * Set the file's duration.
 * @param {number} duration Duration of the file in seconds.
 */
WebMFileParser.prototype.setDuration = function(duration) {
  this.parser.setDuration(duration);
};

/**
 * Returns a cueDesc object.
 * @param {Object} index Index into the Cues list.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'value' is a cueDesc object.
 * @private
 */
WebMFileParser.prototype.getCueDescFromCue_ = function(index) {
  var cues = this.parser.getCues();
  if (!cues || cues.length == 0) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Cues is not valid.'};
  }

  if (index >= cues.length) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Cues index is out of bounds.'};
  }

  // Set size and endTime to unknown.
  var size = -1;
  var endTime = -1;
  var startOffset = cues[index].trackPosition.cueClusterPos;
  var cueEnd = index + 1;
  while ((cueEnd < cues.length) &&
         (startOffset == cues[cueEnd].trackPosition.cueClusterPos)) {
    cueEnd++;
  }

  // TODO(fgalligan): Pre-calculate the size and duration of all the cues.
  if (cueEnd < cues.length) {
    size = cues[cueEnd].trackPosition.cueClusterPos - startOffset;
    endTime = cues[cueEnd].cueTime;
  } else {
    // On the last cue element. Use the start of the Cues element as the
    // ending offset for the last cluster.
    var seekHead = this.parser.getSeekHead();
    if (seekHead && seekHead['CUES'] > startOffset) {
      size = seekHead['CUES'] - startOffset;
    }
    endTime = this.parser.duration_;
  }

  var cueDesc = {
    time: cues[index].cueTime,
    offset: startOffset,
    size: size,
    endTime: endTime
  };

  return {status: WebMParser.STATUS_OK,
          value: cueDesc};
};

/**
 * Returns the first cueDesc object.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'value' is a cueDesc object.
 */
WebMFileParser.prototype.getFirstCueDesc = function() {
  var seekHead = this.parser.getSeekHead();
  if (!seekHead || !seekHead['CLUSTER']) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'SeekHead does not contain a valid Cluster entry.'};
  }

  return this.getCueDescFromCue_(0);
};

/**
 * Returns a cueDesc object that has a starting offset that is closest to
 *     |offset| with |offset| being greater than or equal to cueDesc's
 *     starting offset.
 * @param {number} offset Byte offset into the WebM file.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'value' is a cueDesc object.
 */
WebMFileParser.prototype.getCueDescFromOffset = function(offset) {
  var cues = this.parser.getCues();
  if (!cues || cues.length == 0) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Cues is not valid.'};
  }

  var l = 0;
  var r = cues.length - 1;
  if (offset >= cues[r].trackPosition.cueClusterPos)
    l = r;

  while (l + 1 < r) {
    var m = l + Math.round((r - l) / 2);
    var off = cues[m].trackPosition.cueClusterPos;
    if (off <= offset) {
      l = m;
    } else {
      r = m;
    }
  }

  return this.getCueDescFromCue_(l);
};

/**
 * Returns a Cue index that has a starting time that is closest to |time| with
 * |time| being greater than or equal to the Cue's starting time.
 * @param {number} time In seconds.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'value' is a cueDesc index.
 * @private
 */
WebMFileParser.prototype.getCueIndexFromTime_ = function(time) {
  var cues = this.parser.getCues();
  if (!cues || cues.length == 0) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Cues is not valid.'};
  }

  var l = 0;
  var r = cues.length - 1;
  if (time >= cues[r].cueTime)
    l = r;

  while (l + 1 < r) {
    var m = l + Math.round((r - l) / 2);
    var timestamp = cues[m].cueTime;
    if (timestamp <= time) {
      l = m;
    } else {
      r = m;
    }
  }

  return {status: WebMParser.STATUS_OK,
          value: l};
};

/**
 * Returns a cueDesc object that has a starting time that is closest to |time|
 * with |time| being greater than or equal to cueDesc's starting time.
 * @param {number} time In seconds.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'value' is a cueDesc object.
 */
WebMFileParser.prototype.getCueDescFromTime = function(time) {
  var res = this.getCueIndexFromTime_(time);
  if (res.status != WebMParser.STATUS_OK)
    return res;

  return this.getCueDescFromCue_(res.value);
};

/**
 * Asynchronous function that returns a full cluster element and the next
 * cueDesc.
 * @param {Object} cueDesc cueDesc to read.
 * @param {number} bytesRead Number of bytes read in the current cluster.
 * @param {function} doneCallback Callback function. First parameter is the
 *     next cueDesc object or null on error. Second parameter is the cluster
 *     element or null on error.
 */
WebMFileParser.prototype.getClusterFromCueDesc = function(cueDesc,
                                                          bytesRead,
                                                          doneCallback) {
  var size = cueDesc.size - bytesRead;
  if (size <= 0)
    size = 4 * 4096;

  var offset = cueDesc.offset + bytesRead;

  var t = this;
  this.fetchElement_(offset, 0x1F43B675, size,
    function(element) {
      if (!element) {
        doneCallback(null, null);
        return;
      }
      var res = t.getCueDescFromOffset(offset + element.length);
      if (res.status != WebMParser.STATUS_OK) {
        //this.log('Could not get cueDesc from offset. ' + res.reason);
        doneCallback(null, null);
        return;
      }

      var nextCueDesc = res.value;
      // Check if the current cueDesc is the last cue.
      if (nextCueDesc.offset == cueDesc.offset)
        nextCueDesc = null;
      doneCallback(nextCueDesc, element);
    });
};

/**
 * Asynchronous function that parses the WebM file headers.
 * @param {number} offset Offset to start reading the file from.
 * @param {number} size Number of bytes to read.
 * @param {function} doneCallback Callback function. First parameter passes
 *     back a boolean with a value of true if the call was successful.
 */
WebMFileParser.prototype.parseFirstHeaders = function(offset, size,
                                                      doneCallback) {
  var t = this;

  this.file.seek(offset);

  this.file.ensureEnoughBytes(size, function(success) {
     if (!success) {
       doneCallback(false);
       return;
     }

     var res = t.parser.parseEBMLHeader_(t.file.getBuffer(), t.file.getIndex(),
                                         t.file.getBytesAvailable());
      if (res.status != WebMParser.STATUS_OK) {
        doneCallback(false);
        return;
      }

     // Update file to indicate that we have used some bytes.
     t.file.read(res.bytesUsed);

     var readOffset = t.file.getIndex();
     var bufferOffset = t.file.getCurrentOffset();
     if (!t.parser.parseSegmentHeaders(t.file.getBuffer(), readOffset,
         t.file.getBytesAvailable() - (readOffset - bufferOffset),
         bufferOffset)) {
       doneCallback(false);
       return;
     }

     doneCallback(true);
   });
};

/**
 * Asynchronous function that parses the WebM Cues element.
 * @param {number} offset Offset to start reading the file from.
 * @param {number} size Number of bytes to read.
 * @param {number} segmentOffset Offset to the Segment element.
 * @param {function} doneCallback Callback function. First parameter passes
 *     back a boolean with a value of true if the call was successful.
 */
WebMFileParser.prototype.fetchCues = function(offset, size, segmentOffset,
                                              doneCallback) {
  //this.log('fetchCues offset=' + offset + ' size=' + size);
  this.parser.setSegmentOffset(segmentOffset);

  var t = this;
  this.fetchElement_(offset, 0x1C53BB6B, size, function(element) {
    if (!element) {
      doneCallback(false);
      return;
    }

    var res = t.parser.parseCues_(element, 0, element.length, offset);
    if (res.status != WebMParser.STATUS_OK) {
      doneCallback(false);
      return;
    }
    doneCallback(true);
  });
};

/**
 * Calcualtes how much time will be buffered after a given amount of wallclock
 * time has passed. The CUES element must be parsed before this function is
 * called.
 * @param {number} time The time in seconds of the stream to start from.
 * @param {number} timeToSearch The wallclock time in seconds to emulate.
 * @param {number} kbps The download rate in kilobits per second.
 * @param {number} buffer The amount of time in seconds currently buffered.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'seconds' the wallclock time in seconds used to perform the calculation
 *     and 'buffer' is the amount of time in seconds in the buffer.
 */
WebMFileParser.prototype.bufferSizeAfterTime = function(time,
                                                        timeToSearch,
                                                        kbps,
                                                        buffer) {
  var res = this.getCueIndexFromTime_(time);
  if (res.status != WebMParser.STATUS_OK)
    return res;
  var startingIndex = res.value;

  res = this.getCueDescFromCue_(startingIndex);
  if (res.status != WebMParser.STATUS_OK)
    return res;
  var currentCueDesc = res.value;

  var secDownloading = 0.0;
  var secDownloaded = 0.0;
  var index = startingIndex;

  //Check for non cue start time.
  if (time > currentCueDesc.time) {
    var cueSec = currentCueDesc.endTime - time;
    var percent = cueSec / (currentCueDesc.endTime - currentCueDesc.time);
    var cueBytes = currentCueDesc.size * percent;
    var timeToDownload = ((cueBytes * 8) / 1000.0) / kbps;

    secDownloading += timeToDownload;
    secDownloaded += cueSec;

    if (secDownloading > timeToSearch) {
      secDownloaded = (timeToSearch / secDownloading) * secDownloaded;
      secDownloading = timeToSearch;
    }

    index++;
  }

  var cues = this.parser.getCues();
  if (!cues || cues.length == 0) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Cues is not valid.'};
  }

  while (index < cues.length && secDownloading < timeToSearch) {
    res = this.getCueDescFromCue_(index);
    if (res.status != WebMParser.STATUS_OK)
      return res;
    var currentCueDesc = res.value;

    //this.log(' cue time:' + currentCueDesc.time + ' offset:' +
    //         currentCueDesc.offset + ' endTime:' + currentCueDesc.endTime +
    //         ' size:' + currentCueDesc.size);

    var cueBytes = currentCueDesc.size;
    var cueSec = currentCueDesc.endTime - currentCueDesc.time;
    var timeToDownload = ((cueBytes * 8) / 1000.0) / kbps;

    secDownloading += timeToDownload;
    secDownloaded += cueSec;

    if (secDownloading > timeToSearch) {
      secDownloaded = (timeToSearch / secDownloading) * secDownloaded;
      secDownloading = timeToSearch;
      break;
    }

    index++;
  }

  var bufferCounted = secDownloaded - secDownloading + buffer;
  var secCounted = secDownloading;

  return {
    status: WebMParser.STATUS_OK,
    seconds: secCounted,
    buffer: bufferCounted
  };
};

/**
 * Calcualtes how much time will be buffered after the player has buffered a
 * certain amouint of time in the stream. The CUES element must be parsed
 * before this function is called.
 * @param {number} time The time in seconds of the stream to start from.
 * @param {number} timeToSearch The number of seconds to search for in the
 *     stream.
 * @param {number} kbps The download rate in kilobits per second.
 * @param {number} minBuffer The minimum time in seconds that must be in the
 *     buffer.
 * @param {number} buffer The amount of time in seconds currently buffered.
 * @return {Object} Status object. If 'status' is EbmlParser.STATUS_OK,
 *     'underrun' is true if a buffer under-run condition occurred,
 *     'downloadTime' is the time in seconds that it took to download the data,
 *     and 'buffer' is the amount of time in seconds in the buffer.
 */
WebMFileParser.prototype.bufferSizeAfterTimeDownloaded = function(time,
                                                                  timeToSearch,
                                                                  kbps,
                                                                  minBuffer,
                                                                  buffer) {
  var res = this.getCueIndexFromTime_(time);
  if (res.status != WebMParser.STATUS_OK)
    return res;
  var startingIndex = res.value;

  res = this.getCueDescFromCue_(startingIndex);
  if (res.status != WebMParser.STATUS_OK)
    return res;
  var currentCueDesc = res.value;

  var bufferUnderrun = false;
  var endTime = time + timeToSearch;
  var secToDownload = 0.0;
  var secDownloaded = 0.0;
  var index = startingIndex;

  // Check for non cue start time.
  if (time > currentCueDesc.time) {
    var cueSec = currentCueDesc.endTime - time;
    var percent = cueSec / (currentCueDesc.endTime - currentCueDesc.time);
    var cueBytes = currentCueDesc.size * percent;
    var timeToDownload = ((cueBytes * 8) / 1000.0) / kbps;

    secDownloaded += cueSec - timeToDownload;
    secToDownload += timeToDownload;

    // Check if the search ends within the first cue.
    if (currentCueDesc.endTime >= endTime) {
      var percentToSub = timeToSearch / (currentCueDesc.endTime - time);
      secDownloaded = percentToSub * secDownloaded;
      secToDownload = percentToSub * secToDownload;

      if ((secDownloaded + buffer) <= minBuffer)
        bufferUnderrun = true;

      return {
        status: WebMParser.STATUS_OK,
        underrun: bufferUnderrun,
        downloadTime: secToDownload,
        buffer: buffer + secDownloaded
      };
    } else if ((secDownloaded + buffer) <= minBuffer) {
      bufferUnderrun = true;

      return {
        status: WebMParser.STATUS_OK,
        underrun: bufferUnderrun,
        downloadTime: secToDownload,
        buffer: buffer + secDownloaded
      };
    }

    index++;
  }

  var cues = this.parser.getCues();
  if (!cues || cues.length == 0) {
    return {status: WebMParser.STATUS_INVALID_DATA,
            reason: 'Cues is not valid.'};
  }

  while (index < cues.length) {
    res = this.getCueDescFromCue_(index);
    if (res.status != WebMParser.STATUS_OK)
      return res;
    var currentCueDesc = res.value;

    //this.log(' cue time:' + currentCueDesc.time + ' offset:' +
    //  currentCueDesc.offset + ' endTime:' + currentCueDesc.endTime +
    //  ' size:' + currentCueDesc.size);

    var cueBytes = currentCueDesc.size;
    var cueSec = currentCueDesc.endTime - currentCueDesc.time;
    var timeToDownload = ((cueBytes * 8) / 1000.0) / kbps;

    secDownloaded += cueSec - timeToDownload;
    secToDownload += timeToDownload;

    if (currentCueDesc.endTime >= endTime) {
      var percentToSub = timeToSearch / (currentCueDesc.endTime - time);
      secDownloaded = percentToSub * secDownloaded;
      secToDownload = percentToSub * secToDownload;

      if ((secDownloaded + buffer) <= minBuffer)
        bufferUnderrun = true;
      break;
    }

    if ((secDownloaded + buffer) <= minBuffer) {
      bufferUnderrun = true;
      break;
    }

    index++;
  }

  return {
    status: WebMParser.STATUS_OK,
    underrun: bufferUnderrun,
    downloadTime: secToDownload,
    buffer: buffer + secDownloaded
  };
};

/**
 * Asynchronous function that parses the file headers using unbuffered reads.
 * @param {number} offset Starting offset in the file to read from.
 * @param {number} size Number of bytes to read.
 * @param {function} doneCallback Callback function. First parameter passes
 *     back a boolean with a value of true if the call was successful.
 */
WebMFileParser.prototype.parseFirstHeadersUnbuffered = function(offset,
                                                                size,
                                                                doneCallback) {
  var t = this;

  this.file.fetchBytesUnbuffered(offset, size, function(buffer) {
    if (!buffer) {
      doneCallback(false);
      return;
    }

    var readOffset = 0;
    var res = t.parser.parseEBMLHeader_(buffer, readOffset, buffer.length);
    if (res.status != WebMParser.STATUS_OK) {
      doneCallback(false);
      return;
    }
    readOffset += res.bytesUsed;

    res = t.parser.parseSegmentHeaders(buffer, readOffset,
                                       buffer.length - (readOffset - offset),
                                       offset);
    if (res.status != WebMParser.STATUS_OK) {
      doneCallback(false);
      return;
    }

    doneCallback(true);
  });
};

/**
 * Asynchronous function that parses the Cues using unbuffered reads.
 * @param {number} offset Starting offset in the file to read from.
 * @param {number} size Number of bytes to read.
 * @param {number} segmentOffset Segment offset in a WebM file.
 * @param {function} doneCallback Callback function. First parameter passes
 *     back a boolean with a value of true if the call was successful.
 */
WebMFileParser.prototype.fetchCuesUnbuffered = function(offset, size,
                                                        segmentOffset,
                                                        doneCallback) {
  this.log('fetchCuesUnbuffered offset=' + offset + ' size=' + size);

  this.parser.setSegmentOffset(offset);

  var t = this;
  this.file.fetchBytesUnbuffered(offset, size, function(buffer) {
    if (!buffer) {
      doneCallback(false);
      return;
    }

    var res = t.parser.parseCues_(element, 0, element.length, offset);
    if (res.status != WebMParser.STATUS_OK) {
      doneCallback(false);
      return;
    }
    doneCallback(true);
  });
};

/**
 * Sets the file position and returns partial cluster data until the full Cue
 *     element is returned. Data returned will be only in the current Cue
 *     element. Calling funciton must expect one or more callbacks until next
 *     cueDesc is different than |cueDesc|, next cueDesc is null,
 *     or data returned is null and the next cueDesc is null. The next
 *     cueDesc returned will have the same values as |cueDesc| to
 *     signal that there is more data to come in the current Cue element. When
 *     all of the data for the current Cue element has been returned the next
 *     cueDesc will represent the next Cue element of the current WebM
 *     file. If the next cueDesc is null then that signals that the cluster
 *     data is EOF. If the data returned is null and the next cueDesc is
 *     null then that signals an error condition.
 * @param {Object} cueDesc cueDesc to read.
 * @param {function} doneCallback Callback function. First parameter is the
 *     next cueDesc object or null on error. Second parameter is the cluster
 *     element or null on error.
 */
WebMFileParser.prototype.fetchCueData = function(cueDesc, doneCallback) {
  //this.log('fetchCueData offset:' + cueDesc.offset + ' url:' +
  //          this.file.url_);

  // Seek to the beginning of the cluster element.
  this.file.seek(cueDesc.offset);
  this.sendCueData_(cueDesc, doneCallback);
};

/**
 * Returns partial cluster data until the full Cue element is returned. Will
 *     not return data in the next cue element. The next cueDesc returned
 *     will have the same values as |cueDesc| to signal that there is more
 *     data to come in the current Cue element. When all of the data for the
 *     current Cue element has been returned the next cueDesc will
 *     represent the next Cue element of the current WebM file. If the next
 *     cueDesc is null then that signals that the cluster data is EOF. If
 *     the data returned is null and the next cueDesc is null then that
 *     signals an error condition.
 * @param {Object} cueDesc cueDesc to read.
 * @param {function} doneCallback Callback function. First parameter is the
 *     next cueDesc object or null on error. Second parameter is the cluster
 *     element or null on error.
 * @private
 */
WebMFileParser.prototype.sendCueData_ = function(cueDesc, doneCallback) {
  var sendFullChunks = true;
  var chunkSize = cueDesc.size;
  var bufferSize = this.file.getBytesAvailable();
  var bytesSent = this.file.getCurrentOffset() - cueDesc.offset;
  var chunkSizeLeft = chunkSize - bytesSent;
  var bytesToSend = bufferSize;

  if (bytesToSend > chunkSizeLeft)
    bytesToSend = chunkSizeLeft;

  //this.log('sendCueData_ chunkSize:' + chunkSize +
  //         ' bufferSize:' + bufferSize + ' bytesSent:' + bytesSent +
  //         ' chunkSizeLeft:' + chunkSizeLeft +
  //         ' bytesToSend:' + bytesToSend + ' url:' + this.file.url_);

  if ((!sendFullChunks && bytesToSend > 0) || (bytesToSend == chunkSize)) {
    var nextCueDesc = null;

    // Check if we have downloaded all of the current cluster's data and we
    // should get the next cueDesc.
    if (bytesToSend == chunkSizeLeft) {
      var res = this.getCueDescFromOffset(cueDesc.offset + cueDesc.size);
      if (res.status != WebMParser.STATUS_OK) {
        this.log('sendCueData_ error Could not get cueDesc from offset. :' +
                 res.reason);
        doneCallback(null, null);
        return;
      }

      nextCueDesc = res.value;
      // Check if the current Cue is the last Cue.
      if (nextCueDesc.offset == cueDesc.offset)
        nextCueDesc = null;
    } else {
      // Signal there is still more data in the current Cue.
      nextCueDesc = cueDesc;
    }

    var start = this.file.getIndex();
    var end = start + bytesToSend;
    var element = new Uint8Array(this.file.getBuffer().subarray(start, end));
    this.file.read(element.length);

    // If |downloadMoreData| is false do not request any more data. This might
    // be because of an error or maybe the user seeked. Do not treat this as an
    // error.
    var downloadMoreData = doneCallback(nextCueDesc, element);

    // Check to see if we need to download anymore data from the current cue
    // chunk.
    if (nextCueDesc == null || nextCueDesc.offset != cueDesc.offset ||
        !downloadMoreData)
      return;

    bytesSent += bytesToSend;
    chunkSizeLeft -= bytesToSend;
  }

  var size = this.file.getBytesAvailable();
  if (sendFullChunks) {
    size += chunkSizeLeft;
  } else {
    size += this.partialDownloadSize;
  }
  if (size > chunkSizeLeft)
    size = chunkSizeLeft;

  if (this.file.getBytesAvailable() < size) {
    var t = this;
    this.file.fetchBytes(size, function(success) {
      if (!success) {
        this.log('sendCueData_ error fetchBytes offset:' + offset + ' size:' +
                 size);
        doneCallback(null, null);
        return;
      }
      t.sendCueData_(cueDesc, doneCallback);
    });
  }
};

/**
 * Getter for partialDownloadSize.
 * @return {number} partialDownloadSize.
 */
WebMFileParser.prototype.getPartialDownloadSize = function() {
  return this.partialDownloadSize;
};

/**
 * Setter for partialDownloadSize.
 * @param {number} value The value to set.
 */
WebMFileParser.prototype.setPartialDownloadSize = function(value) {
  this.partialDownloadSize = value;
};
