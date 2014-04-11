var fs = require("fs"),
    bncode = require("bncode"),
    util = require("util"),
    events = require("events"),
    crypto = require('crypto'),
    tools = require('./tools.js'),
    Algorithm = require('./algorithm.js'),
    BitField = require('bitfield');

var Torrent = function(filename, targetFile) {
    events.EventEmitter.call(this);
    this.peers = [];
    this.targetFile = targetFile;
    this._fd;
    var that = this;
    this._queuedWrites = [];
    fs.readFile(filename, function(err, data) {
        if (err) {
            that.emit("error", err);
            return;
        }
        that.openTarget(function(err, fd) {
            if (err) {
                that.emit("error", err);
                return;
            }
            that._fd = fd;
            var decoder = new bncode.decoder();
            decoder.decode(data);
            that.data = tools.bufferToString(decoder.result()[0], 'utf8', ['pieces']);
            console.log(require('util').inspect(that.data, {
                colors: true,
                depth: null
            }));
            that.calculateHash();
            that.bitfield = new BitField(that.data.info.pieces.length / 20);
            that._algo = new Algorithm(that);
            that._algo.on('done', function() {
                that.emit('done');
            });
            that.emit('ready');
        });
    });

}

util.inherits(Torrent, events.EventEmitter);

Torrent.prototype.openTarget = function(cb) {
    var that = this;
    fs.exists(this.targetFile, function(is) {
        fs.open(that.targetFile, is ? 'r+' : 'w+', function(err, fd) {
            cb(err, fd);
        });
    })
}

Torrent.prototype.addPeer = function(peer) {
    var that = this;
    peer.on('ready', function() {
        that.peers.push(peer);
        that.emit('peer', peer);
        peer.on('piece', function(block) {
            //console.log(block);
            that.writeBlock(block);
        });
        peer.on('end', function() {
            that.peers.splice(that.peers.indexOf(peer), 1);
        });
    });
};

Torrent.prototype.writeBlock = function(block) {
    this._queuedWrites.push(block);
    this._writeBlock();
}

Torrent.prototype._writeBlock = function() {
    if (this._isWriting) return;
    var block = this._queuedWrites.shift();
    if (block) {
        this._isWriting = true;
        var that = this;
        var pos = (block.index * this.data.info['piece length']) + block.offset;
        fs.write(this._fd, block.block, 0, block.block.length, pos, function(err) {
            if (err) {
                that.emit('error', err);
            }
            that._isWriting = false;
            that._writeBlock();
        });
    }
};

Torrent.prototype.calculateHash = function() {
    if (this.hash) return this.hash;
    var shasum = crypto.createHash('sha1'),
        bncoded = bncode.encode(this.data.info);
    shasum.update(bncoded);
    var hash = this.hash = new Buffer(shasum.digest(), 'binary');
    return hash;
};

Torrent.prototype.have = function(index) {
    this.peers.forEach(function(a) {
        a.have(index);
    })
};

module.exports = Torrent;