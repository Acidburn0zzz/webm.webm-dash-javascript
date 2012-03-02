// Copyright (c) 2012 The WebM project authors. All Rights Reserved.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file in the root of the source
// tree. An additional intellectual property rights grant can be found
// in the file PATENTS.  All contributing project authors may
// be found in the AUTHORS file in the root of the source tree.

'use strict';

/**
 * General error status class.
 * @param {string} errorStr Information on the error value.
 * @param {number} opt_errorStatus Optional error value. If null status
 *     will be set to DashParser.STATUS_INVALID_DATA.
 * @constructor
 */
function ErrorStatus(errorStr, opt_errorStatus) {
  this.reason = errorStr;
  this.status = opt_errorStatus || ErrorStatus.STATUS_ERROR;
}

/**
 * Return code signaling everything is fine. Do not use 0 as a value or the
 * optional parameter on DashParserStatus will not work.
 * @const
 * @type {number}
 */
ErrorStatus.STATUS_OK = 1;

/**
 * General error return code.
 * @const
 * @type {number}
 */
ErrorStatus.STATUS_ERROR = -1;

/**
 * Information on the error value.
 * @type {string}
 */
ErrorStatus.prototype.reason = null;

/**
 * The error value.
 * @type {number}
 */
ErrorStatus.prototype.status = ErrorStatus.STATUS_ERROR;

/**
 * Convenience class for creating a STATUS_OK object.
 * @constructor
 */
function OKStatus() {
}

/**
 * Information on the error value.
 * @type {string}
 */
OKStatus.prototype.reason = null;

/**
 * The error value.
 * @type {number}
 */
OKStatus.prototype.status = ErrorStatus.STATUS_OK;


function addPageLoadEvent(func) {
  window.addEventListener('load', func);
}

function logToElement(id, str) {
  var fragment = document.createDocumentFragment();
  fragment.appendChild(document.createTextNode(str));
  fragment.appendChild(document.createElement('br'));

  document.querySelector('#' + id).appendChild(fragment);
}

function readyStateName(code) {
  var names = [
    'HAVE_NOTHING',
    'HAVE_METADATA',
    'HAVE_CURRENT_DATA',
    'HAVE_FUTURE_DATA',
    'HAVE_ENOUGH_DATA'
  ];
  if (code >= 0 && code <= names.length) {
    return names[code];
  }

  return 'Unknown ready state ' + code;
}

function networkStateName(code) {
  var names = [
    'NETWORK_EMPTY',
    'NETWORK_IDLE',
    'NETWORK_LOADING',
    'NETWORK_NO_SOURCE'
  ];
  if (code >= 0 && code <= names.length) {
    return names[code];
  }

  return 'Unknown network state ' + code;
}

function errorName(error) {
  if (error == null)
    return 'null';

  var names = [
    'MEDIA_ERR_NONE',
    'MEDIA_ERR_ABORTED',
    'MEDIA_ERR_NETWORK',
    'MEDIA_ERR_DECODE',
    'MEDIA_ERR_SRC_NOT_SUPPORTED'
  ];
  if (error.code >= 0 && error.code <= names.length) {
    return names[error.code];
  }

  return 'Unknown error ' + error.code;
}

function dump_hash(o) {
  for (var i in o) {
    log(i + ' : ' + o[i]);
  }
}
