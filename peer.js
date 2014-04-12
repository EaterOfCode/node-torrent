var util = require("util"),
    events = require("events"),
    net = require("net"),
    utp = require("utp"),
    BitField = require("bitfield");


var Peer = function(options) {
    events.EventEmitter.call(this);
    this.hash = options.hash || false;
    this.allowedHashes = options.allowedHashes || false;
    this.gotHandshake = false;
    this.sentHandshake = false;
    this.buffer = new Buffer(0);
    this.myBitfield = options.bitfield;
    this.bitfield = new BitField();
    var that = this;

    var sock = this._sock = options.socket || (options.tcp ? net : utp).connect(options.port, options.host, function() {
        that._handshake();
    });
    sock.on("data", function(data) {
        that._onData(data);
    });
    sock.on("error", function(err) {
        that.emit('error', err);
    });
    sock.on("end", function() {
        that.emit("end");
    });
}

util.inherits(Peer, events.EventEmitter);

Peer.prototype._handshake = function(hash) {
    var handshake = new Buffer(68);
    handshake[0] = 19;
    handshake.asciiWrite("BitTorrent protocol", 1);
    handshake.write(new Buffer([0, 0, 0, 0, 0, 0, 0, 0]).toString(), 20);
    (hash || this.hash).copy(handshake, 28, 0, 20);
    handshake.write("-NT001-" + [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].map(function() {
        return [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, "A", "B", "C", "D", "E", "F"][Math.floor(Math.random() * 16)]
    }).join(''), 48);
    this._sock.write(handshake);
    this.sentHandshake = true;
}

Peer.prototype._onData = function(data) {
    var buffer = this.buffer = Buffer.concat([this.buffer, data]);
    if (!this.gotHandshake) {
        if (buffer.length < 68) {
            return;
        }
        var handshake = buffer.slice(0, 68);
        if (handshake[0] != 19) {
            this.emit('error', new Error("Receiving handshake is not okay, 0: " + handshake[0]));
            this._sock.destroy();
            return;
        }
        var protocolid = handshake.slice(1, 20);
        if (protocolid.toString() != "BitTorrent protocol") {
            this.emit('error', new Error("Receiving handshake is not okay, 1: " + protocolid.toString()));
            this._sock.destroy();
            return;
        }
        var hisHash = handshake.slice(28, 48);
        if (this.hash && this.hash.toString('hex') == hisHash.toString('hex')) {
            if (!this.sentHandshake) {
                this._handshake(hisHash);
            }
            this.sendBitfield(this.myBitfield);
        } else if (this.hashes && -1 != Object.keys(this.hashes).indexOf(hisHash.toString('hex'))) {
            if (!this.sentHandshake) {
                this._handshake(hisHash);
            }
            this.sendBitfield(this.hashes[hisHash.toString('hex')].bitfield);
        } else {
            this.emit('error', new Error("Hashes dont match"));
            this._sock.destroy();
            return;
        }
        this.gotHandshake = true;
        buffer = this.buffer = buffer.slice(68);
        this.peerId = handshake.slice(48);
        this.emit('ready');
    } else {

        while (buffer.length > 3) {
            var length = buffer.readInt32BE(0);
            if ((length + 4) <= buffer.length) {
                var type = buffer[4];
                switch (type) {
                    case Peer.CHOKE:
                        this.isChoked = true;
                        this.emit("choke");
                        break;
                    case Peer.UNCHOKE:
                        this.isChoked = false;
                        this.emit("unchoke");
                        break;
                    case Peer.INTRESTED:
                        this.isIntrested = true;
                        this.emit("intrested");
                        break;
                    case Peer.NOTINTRESTED:
                        this.isIntrested = false;
                        this.emit("notintrested");
                        break;
                    case Peer.HAVE:
                        var index = buffer.readInt32BE(5);
                        this.bitfield.set(index, true);
                        this.emit('have', index);
                        break;
                    case Peer.BITFIELD:
                        var bitfield = buffer.slice(5, length + 4);
                        this.bitfield = new BitField(bitfield, {
                            grow: Infinity
                        });
                        this.emit('bitfield', this.bitfield);
                        break;
                    case Peer.REQUEST:
                        var index = buffer.readInt32BE(5);
                        var begin = buffer.readInt32BE(9);
                        var length = buffer.readInt32BE(13);
                        this.emit('request', {
                            index: index,
                            offset: begin,
                            length: length
                        });
                        break;
                    case Peer.PIECE:
                        var index = buffer.readInt32BE(5);
                        var offset = buffer.readInt32BE(9);
                        var block = buffer.slice(13, length + 4);
                        this.emit('piece', {
                            index: index,
                            offset: offset,
                            length: block.length,
                            block: block
                        });
                        break;
                    case Peer.CANCEL:
                        var index = buffer.readInt32BE5(5);
                        var begin = buffer.readInt32BE(9);
                        var length = buffer.readInt32BE(13);
                        this.emit('cancel', {
                            index: index,
                            offset: begin,
                            length: length
                        });
                        break;
                }
                this.buffer = buffer = buffer.slice(length + 4);
            } else {
                break;
            }
        }
    }
};

