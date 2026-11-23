/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0
 *
 * Serializes parsed ID3 tags back into ID3v2.3 bytes. Used to embed timed
 * metadata (for instance, the com.apple.streaming.transportStreamTimestamp
 * PRIV frame carried by raw AAC streams) inside of fragmented MP4 segments so
 * that the metadata survives being written to disk and re-probed later.
 *
 * This is the write-side counterpart to lib/tools/parse-id3.js. The bytes
 * produced here are intended to round-trip through parseId3Frames.
 *
 * @see http://id3.org/id3v2.3.0
 */
'use strict';

var ID3_IDENTIFIER = [0x49, 0x44, 0x33]; // 'ID3'

// Encode a non-negative integer as four 7-bit values (sync-safe integer),
// the size encoding used throughout ID3v2.
var toSyncSafeInteger = function(value) {
  return [
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f
  ];
};

var stringToBytes = function(string) {
  var result = [], i;

  for (i = 0; i < string.length; i++) {
    result.push(string.charCodeAt(i) & 0xff);
  }
  return result;
};

// A null terminated string.
var stringToCStringBytes = function(string) {
  return stringToBytes(string).concat([0x00]);
};

var concat = function() {
  var result = [], i, j;

  for (i = 0; i < arguments.length; i++) {
    for (j = 0; j < arguments[i].length; j++) {
      result.push(arguments[i][j]);
    }
  }
  return result;
};

var toBytes = function(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === 'string') {
    return stringToBytes(value);
  }
  // typed arrays and array-likes of byte values
  return Array.prototype.slice.call(value);
};

/**
 * Serialize a single parsed ID3 frame back into its on-the-wire form.
 *
 * The frame is expected to look like the objects produced by the parsing
 * code: an `id`, an optional `owner` for PRIV frames and `data` holding the
 * frame body. For PRIV frames the owner identifier (null terminated) is
 * re-derived from `owner` when present, otherwise it is assumed to already be
 * included at the front of `data`.
 *
 * @param {Object} frame a parsed ID3 frame
 * @returns {number[]} the serialized frame bytes (header + body)
 */
var serializeId3Frame = function(frame) {
  var body = toBytes(frame.data);

  if (frame.id === 'PRIV' && frame.owner) {
    // PRIV frame body: owner identifier (null terminated) followed by the
    // private data.
    body = concat(stringToCStringBytes(frame.owner), body);
  }

  var header = concat(
    stringToBytes(frame.id),
    // frame size as a sync-safe integer
    toSyncSafeInteger(body.length),
    [0xe0, 0x00] // frame flags: tag alter preservation, read-only
  );

  return concat(header, body);
};

/**
 * Serialize a parsed ID3 tag (the `data` event shape emitted by
 * MetadataStream, with a `frames` array) into ID3v2.3 bytes.
 *
 * @param {Object} tag a parsed ID3 tag with a `frames` array
 * @returns {Uint8Array} the serialized ID3 tag including its header
 */
var serializeId3Tag = function(tag) {
  var frameBytes = [], i;

  for (i = 0; i < tag.frames.length; i++) {
    frameBytes = concat(frameBytes, serializeId3Frame(tag.frames[i]));
  }

  var header = concat(
    ID3_IDENTIFIER,
    [0x03, 0x00], // version 3.0, revision 0
    [0x00], // flags: no extended header, no unsynchronization
    // tag size, sync-safe, excludes the 10 byte header
    toSyncSafeInteger(frameBytes.length)
  );

  return new Uint8Array(concat(header, frameBytes));
};

module.exports = {
  serializeId3Tag: serializeId3Tag,
  serializeId3Frame: serializeId3Frame,
  stringToCStringBytes: stringToCStringBytes
};
