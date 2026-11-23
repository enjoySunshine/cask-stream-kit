'use strict';

var QUnit = require('qunit');
var serializeId3 = require('../lib/mp4/serialize-id3');
var parseId3 = require('../lib/tools/parse-id3');
var id3Generator = require('./utils/id3-generator');

QUnit.module('ID3 Serializer');

QUnit.test('serializes a PRIV tag that round trips through the ID3 parser',
  function(assert) {
    var owner = 'com.apple.streaming.transportStreamTimestamp';
    var privateData = new Uint8Array([0, 0, 0, 0, 0, 13, 170, 202]);
    var tag = {
      frames: [{
        id: 'PRIV',
        key: 'PRIV',
        owner: owner,
        data: privateData
      }]
    };

    var bytes = serializeId3.serializeId3Tag(tag);

    assert.equal(bytes[0], 0x49, 'starts with I');
    assert.equal(bytes[1], 0x44, 'starts with D');
    assert.equal(bytes[2], 0x33, 'starts with 3');
    assert.equal(bytes[3], 0x03, 'ID3v2.3 major version');

    var reparsed = parseId3.parseId3Frames(bytes);

    assert.equal(reparsed.length, 1, 'parsed one frame');
    assert.equal(reparsed[0].id, 'PRIV', 'frame id preserved');
    assert.equal(reparsed[0].owner, owner, 'owner preserved');
    assert.deepEqual(
      new Uint8Array(reparsed[0].data),
      privateData,
      'private data preserved'
    );
  });

QUnit.test('serializes multiple frames in order', function(assert) {
    var tag = {
      frames: [
        {
          id: 'PRIV',
          key: 'PRIV',
          owner: 'owner-one',
          data: new Uint8Array([0x01])
        },
        {
          id: 'PRIV',
          key: 'PRIV',
          owner: 'owner-two',
          data: new Uint8Array([0x02])
        }
      ]
    };

    var reparsed = parseId3.parseId3Frames(serializeId3.serializeId3Tag(tag));

    assert.equal(reparsed.length, 2, 'parsed both frames');
    assert.equal(reparsed[0].owner, 'owner-one', 'first frame order preserved');
    assert.equal(reparsed[1].owner, 'owner-two', 'second frame order preserved');
    assert.deepEqual(new Uint8Array(reparsed[0].data), new Uint8Array([0x01]),
      'first data preserved');
    assert.deepEqual(new Uint8Array(reparsed[1].data), new Uint8Array([0x02]),
      'second data preserved');
  });

QUnit.test('produces the same tag shape as the test id3 generator',
  function(assert) {
    var owner = 'priv-owner@example.com';
    var payload = id3Generator.stringToInts('foo.bar.id3.com');

    var generatorBytes = new Uint8Array(id3Generator.id3Tag(
      id3Generator.id3Frame('PRIV',
        id3Generator.stringToCString(owner),
        payload)));

    var serializedBytes = serializeId3.serializeId3Tag({
      frames: [{
        id: 'PRIV',
        key: 'PRIV',
        owner: owner,
        // the serializer prepends the owner itself
        data: new Uint8Array(payload)
      }]
    });

    // both should parse to equivalent frames even if their headers differ
    var fromGenerator = parseId3.parseId3Frames(generatorBytes);
    var fromSerializer = parseId3.parseId3Frames(serializedBytes);

    assert.equal(fromSerializer[0].id, fromGenerator[0].id, 'same frame id');
    assert.equal(fromSerializer[0].owner, fromGenerator[0].owner,
      'same owner');
    assert.deepEqual(
      new Uint8Array(fromSerializer[0].data),
      new Uint8Array(fromGenerator[0].data),
      'same data'
    );
  });
