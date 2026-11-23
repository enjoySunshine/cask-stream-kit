var uint8ToCString = require('../utils/string.js').uint8ToCString;
var getUint64 = require('../utils/numbers.js').getUint64;

// The scheme used to carry ID3 timed metadata inside of fragmented MP4
// segments. This matches the convention used to transport HLS ID3 metadata
// through DASH event message boxes.
var ID3_EMSG_SCHEME = 'https://aomedia.org/emsg/ID3';
var ID3_EMSG_VALUE = 'hls';

/**
 * Build a full, top-level `emsg` box (including the 8 byte box header) using
 * the version 1 layout. The version 1 layout carries an absolute
 * presentation_time expressed in the box's own timescale, which lets the
 * event timing be stored independently of any track's media timeline.
 *
 * @param {Object} options
 * @param {number} options.timescale the timescale for the timing fields
 * @param {number} options.presentationTime absolute presentation time, in
 *                 units of `timescale`
 * @param {number} [options.eventDuration=0] event duration, in units of
 *                 `timescale`
 * @param {number} [options.id=0] event identifier
 * @param {string} [options.schemeIdUri] the emsg scheme_id_uri
 * @param {string} [options.value] the emsg value
 * @param {Uint8Array} options.messageData the event payload (ID3 tag bytes)
 * @returns {Uint8Array} the serialized emsg box
 */
var generateEmsgBox = function(options) {
  var schemeIdUri = options.schemeIdUri || ID3_EMSG_SCHEME;
  var value = options.value || ID3_EMSG_VALUE;
  var timescale = options.timescale;
  // presentation times describe positions on a non-negative media timeline,
  // so clamp anything below zero (e.g. metadata that predates the adjusted
  // segment start) instead of encoding a negative 64 bit value
  var presentationTime = Math.max(0, options.presentationTime);
  var eventDuration = options.eventDuration || 0;
  var id = options.id || 0;
  var messageData = options.messageData;

  var schemeBytes = [];
  var i;

  for (i = 0; i < schemeIdUri.length; i++) {
    schemeBytes.push(schemeIdUri.charCodeAt(i));
  }
  schemeBytes.push(0); // null terminator

  var valueBytes = [];

  for (i = 0; i < value.length; i++) {
    valueBytes.push(value.charCodeAt(i));
  }
  valueBytes.push(0); // null terminator

  // version/flags (4) + timescale (4) + presentation_time (8) +
  // event_duration (4) + id (4) + scheme + value + message
  var payloadLength = 4 + 4 + 8 + 4 + 4 +
    schemeBytes.length + valueBytes.length + messageData.byteLength;
  var result = new Uint8Array(8 + payloadLength);
  var view = new DataView(result.buffer);
  var offset = 8;

  // box size and type
  view.setUint32(0, result.byteLength);
  result.set([0x65, 0x6d, 0x73, 0x67], 4); // 'emsg'

  // version 1, flags 0
  result[offset] = 0x01;
  result[offset + 1] = 0;
  result[offset + 2] = 0;
  result[offset + 3] = 0;
  offset += 4;

  view.setUint32(offset, timescale);
  offset += 4;

  // 64 bit presentation time. Split into high/low 32 bit words so values
  // above 2^32 are encoded correctly.
  view.setUint32(offset, Math.floor(presentationTime / 0x100000000));
  view.setUint32(offset + 4, presentationTime >>> 0);
  offset += 8;

  view.setUint32(offset, eventDuration);
  offset += 4;

  view.setUint32(offset, id);
  offset += 4;

  result.set(schemeBytes, offset);
  offset += schemeBytes.length;

  result.set(valueBytes, offset);
  offset += valueBytes.length;

  result.set(messageData, offset);

  return result;
};

/**
 * Based on: ISO/IEC 23009 Section: 5.10.3.3
 * References:
 * https://dashif-documents.azurewebsites.net/Events/master/event.html#emsg-format
 * https://aomediacodec.github.io/id3-emsg/
 * 
 * Takes emsg box data as a uint8 array and returns a emsg box object
 * @param {UInt8Array} boxData data from emsg box
 * @returns A parsed emsg box object
 */
