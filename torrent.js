var fs = require("fs"),
    bncode = require("bncode"),
    util = require("util"),
    events = require("events"),
    crypto = require('crypto'),
    tools = require('./tools.js'),
    Algorithm = require('./algorithm.js'),
    Storage = require('./storage.js'),
    BitField = require('bitfield');

var Torrent = function(filename, targetFolder) {
    events.EventEmitter.call(this);
    this.peers = [];
    this.targetFolder = targetFolder;
    this._fd;
    var that = this;
    fs.readFile(filename, function(err, data) {
        if (err) {
            that.emit("error", err);
            return;
        }
        var decoder = new bncode.decoder();
        decoder.decode(data);
        that.data = tools.bufferToString(decoder.result()[0], 'utf8', ['pieces']);
        if(!!that.data.info.files){
            that.data.length=0;
            that.data.info.files.forEach(function(file){
                that.data.length+=file.length;
            });
        }else{
            that.data.length = that.data.info.length;
        }
        console.log(require('util').inspect(that.data, {
            colors: true,
            depth: 5
        }));
        that.storage = new Storage(that.data, targetFolder);
        that.calculateHash();
        that.bitfield = new BitField(that.data.info.pieces.length / 20);
        that._algo = new Algorithm(that);
        that._algo.on('done', function() {
            that.emit('done');
        });
        that.emit('ready');
    });

}

util.inherits(Torrent, events.EventEmitter);

Torrent.prototype.checkPiece = function(index, cb) {
    var that = this;
    setImmediate(function() {
        if (that.storage.isWriting(index)) {
            that.checkPiece(index, cb);
        } else {
            var shasum = crypto.createHash('sha1');
            that.storage.get(index, function(err,b){
                if (err) {
                    cb(false);
                    return;
                }
                shasum.update(b);
                shasum = shasum.digest();
                var shasumB = that.data.info.pieces.slice(index * 20, (index * 20) + 20);
                cb(shasumB.toString('hex') == shasum.toString('hex'));
            });
        }
    });
}

Torrent.prototype.addPeer = function(peer) {
    var that = this;
    peer.on('ready', function() {
        that.peers.push(peer);
        that.emit('peer', peer);
        peer.on('piece', function(block) {
            that.writeBlock(block);
        });
        peer.on('end', function() {
            that.peers.splice(that.peers.indexOf(peer), 1);
        });
    });
};

Torrent.prototype.writeBlock = function(block) {
    this.storage.set(block);
}

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
    });
};

module.exports = Torrent;
