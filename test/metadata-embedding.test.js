'use strict';

var segments = require('data-files!segments');

var
  QUnit = require('qunit'),
  mp4 = require('../lib/mp4'),
  FullTransmuxer = require('../lib/mp4/transmuxer').Transmuxer,
  PartialTransmuxer = require('../lib/partial/transmuxer'),
  probe = require('../lib/mp4/probe'),
  findBox = require('../lib/mp4/find-box'),
  parseTfdt = require('../lib/tools/parse-tfdt'),
  aacSegment = segments['test-aac-segment.aac'](),
  tsSegment = segments['test-segment.ts'](),

  // the timestamp reported by the live transmuxer for the PRIV frame in the
  // raw AAC test segment
  EXPECTED_RAW_SECONDS = 895690 / 90000,
  TOLERANCE = 1 / 90000;

// concatenate every media fragment emitted by a transmuxer into one byte array
var concatData = function(events) {
  var total = events.reduce(function(sum, event) {
    return sum + event.data.byteLength;
  }, 0);
  var result = new Uint8Array(total);
  var offset = 0;

  events.forEach(function(event) {
    result.set(event.data, offset);
    offset += event.data.byteLength;
  });
  return result;
};

// read every baseMediaDecodeTime (tfdt) out of the emitted fragments
var tfdtBaselines = function(events) {
  var baselines = [];

  events.forEach(function(event) {
    var trafs = findBox(event.data, ['moof', 'traf']);

    trafs.forEach(function(traf) {
      var tfdt = findBox(traf, ['tfdt'])[0];

      if (tfdt) {
        baselines.push(Number(parseTfdt(tfdt).baseMediaDecodeTime));
      }
    });
  });
  return baselines;
};

QUnit.module('Timed metadata embedding', {
  beforeEach: function() {
    this.fullEvents = [];
    this.fullId3 = [];
  }
});

QUnit.test('full AAC transmux embeds the PRIV score at the shifted time',
  function(assert) {
    var transmuxer = new FullTransmuxer();

    transmuxer.on('data', function(event) {
      this.fullEvents.push(event);
    }.bind(this));
    transmuxer.on('id3Frame', function(frame) {
      this.fullId3.push(frame);
    }.bind(this));

    transmuxer.push(aacSegment);
    transmuxer.flush();

    var media = concatData(this.fullEvents);
    var probed = probe.getEmsgID3(media);

    // the initialization segment stays free of timed metadata
    assert.equal(
      probe.getEmsgID3(this.fullEvents[0].initSegment).length,
      0,
      'no emsg in the initialization segment'
    );
    assert.equal(this.fullEvents[0].initSegment.byteLength, 592,
      'initialization segment remains 592 bytes');

    // one emsg carrying the PRIV frame
    assert.equal(probed.length, 1, 'one emsg embedded in the media bytes');
    assert.equal(probed[0].frames[0].id, 'PRIV', 'frame name is PRIV');
    assert.equal(probed[0].frames[0].owner,
      'com.apple.streaming.transportStreamTimestamp', 'owner is preserved');

    // default behavior shifts the timeline to the segment start, so the
    // reported and re-probed time are both zero
    assert.equal(this.fullId3[0].cueTime, 0, 'reported cueTime is zero');
    assert.equal(probed[0].cueTime, 0, 'probed cueTime is zero');
    assert.ok(
      Math.abs(probed[0].cueTime - this.fullId3[0].cueTime) <= TOLERANCE,
      'probed and reported times agree within 1/90000 of a second'
    );

    // sample decode timeline is untouched
    assert.deepEqual(tfdtBaselines(this.fullEvents), [0],
      'sample decode time baseline stays zero');
  });

QUnit.test('full AAC transmux keeps the raw timestamp when configured to',
  function(assert) {
    var transmuxer = new FullTransmuxer({ keepOriginalTimestamps: true });

    transmuxer.on('data', function(event) {
      this.fullEvents.push(event);
    }.bind(this));
    transmuxer.on('id3Frame', function(frame) {
      this.fullId3.push(frame);
    }.bind(this));

    transmuxer.push(aacSegment);
    transmuxer.flush();

    var probed = probe.getEmsgID3(concatData(this.fullEvents));

    assert.equal(this.fullId3[0].cueTime, EXPECTED_RAW_SECONDS,
      'reported cueTime is the raw timestamp in seconds');
    assert.equal(probed[0].cueTime, EXPECTED_RAW_SECONDS,
      'probed cueTime is the raw timestamp in seconds');
    assert.ok(
      Math.abs(probed[0].cueTime - this.fullId3[0].cueTime) <= TOLERANCE,
      'probed and reported times agree within 1/90000 of a second'
    );
    assert.equal(probed[0].frames[0].id, 'PRIV', 'frame name is PRIV');
    assert.equal(probed[0].frames[0].owner,
      'com.apple.streaming.transportStreamTimestamp', 'owner is preserved');

    // sample decode timeline is untouched by the embedded metadata
    assert.deepEqual(tfdtBaselines(this.fullEvents), [438888],
      'sample decode time baseline stays 438888');
  });