var parseEmsgBox = function(boxData) {
  // version + flags
  var offset = 4;
  var version = boxData[0];
  var scheme_id_uri, 
    value, 
    timescale, 
    presentation_time, 
    presentation_time_delta, 
    event_duration, 
    id,
    message_data;
  if (version === 0) {
    scheme_id_uri = uint8ToCString(boxData.subarray(offset));
    offset += scheme_id_uri.length;
    value = uint8ToCString(boxData.subarray(offset));
    offset += value.length;
    var dv = new DataView(boxData.buffer, boxData.byteOffset, boxData.byteLength);
    timescale = dv.getUint32(offset);
    offset += 4;
    presentation_time_delta = dv.getUint32(offset);
    offset += 4;
    event_duration = dv.getUint32(offset);
    offset += 4;
    id = dv.getUint32(offset);
    offset += 4;
  } else if (version === 1) {
    var dv = new DataView(boxData.buffer, boxData.byteOffset, boxData.byteLength);
    timescale = dv.getUint32(offset);
    offset += 4;
    presentation_time = getUint64(boxData.subarray(offset));
    offset += 8;
    event_duration = dv.getUint32(offset);
    offset += 4;
    id = dv.getUint32(offset);
    offset += 4;
    scheme_id_uri = uint8ToCString(boxData.subarray(offset));
    offset += scheme_id_uri.length;
    value = uint8ToCString(boxData.subarray(offset));
    offset += value.length;        
  }

  message_data = new Uint8Array(boxData.subarray(offset, boxData.byteLength));
  var emsgBox = {
    scheme_id_uri, 
    value,
    // if timescale is undefined or 0 set to 1 
    timescale: timescale ? timescale : 1, 
    presentation_time, 
    presentation_time_delta, 
    event_duration, 
    id,
    message_data };

  return isValidEmsgBox(version, emsgBox) ? emsgBox : undefined;
};

/**
 * Scales a presentation time or time delta with an offset with a provided timescale
 * @param {number} presentationTime 
 * @param {number} timescale 
 * @param {number} timeDelta 
 * @param {number} offset 
 * @returns the scaled time as a number
 */
var scaleTime = function(presentationTime, timescale, timeDelta, offset) {
  if (presentationTime || presentationTime === 0) {
    // getUint64 returns a BigInt for values that exceed Number.MAX_SAFE_INTEGER.
    // Convert before dividing so fractional seconds are preserved; emsg
    // presentation times are well within the safe integer range in practice.
    if (typeof presentationTime === 'bigint') {
      presentationTime = Number(presentationTime);
    }
    return presentationTime / timescale;
  }
  return offset + timeDelta / timescale;
};

/**
 * Checks the emsg box data for validity based on the version
 * @param {number} version of the emsg box to validate
 * @param {Object} emsg the emsg data to validate
 * @returns if the box is valid as a boolean
 */
var isValidEmsgBox = function(version, emsg) {
  var hasScheme = emsg.scheme_id_uri !== '\0'
  var isValidV0Box = version === 0 && isDefined(emsg.presentation_time_delta) && hasScheme;
  var isValidV1Box = version === 1 && isDefined(emsg.presentation_time) && hasScheme;
  // Only valid versions of emsg are 0 and 1
  return !(version > 1) && isValidV0Box || isValidV1Box;
};

// Utility function to check if an object is defined
var isDefined = function(data) {
  return data !== undefined || data !== null;
};

module.exports = {
  parseEmsgBox: parseEmsgBox,
  scaleTime: scaleTime,
  generateEmsgBox: generateEmsgBox,
  ID3_EMSG_SCHEME: ID3_EMSG_SCHEME,
  ID3_EMSG_VALUE: ID3_EMSG_VALUE
};
