/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0
 */
var toUnsigned = function(value) {
  return value >>> 0;
};

var toHexString = function(value) {
  return ('00' + value.toString(16)).slice(-2);
};

module.exports = {
  toUnsigned: toUnsigned,
  toHexString: toHexString
};