QUnit.test('the TS test segment without metadata keeps its exact byte size',
  function(assert) {
    var transmuxer = new FullTransmuxer();
    var events = [];

    transmuxer.on('data', function(event) {
      events.push(event);
    });

    transmuxer.push(tsSegment);
    transmuxer.flush();

    var media = concatData(events);

    assert.equal(media.byteLength, 159965, 'media bytes remain 159965');
    assert.equal(probe.getEmsgID3(media).length, 0, 'no emsg is embedded');
    assert.deepEqual(tfdtBaselines(events), [0, 0],
      'sample decode time baselines stay zero');
  });

QUnit.test('low latency partial transmux embeds the raw timestamp and ' +
  'reports it ahead of the media', function(assert) {
    var transmuxer = new PartialTransmuxer();
    var order = [];
    var id3Frames = [];
    var fragments = [];
    var chunkSize = 500;
    var i;

    transmuxer.on('id3Frame', function(frame) {
      order.push('id3Frame');
      id3Frames.push(frame);
    });
    transmuxer.on('data', function(event) {
      order.push('data');
      fragments.push(event.data.boxes);
    });

    for (i = 0; i < aacSegment.length; i += chunkSize) {
      transmuxer.push(aacSegment.subarray(i, Math.min(i + chunkSize,
        aacSegment.length)));
      transmuxer.partialFlush();
    }
    transmuxer.flush();

    assert.equal(order[0], 'id3Frame', 'score is reported before media bytes');
    assert.equal(order[1], 'data', 'media bytes follow the score');
    assert.equal(id3Frames[0].cueTime, EXPECTED_RAW_SECONDS,
      'reported cueTime is the raw timestamp');

    var media = fragments.reduce(function(acc, boxes) {
      var combined = new Uint8Array(acc.length + boxes.length);

      combined.set(acc);
      combined.set(boxes, acc.length);
      return combined;
    }, new Uint8Array(0));
    var probed = probe.getEmsgID3(media);

    assert.equal(probed.length, 1, 'one emsg embedded across the fragments');
    assert.equal(probed[0].cueTime, EXPECTED_RAW_SECONDS,
      'probed cueTime is the raw timestamp');
    assert.ok(
      Math.abs(probed[0].cueTime - id3Frames[0].cueTime) <= TOLERANCE,
      'probed and reported times agree within 1/90000 of a second'
    );
  });

QUnit.test('partial transmux keeps the raw timestamp with keepOriginal ' +
  'timestamps set', function(assert) {
    var transmuxer = new PartialTransmuxer({ keepOriginalTimestamps: true });
    var fragments = [];
    var id3Frames = [];

    transmuxer.on('id3Frame', function(frame) {
      id3Frames.push(frame);
    });
    transmuxer.on('data', function(event) {
      fragments.push(event.data.boxes);
    });

    transmuxer.push(aacSegment);
    transmuxer.flush();

    var media = fragments.reduce(function(acc, boxes) {
      var combined = new Uint8Array(acc.length + boxes.length);

      combined.set(acc);
      combined.set(boxes, acc.length);
      return combined;
    }, new Uint8Array(0));
    var probed = probe.getEmsgID3(media);

    assert.equal(id3Frames[0].cueTime, EXPECTED_RAW_SECONDS,
      'reported cueTime is the raw timestamp');
    assert.equal(probed[0].cueTime, EXPECTED_RAW_SECONDS,
      'probed cueTime is the raw timestamp');
  });

QUnit.test('re-probing stored bytes returns frames in emission order',
  function(assert) {
    var id3Generator = require('./utils/id3-generator');
    var serializeId3 = require('../lib/mp4/serialize-id3');
    var utils = require('./utils');
    var tagFor = function(marker) {
      // the test transport packet helpers operate on plain arrays, so build
      // the ID3 tag as an array rather than a Uint8Array
      return id3Generator.id3Tag(
        id3Generator.id3Frame('PRIV',
          id3Generator.stringToCString(
            'com.apple.streaming.transportStreamTimestamp'),
          [0, 0, 0, 0, 0, 0x15, 0x5c, marker]));
    };
    var metaPesOne = utils.transportPacket(0x13, tagFor(0x01));
    var metaPesTwo = utils.transportPacket(0x13, tagFor(0x02));
    var transmuxer = new FullTransmuxer();
    var events = [];

    transmuxer.on('data', function(event) {
      events.push(event);
    });

    transmuxer.push(utils.packetize(utils.PAT));
    transmuxer.push(utils.packetize(utils.generatePMT({
      hasVideo: false,
      hasAudio: true,
      hasMetadata: true
    })));
    transmuxer.push(utils.packetize(metaPesOne));
    transmuxer.push(utils.packetize(metaPesTwo));
    transmuxer.push(utils.packetize(
      utils.audioPes([0x19, 0x47], true, 90000)));
    transmuxer.flush();

    var probed = probe.getEmsgID3(concatData(events));

    assert.equal(probed.length, 2, 'both scores embedded');
    assert.deepEqual(
      probed.map(function(entry) {
        return entry.frames[0].data[entry.frames[0].data.length - 1];
      }),
      [0x01, 0x02],
      'frames read back in emission order'
    );
    probed.forEach(function(entry) {
      assert.equal(entry.frames[0].id, 'PRIV', 'frame name is PRIV');
      assert.equal(entry.frames[0].owner,
        'com.apple.streaming.transportStreamTimestamp',
        'owner is preserved');
    });
    // sanity: serializer referenced so the require stays intentional
    assert.ok(serializeId3, 'serializer module is available');
  });
