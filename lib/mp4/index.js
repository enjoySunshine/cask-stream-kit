/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0
 */
module.exports = {
  generator: require('./mp4-generator'),
  probe: require('./probe'),
  emsg: require('./emsg'),
  serializeId3: require('./serialize-id3'),
  Transmuxer: require('./transmuxer').Transmuxer,
  AudioSegmentStream: require('./transmuxer').AudioSegmentStream,
  VideoSegmentStream: require('./transmuxer').VideoSegmentStream,
  CaptionParser: require('./caption-parser'),
  WebVttParser: require('./webvtt-parser')
};