Peer.prototype.sendBitfield = function(bf) {
    var msg = new Buffer(bf.buffer.length + 5);
    msg.writeInt32BE(bf.buffer.length + 1, 0);
    msg[4] = 5;
    bf.buffer.copy(msg, 5);
    this._sock.write(msg);
}

Peer.prototype.choke = function() {
    this._sock.write(new Buffer([0, 0, 0, 1, Peer.CHOKE]));
}

Peer.prototype.unchoke = function() {
    this._sock.write(new Buffer([0, 0, 0, 1, Peer.UNCHOKE]));
}

Peer.prototype.intrested = function() {
    this._sock.write(new Buffer([0, 0, 0, 1, Peer.INTRESTED]));
}

Peer.prototype.notintrested = function() {
    this._sock.write(new Buffer([0, 0, 0, 1, Peer.NOTINTRESTED]));
}

Peer.prototype.have = function(index) {
    var tmpBuf = new Buffer(9);
    tmpBuf.writeInt32BE(5, 0);
    tmpBuf[4] = Peer.HAVE;
    tmpBuf.writeInt32BE(index, 5);
    this._sock.write(tmpBuf);
}

Peer.prototype.request = function(index, offset, length) {
    var tmpBuf = new Buffer(17);
    tmpBuf.writeInt32BE(13, 0);
    tmpBuf[4] = Peer.REQUEST;
    /*.log({
        index: index,
        offset: offset,
        length: length
    })*/
    tmpBuf.writeInt32BE(index, 5);
    tmpBuf.writeInt32BE(offset, 9);
    tmpBuf.writeInt32BE(length, 13);
    this._sock.write(tmpBuf);
}

Peer.prototype.piece = function(index, offset, block) {
    var tmpBuf = new Buffer(13 + block.length);
    tmpBuf.writeInt32BE(9 + block.length, 0);
    tmpBuf[4] = Peer.REQUEST;
    tmpBuf.writeInt32BE(index, 5);
    tmpBuf.writeInt32BE(offset, 9);
    block.copy(tmpBuf, 13);
    this._sock.write(tmpBuf);
}

Peer.prototype.cancel = function(index, offset, length) {
    var tmpBuf = new Buffer(17);
    tmpBuf.writeInt32BE(13, 0);
    tmpBuf[4] = Peer.CANCEL;
    tmpBuf.writeInt32BE(index, 5);
    tmpBuf.writeInt32BE(offset, 9);
    tmpBuf.writeInt32BE(length, 13);
    this._sock.write(tmpBuf);
}

Peer.CHOKE = 0;
Peer.UNCHOKE = 1;
Peer.INTRESTED = 2;
Peer.NOTINTRESTED = 3;
Peer.HAVE = 4;
Peer.BITFIELD = 5;
Peer.REQUEST = 6;
Peer.PIECE = 7;
Peer.CANCEL = 8;
Peer.PORT = 9;

module.exports = Peer;